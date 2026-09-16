/**
 * Envío de mensajes de conversación por WhatsApp (job `whatsapp.send_reply`). Idempotente y honesto:
 * - flag `outbound_whatsapp` apagado → el mensaje queda `queued` con el motivo visible (nunca "enviado" falso);
 * - sin credenciales → `awaiting_credentials`;
 * - fuera de la ventana de 24 h → `failed` con explicación (solo plantillas aprobadas);
 * - `sending` antes de llamar a Meta evita dobles envíos entre workers; un `sending` viejo queda como incierto.
 */
import { sql, type Database } from "../../db";
import { isEnabled } from "../../flags";
import { log } from "../../log";
import { CircuitOpenError, RetryableError, TimeoutError } from "../../resilience";
import { markAwaitingCredentials } from "../credentials";
import { sendWhatsAppMessage, WhatsAppApiError, WhatsAppNotConfiguredError, type OutgoingMessage } from "./client";
import { isWindowOpen, WHATSAPP_INTEGRATION_KEY, whatsappSendConfig } from "./config";

export const MSG_FLAG_OFF = "Envío real de WhatsApp desactivado (flag outbound_whatsapp): el mensaje quedó en cola, no se envió.";
export const MSG_NO_CREDENTIALS = "WhatsApp Business no está conectado (faltan credenciales): el mensaje no se envió.";
export const MSG_WINDOW_EXPIRED =
  "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada. No se envió.";
const SENDING_STALE_MS = 2 * 60_000;

export type DeliveryResult =
  | { result: "sent"; wamid: string }
  | { result: "held"; status: "queued" | "awaiting_credentials"; reason: string }
  | { result: "failed"; code: string | null; reason: string }
  | { result: "skipped"; status: string };

async function setStatus(db: Database, id: string, status: string, error: string | null, errorCode: string | null = null) {
  await db
    .updateTable("conversation_messages")
    .set({ status, error, error_code: errorCode, status_updated_at: new Date(), ...(status === "failed" ? { failed_at: new Date() } : {}) })
    .where("id", "=", id)
    .execute();
}

