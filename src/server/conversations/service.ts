/**
 * Conversaciones (WhatsApp): derivación a humano, tomar/devolver/cerrar y respuestas humanas.
 * Reglas: permiso y alcance (./scope) en servidor, transacción con bloqueo de fila, auditoría y evento en la misma transacción.
 * Los envíos nunca ocurren acá: se encola `whatsapp.send_reply` y el estado real se ve en la UI.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Database, type Executor, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, requireStaff, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { notifyRole, notifyUser } from "../notifications";
import { reengagementTemplate } from "../integrations/whatsapp/config";
import { HANDOFF_REASONS, handoffLabel, type HandoffReason } from "./labels";
import { assertConversationInScope } from "./scope";

export const SEND_REPLY_JOB = "whatsapp.send_reply";

type ConversationRow = {
  id: string;
  mode: string;
  channel: string;
  contact_id: string | null;
  assigned_user_id: string | null;
  external_thread_id: string;
  last_inbound_at: Date | null;
};

/** Bloquea la conversación y verifica que esté en el alcance del actor (fuera de alcance = 404). */
async function lockConversation(trx: Tx, actor: Actor, id: string): Promise<ConversationRow> {
  const c = await trx
    .selectFrom("conversations")
    .select(["id", "mode", "channel", "contact_id", "assigned_user_id", "external_thread_id", "last_inbound_at"])
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (!c) throw notFound("Conversación");
  await assertConversationInScope(trx, actor, id);
  return c;
}

