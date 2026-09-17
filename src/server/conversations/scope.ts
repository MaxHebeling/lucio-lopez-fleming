/**
 * Alcance de conversaciones, resuelto en el servidor (lectura, respuesta, tomar/devolver/cerrar, reintentos).
 * Con `leads.read_all` (o sistema) se ven todas. Sin él, solo:
 * - asignadas a la persona,
 * - sin asignar y en modo bot (todavía las atiende la IA: cualquiera del equipo puede tomarlas),
 * - vinculadas a un lead asignado a la persona,
 * - de un contacto asignado a la persona (la derivación le notifica a esa persona).
 * Fuera de alcance se responde como inexistente (404).
 */
import { sql, type Executor } from "../db";
import { can, type Actor } from "../auth/actor";
import { notFound } from "../errors";

/** null = sin restricción; string = id del usuario al que se restringe. */
export function conversationScopeUserId(actor: Actor): string | null {
  if (actor.kind !== "staff" || can(actor, "leads.read_all")) return null;
  return actor.userId;
}

/** Condición SQL sobre el alias `c` de conversations. */
export function conversationInScopeSql(userId: string) {
  return sql<boolean>`(
    c.assigned_user_id = ${userId}
    or (c.assigned_user_id is null and c.mode = 'bot')
    or exists (select 1 from leads l where l.conversation_id = c.id and l.assigned_user_id = ${userId} and l.deleted_at is null)
    or exists (select 1 from contacts sc where sc.id = c.contact_id and sc.assigned_user_id = ${userId})
  )`;
}

export async function assertConversationInScope(db: Executor, actor: Actor, conversationId: string): Promise<void> {
  const userId = conversationScopeUserId(actor);
  if (!userId) return;
  const r = await sql<{ ok: boolean }>`select ${conversationInScopeSql(userId)} as ok from conversations c where c.id = ${conversationId}`.execute(db);
  if (!r.rows[0]?.ok) throw notFound("Conversación");
}