export async function deliverConversationMessage(db: Database, messageId: string, opts: { env?: NodeJS.ProcessEnv; sleep?: (ms: number) => Promise<void> } = {}): Promise<DeliveryResult> {
  const m = await db
    .selectFrom("conversation_messages as m")
    .innerJoin("conversations as c", "c.id", "m.conversation_id")
    .select(["m.id", "m.status", "m.direction", "m.kind", "m.body", "m.payload", "m.external_message_id", "m.status_updated_at", "c.channel", "c.external_thread_id", "c.last_inbound_at"])
    .where("m.id", "=", messageId)
    .executeTakeFirst();
  if (!m || m.direction !== "outbound" || m.channel !== "whatsapp") return { result: "skipped", status: "inexistente" };
  if (m.external_message_id || ["sent", "delivered", "read"].includes(m.status)) return { result: "skipped", status: m.status };
  if (m.status === "sending") {
    const age = Date.now() - new Date(m.status_updated_at ?? 0).getTime();
    if (age < SENDING_STALE_MS) return { result: "skipped", status: "sending" };
    const reason = "Estado incierto: el envío se interrumpió y pudo haberse realizado. Verificá en WhatsApp antes de reintentar.";
    await setStatus(db, m.id, "failed", reason, "uncertain");
    return { result: "failed", code: "uncertain", reason };
  }

  if (!(await isEnabled(db, "outbound_whatsapp"))) {
    await setStatus(db, m.id, "queued", MSG_FLAG_OFF, "flag_off");
    return { result: "held", status: "queued", reason: MSG_FLAG_OFF };
  }
  const { config, missing } = whatsappSendConfig(opts.env);
  if (!config) {
    await markAwaitingCredentials(db, WHATSAPP_INTEGRATION_KEY, missing);
    await setStatus(db, m.id, "awaiting_credentials", MSG_NO_CREDENTIALS, "no_credentials");
    return { result: "held", status: "awaiting_credentials", reason: MSG_NO_CREDENTIALS };
  }

  let outgoing: OutgoingMessage;
  if (m.kind === "template") {
    const t = (m.payload as { template?: { name?: string; language?: string } }).template;
    if (!t?.name || !t.language) {
      await setStatus(db, m.id, "failed", "Plantilla mal configurada", "invalid_template");
      return { result: "failed", code: "invalid_template", reason: "Plantilla mal configurada" };
    }
    outgoing = { type: "template", to: m.external_thread_id, name: t.name, language: t.language };
  } else {
    if (!isWindowOpen(m.last_inbound_at)) {
      await setStatus(db, m.id, "failed", MSG_WINDOW_EXPIRED, "window_expired");
      return { result: "failed", code: "window_expired", reason: MSG_WINDOW_EXPIRED };
    }
    if (!m.body?.trim()) {
      await setStatus(db, m.id, "failed", "Mensaje vacío", "empty");
      return { result: "failed", code: "empty", reason: "Mensaje vacío" };
    }
    outgoing = { type: "text", to: m.external_thread_id, body: m.body.slice(0, 4096) };
  }

  const claimed = await sql<{ id: string }>`
    update conversation_messages set status = 'sending', attempts = attempts + 1, status_updated_at = now()
     where id = ${m.id} and status in ('queued', 'failed', 'awaiting_credentials') and external_message_id is null
    returning id`.execute(db);
  if (!claimed.rows[0]) return { result: "skipped", status: "tomado por otro proceso" };

  try {
    const sent = await sendWhatsAppMessage(db, outgoing, { entityType: "conversation_message", entityId: m.id, env: opts.env, sleep: opts.sleep });
    await db
      .updateTable("conversation_messages")
      .set({ status: "sent", external_message_id: sent.wamid, sent_at: new Date(), status_updated_at: new Date(), error: null, error_code: null })
      .where("id", "=", m.id)
      .where("status", "=", "sending")
      .execute();
    return { result: "sent", wamid: sent.wamid };
  } catch (e) {
    if (e instanceof WhatsAppNotConfiguredError) {
      await setStatus(db, m.id, "awaiting_credentials", MSG_NO_CREDENTIALS, "no_credentials");
      return { result: "held", status: "awaiting_credentials", reason: MSG_NO_CREDENTIALS };
    }
    if (e instanceof WhatsAppApiError && e.windowExpired) {
      await setStatus(db, m.id, "failed", MSG_WINDOW_EXPIRED, String(e.code));
      return { result: "failed", code: String(e.code), reason: MSG_WINDOW_EXPIRED };
    }
    const transient = e instanceof RetryableError || e instanceof TimeoutError || e instanceof CircuitOpenError || (e instanceof WhatsAppApiError && e.retryable);
    const code = e instanceof WhatsAppApiError ? String(e.code ?? e.status) : e instanceof TimeoutError ? "timeout" : e instanceof CircuitOpenError ? "circuit_open" : "network";
    if (transient) {
      await setStatus(db, m.id, "failed", `Falla temporal de WhatsApp (${code}); se reintenta automáticamente.`, code);
      throw e; // el job reintenta con backoff; al agotar intentos queda failed y visible
    }
    const reason = e instanceof WhatsAppApiError ? `WhatsApp rechazó el mensaje: ${e.message}` : "Error inesperado al enviar";
    if (!(e instanceof WhatsAppApiError)) log.error("whatsapp.send_unexpected", { messageId: m.id, error: (e as Error).message });
    await setStatus(db, m.id, "failed", reason.slice(0, 500), code);
    return { result: "failed", code, reason };
  }
}

/** Reencola mensajes retenidos (flag apagado o sin credenciales) cuando ya se pueden enviar. */
export async function flushHeldMessages(db: Database, enqueueSend: (messageId: string) => Promise<unknown>, env?: NodeJS.ProcessEnv): Promise<number> {
  if (!(await isEnabled(db, "outbound_whatsapp"))) return 0;
  if (!whatsappSendConfig(env).config) return 0;
  const rows = await db
    .selectFrom("conversation_messages")
    .select("id")
    .where("direction", "=", "outbound")
    .where("status", "in", ["queued", "awaiting_credentials"])
    .where("external_message_id", "is", null)
    .where("created_at", ">", sql<Date>`now() - interval '24 hours'`)
    .orderBy("created_at")
    .limit(200)
    .execute();
  for (const r of rows) await enqueueSend(r.id);
  return rows.length;
}