export type QueueOutboundInput = {
  conversationId: string;
  senderKind: "bot" | "user" | "system";
  senderUserId?: string | null;
  body: string;
  kind?: "text" | "template";
  payload?: Record<string, unknown>;
  replyToMessageId?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Inserta un mensaje saliente en cola y encola su envío. Idempotente por `idempotency_key` y, para el bot,
 * por mensaje entrante respondido. Llamar dentro de una transacción.
 */
export async function queueOutboundMessage(trx: Executor, m: QueueOutboundInput): Promise<{ messageId: string; duplicate: boolean }> {
  const inserted = await sql<{ id: string }>`
    insert into conversation_messages(conversation_id, direction, sender_kind, sender_user_id, body, kind, payload,
      reply_to_message_id, idempotency_key, status, status_updated_at)
    values (${m.conversationId}, 'outbound', ${m.senderKind}, ${m.senderUserId ?? null}, ${m.body}, ${m.kind ?? "text"},
      ${JSON.stringify(m.payload ?? {})}::jsonb, ${m.replyToMessageId ?? null}, ${m.idempotencyKey ?? null}, 'queued', now())
    on conflict do nothing
    returning id`.execute(trx);
  if (!inserted.rows[0]) {
    let q = trx.selectFrom("conversation_messages").select("id").where("conversation_id", "=", m.conversationId);
    if (m.idempotencyKey) q = q.where("idempotency_key", "=", m.idempotencyKey);
    else if (m.replyToMessageId) q = q.where("reply_to_message_id", "=", m.replyToMessageId).where("sender_kind", "=", "bot");
    const existing = await q.executeTakeFirst();
    if (!existing) throw conflict("No se pudo registrar el mensaje");
    return { messageId: existing.id, duplicate: true };
  }
  const messageId = inserted.rows[0].id;
  await trx
    .updateTable("conversations")
    .set({ last_message_at: new Date(), last_outbound_at: new Date() })
    .where("id", "=", m.conversationId)
    .execute();
  await enqueue(trx, { type: SEND_REPLY_JOB, payload: { messageId }, dedupeKey: `${SEND_REPLY_JOB}:${messageId}`, maxAttempts: 5, timeoutMs: 60_000, priority: 50 });
  return { messageId, duplicate: false };
}

// ───────────────────────────── Derivación a humano ─────────────────────────────

const handoffSchema = z.object({
  conversationId: z.uuid(),
  reason: z.enum(HANDOFF_REASONS),
  detail: z.string().trim().max(500).nullable().optional(),
});

type HandoffSummary = { title: string; body: string; notifyUserId: string | null };

async function buildHandoffSummary(trx: Tx, conv: ConversationRow, reason: HandoffReason, detail: string | null): Promise<HandoffSummary> {
  const full = await trx.selectFrom("conversations").select(["collected", "summary"]).where("id", "=", conv.id).executeTakeFirstOrThrow();
  const contact = conv.contact_id
    ? await trx.selectFrom("contacts").select(["display_name", "assigned_user_id"]).where("id", "=", conv.contact_id).executeTakeFirst()
    : undefined;
  const lead = await trx
    .selectFrom("leads as l")
    .leftJoin("properties as p", "p.id", "l.property_id")
    .select(["l.id", "l.assigned_user_id", "p.code", "p.title"])
    .where("l.conversation_id", "=", conv.id)
    .where("l.deleted_at", "is", null)
    .orderBy("l.created_at", "desc")
    .executeTakeFirst();
  const lastInbound = await trx
    .selectFrom("conversation_messages")
    .select(["body"])
    .where("conversation_id", "=", conv.id)
    .where("direction", "=", "inbound")
    .orderBy("created_at", "desc")
    .limit(3)
    .execute();
  const collected = (full.collected ?? {}) as { requirements?: Record<string, unknown>; properties_shown?: number[] };
  const req = collected.requirements ?? {};
  const budget = req.budget_max ? `${req.budget_currency ?? ""} ${req.budget_max}`.trim() : null;
  const needs = [req.operation, Array.isArray(req.property_types) ? req.property_types.join("/") : null, Array.isArray(req.localities) ? req.localities.join(", ") : null, req.bedrooms_min ? `${req.bedrooms_min}+ dorm.` : null, req.notes]
    .filter(Boolean)
    .join(" · ");
  const property = lead?.code ? `#${lead.code} ${lead.title}` : collected.properties_shown?.length ? `Consultó: ${collected.properties_shown.map((c) => `#${c}`).join(", ")}` : null;

  const lines = [
    `Motivo: ${handoffLabel(reason)}${detail ? ` (${detail})` : ""}`,
    `Nombre: ${contact?.display_name ?? "sin nombre"}`,
    `WhatsApp: +${conv.external_thread_id}`,
    property ? `Propiedad: ${property}` : null,
    needs ? `Necesidades: ${needs}` : null,
    budget ? `Presupuesto: ${budget}` : null,
    full.summary ? `Resumen (asistente): ${full.summary}` : null,
    lastInbound.length
      ? `Últimos mensajes:\n${lastInbound
          .reverse()
          .map((m) => `• ${(m.body ?? "[sin texto]").slice(0, 200)}`)
          .join("\n")}`
      : null,
  ].filter(Boolean);
  return {
    title: `WhatsApp para atender: ${contact?.display_name ?? `+${conv.external_thread_id}`}`,
    body: lines.join("\n"),
    notifyUserId: conv.assigned_user_id ?? lead?.assigned_user_id ?? contact?.assigned_user_id ?? null,
  };
}

/**
 * Pasa la conversación a modo humano. Idempotente: si ya no está en modo bot no hace nada.
 * Notifica al agente asignado (conversación → lead → contacto) o a administración con un resumen.
 */
export async function handoffConversation(
  db: Database,
  actor: Actor,
  raw: z.input<typeof handoffSchema>,
): Promise<{ handedOff: boolean }> {
  requirePermission(actor, "conversations.reply");
  const input = handoffSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, actor, input.conversationId);
    if (conv.mode !== "bot") return { handedOff: false };
    const now = new Date();
    await trx
      .updateTable("conversations")
      .set({ mode: "human", handoff_at: now, handoff_reason: input.reason })
      .where("id", "=", conv.id)
      .execute();
    const summary = await buildHandoffSummary(trx, conv, input.reason, input.detail ?? null);
    await audit(trx, actor, {
      action: "CONVERSATION_HANDOFF",
      entityType: "conversation",
      entityId: conv.id,
      before: { mode: conv.mode },
      after: { mode: "human", reason: input.reason, detail: input.detail ?? null },
    });
    const link = `/crm/conversaciones/${conv.id}`;
    await emitEvent(trx, actor, {
      type: "conversation.handoff",
      aggregateType: "conversation",
      aggregateId: conv.id,
      payload: { reason: input.reason, assignedUserId: summary.notifyUserId, summary: summary.body.slice(0, 1000), link },
      dedupeKey: `conversation.handoff:${conv.id}:${now.toISOString()}`,
    });
    const notification = {
      kind: "conversation.handoff",
      title: summary.title,
      body: summary.body,
      link,
      entityType: "conversation",
      entityId: conv.id,
      dedupeKey: `handoff:${conv.id}:${now.toISOString()}`,
    };
    if (summary.notifyUserId) await notifyUser(trx, summary.notifyUserId, notification);
    else await notifyRole(trx, "administrador", notification);
    return { handedOff: true };
  });
}

