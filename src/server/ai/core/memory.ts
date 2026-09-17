/**
 * Memoria del AI Core, separada en tres niveles:
 *  - EMPRESA: la base de conocimiento (knowledge/*.md → ai_knowledge_*), compartida y filtrada por permisos.
 *  - CLIENTE: perfil de necesidades de un contacto (Fase 2). Acá solo se define la interfaz; no hay implementación.
 *  - SESIÓN: la conversación del panel del copiloto (ai_conversations/ai_messages), por usuario, con retención
 *    acotada (`ai.copilot.session_retention_days`, 30 por defecto) y sin PII innecesaria.
 */
import { sql, type Database, type Executor } from "../../db";
import type { StaffActor } from "../../auth/actor";
import { notFound } from "../../errors";
import { redactForModel } from "./governance";

export const DEFAULT_SESSION_RETENTION_DAYS = 30;
export const SESSION_HISTORY_TURNS = 6;

export type CopilotMode = "assistant" | "analyst";

/** Memoria de cliente (Fase 2: concierge/matching). Contrato previsto; sin implementación en la Fase 1. */
export interface CustomerMemory {
  /** Necesidades declaradas y validadas por una persona (operación, zonas, presupuesto…), nunca inferidas en silencio. */
  getProfile(db: Executor, actor: StaffActor, contactId: string): Promise<CustomerProfile | null>;
  /** Propone cambios al perfil: capability `suggest`, requiere confirmación humana antes de guardarse. */
  proposeUpdate(db: Executor, actor: StaffActor, contactId: string, proposal: Partial<CustomerProfile>): Promise<{ proposalId: string }>;
}

export type CustomerProfile = {
  contactId: string;
  operation: "sale" | "rent" | "temporary_rent" | null;
  propertyTypes: string[];
  localities: string[];
  budgetMax: number | null;
  budgetCurrency: "USD" | "ARS" | null;
  minBedrooms: number | null;
  notes: string | null;
  confirmedBy: string | null;
  updatedAt: Date;
};

async function retentionDays(db: Executor): Promise<number> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", "ai.copilot.session_retention_days").executeTakeFirst();
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_SESSION_RETENTION_DAYS;
}

/** Devuelve la conversación del usuario (vigente) o crea una nueva. Una conversación ajena o vencida → 404. */
export async function openConversation(db: Executor, actor: StaffActor, input: { conversationId?: string | null; mode: CopilotMode; module: string | null }): Promise<string> {
  if (input.conversationId) {
    const c = await db
      .selectFrom("ai_conversations")
      .select(["id"])
      .where("id", "=", input.conversationId)
      .where("user_id", "=", actor.userId)
      .where("organization_id", "=", actor.organizationId)
      .where("expires_at", ">", sql<Date>`now()`)
      .executeTakeFirst();
    if (!c) throw notFound("Conversación");
    return c.id;
  }
  const days = await retentionDays(db);
  const row = await db
    .insertInto("ai_conversations")
    .values({
      organization_id: actor.organizationId,
      user_id: actor.userId,
      mode: input.mode,
      module: input.module && /^[a-z_]{2,40}$/.test(input.module) ? input.module : null,
      expires_at: sql<Date>`now() + make_interval(days => ${days})`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function appendMessage(
  db: Executor,
  m: { conversationId: string; role: "user" | "assistant"; content: string; payload?: Record<string, unknown>; interactionId?: string | null; promptRef?: string | null },
): Promise<string> {
  // La pregunta del usuario se guarda minimizada (emails, teléfonos, documentos enmascarados).
  const content = (m.role === "user" ? redactForModel(m.content) : m.content).slice(0, 8000);
  const row = await db
    .insertInto("ai_messages")
    .values({
      conversation_id: m.conversationId,
      role: m.role,
      content,
      payload: JSON.stringify(m.payload ?? {}),
      interaction_id: m.interactionId ?? null,
      prompt_ref: m.promptRef ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.updateTable("ai_conversations").set({ last_message_at: new Date() }).where("id", "=", m.conversationId).execute();
  return row.id;
}

/** Últimos turnos de texto (para preguntas de seguimiento con modelo). */
export async function recentTurns(db: Executor, conversationId: string, turns = SESSION_HISTORY_TURNS): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = await db
    .selectFrom("ai_messages")
    .select(["role", "content", "created_at"])
    .where("conversation_id", "=", conversationId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(turns)
    .execute();
  return rows.reverse().map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", content: r.content }));
}

/** Purga de sesiones vencidas (el feedback sobrevive con message_id = null). */
export async function purgeExpiredConversations(db: Database): Promise<number> {
  const r = await sql`delete from ai_conversations where id in (select id from ai_conversations where expires_at < now() limit 5000)`.execute(db);
  return Number(r.numAffectedRows ?? 0);
}