// ───────────────────────────── Acciones del equipo ─────────────────────────────

export async function takeConversation(db: Database, actor: Actor, conversationId: string): Promise<void> {
  requirePermission(actor, "conversations.reply");
  requireStaff(actor);
  const id = z.uuid().parse(conversationId);
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, actor, id);
    if (conv.mode === "human" && conv.assigned_user_id === actor.userId) return;
    const now = new Date();
    await trx
      .updateTable("conversations")
      .set({
        mode: "human",
        assigned_user_id: actor.userId,
        closed_at: null,
        ...(conv.mode !== "human" ? { handoff_at: now, handoff_reason: "taken_by_agent" } : {}),
      })
      .where("id", "=", id)
      .execute();
    await audit(trx, actor, {
      action: "CONVERSATION_TAKEN",
      entityType: "conversation",
      entityId: id,
      before: { mode: conv.mode, assignedUserId: conv.assigned_user_id },
      after: { mode: "human", assignedUserId: actor.userId },
    });
    if (conv.mode === "bot") {
      await emitEvent(trx, actor, {
        type: "conversation.handoff",
        aggregateType: "conversation",
        aggregateId: id,
        payload: { reason: "taken_by_agent", assignedUserId: actor.userId, link: `/crm/conversaciones/${id}` },
        dedupeKey: `conversation.handoff:${id}:${now.toISOString()}`,
      });
    }
  });
}

export async function returnToBot(db: Database, actor: Actor, conversationId: string): Promise<void> {
  requirePermission(actor, "conversations.reply");
  const id = z.uuid().parse(conversationId);
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, actor, id);
    if (conv.mode === "bot") return;
    await trx
      .updateTable("conversations")
      .set({ mode: "bot", handoff_reason: null, handoff_at: null, ai_failures: 0, closed_at: null })
      .where("id", "=", id)
      .execute();
    await audit(trx, actor, { action: "CONVERSATION_RETURNED_TO_BOT", entityType: "conversation", entityId: id, before: { mode: conv.mode }, after: { mode: "bot" } });
  });
}

export async function closeConversation(db: Database, actor: Actor, conversationId: string): Promise<void> {
  requirePermission(actor, "conversations.reply");
  const id = z.uuid().parse(conversationId);
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, actor, id);
    if (conv.mode === "closed") return;
    await trx.updateTable("conversations").set({ mode: "closed", closed_at: new Date() }).where("id", "=", id).execute();
    await audit(trx, actor, { action: "CONVERSATION_CLOSED", entityType: "conversation", entityId: id, before: { mode: conv.mode }, after: { mode: "closed" } });
  });
}

export const replySchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, "Escribí un mensaje").max(4096, "Máximo 4096 caracteres"),
  idempotencyKey: z.string().min(8).max(100),
});

/** Respuesta humana. Si la conversación estaba en modo bot, la persona la toma (la IA deja de responder). */
export async function replyAsHuman(db: Database, actor: Actor, raw: z.input<typeof replySchema>): Promise<{ messageId: string; duplicate: boolean }> {
  requirePermission(actor, "conversations.reply");
  requireStaff(actor);
  const input = replySchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, actor, input.conversationId);
    if (conv.mode === "closed") throw conflict("La conversación está cerrada. Tomala para reabrirla y responder.");
    if (conv.channel !== "whatsapp") throw invalid("Solo se puede responder conversaciones de WhatsApp");
    const idempotencyKey = `human:${actor.userId}:${input.idempotencyKey}`;
    const result = await queueOutboundMessage(trx, {
      conversationId: conv.id,
      senderKind: "user",
      senderUserId: actor.userId,
      body: input.body,
      idempotencyKey,
    });
    if (result.duplicate) return result;
    if (conv.mode === "bot" || !conv.assigned_user_id) {
      await trx
        .updateTable("conversations")
        .set({
          mode: "human",
          assigned_user_id: conv.assigned_user_id ?? actor.userId,
          ...(conv.mode === "bot" ? { handoff_at: new Date(), handoff_reason: "taken_by_agent" } : {}),
        })
        .where("id", "=", conv.id)
        .execute();
    }
    await trx
      .updateTable("leads")
      .set({ first_response_at: new Date() })
      .where("conversation_id", "=", conv.id)
      .where("first_response_at", "is", null)
      .where("deleted_at", "is", null)
      .execute();
    await audit(trx, actor, {
      action: "CONVERSATION_REPLIED",
      entityType: "conversation",
      entityId: conv.id,
      after: { messageId: result.messageId, length: input.body.length, previousMode: conv.mode },
    });
    return result;
  });
}

/** Reintenta el envío de un mensaje fallido, sin credenciales o en cola. */
export async function retryOutboundMessage(db: Database, actor: Actor, messageId: string): Promise<void> {
  requirePermission(actor, "conversations.reply");
  const id = z.uuid().parse(messageId);
  await db.transaction().execute(async (trx) => {
    const m = await trx
      .selectFrom("conversation_messages")
      .select(["id", "conversation_id", "status", "direction"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!m || m.direction !== "outbound") throw notFound("Mensaje");
    await assertConversationInScope(trx, actor, m.conversation_id);
    if (!["failed", "awaiting_credentials", "queued"].includes(m.status)) throw conflict("Ese mensaje ya fue enviado o se está enviando");
    await trx
      .updateTable("conversation_messages")
      .set({ status: "queued", error: null, error_code: null, status_updated_at: new Date() })
      .where("id", "=", id)
      .execute();
    await enqueue(trx, { type: SEND_REPLY_JOB, payload: { messageId: id }, dedupeKey: `${SEND_REPLY_JOB}:${id}`, maxAttempts: 5, timeoutMs: 60_000, priority: 50 });
    await audit(trx, actor, { action: "CONVERSATION_MESSAGE_RETRY", entityType: "conversation", entityId: m.conversation_id, before: { status: m.status }, after: { messageId: id } });
  });
}

/** Fuera de la ventana de 24 h solo se puede escribir con una plantilla aprobada por Meta. */
export async function sendReengagementTemplate(db: Database, actor: Actor, conversationId: string, requestKey: string = randomUUID()): Promise<{ messageId: string; duplicate: boolean }> {
  requirePermission(actor, "conversations.reply");
  requireStaff(actor);
  const template = reengagementTemplate();
  if (!template) throw invalid("No hay una plantilla de WhatsApp aprobada configurada (WHATSAPP_REENGAGEMENT_TEMPLATE)");
  const id = z.uuid().parse(conversationId);
  const key = z.string().min(8).max(100).parse(requestKey);
  return db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, actor, id);
    if (conv.mode === "closed") throw conflict("La conversación está cerrada. Tomala para reabrirla.");
    const result = await queueOutboundMessage(trx, {
      conversationId: id,
      senderKind: "user",
      senderUserId: actorUserId(actor),
      body: `Plantilla aprobada «${template.name}» (${template.language})`,
      kind: "template",
      payload: { template },
      idempotencyKey: `template:${actor.userId}:${key}`,
    });
    if (!result.duplicate) {
      await audit(trx, actor, { action: "CONVERSATION_TEMPLATE_SENT", entityType: "conversation", entityId: id, after: { messageId: result.messageId, template: template.name } });
    }
    return result;
  });
}
