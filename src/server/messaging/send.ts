/**
 * Worker de mensajes salientes (job `messaging.send`, lo encola queueMessage).
 * 1. Reclama la fila con bloqueo (FOR UPDATE) y decide: ya enviado → nada; sin credenciales / flag apagado →
 *    awaiting_credentials visible; si no, pasa a `sending` e incrementa intentos. La transacción se cierra ANTES
 *    de llamar al proveedor (nunca HTTP dentro de una transacción).
 * 2. Envía con Idempotency-Key = dedupe_key (un reintento tras un corte no duplica el email).
 * 3. Registra el resultado: sent + provider_message_id, o failed con el error. Los datos de un solo uso se redactan
 *    cuando el mensaje sale de la cola: enviado, fallido sin reintento (permanente o job muerto) o cancelado.
 */
import { sql, type Database } from "../db";
import { isEnabled } from "../flags";
import { errorFields, log } from "../log";
import { enqueue } from "../jobs/queue";
import { PermanentJobError, registerJobDeadHandler, registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { NotConfiguredError, PermanentIntegrationError } from "../integrations/http";
import { reflectIntegrationConfig } from "../integrations/status";
import { RESEND_INTEGRATION_KEY, resendConfig, sendEmailViaResend } from "../integrations/email/resend";
import { TemplateError, redactSensitive, renderEmail, renderWhatsApp, type RenderedEmail } from "./templates";
import { getWhatsAppTemplateSender } from "./whatsapp-bridge";

const SENDING_LEASE_MS = 5 * 60_000;
/** Ventana en la que `messaging.resume_awaiting` reencola mensajes que esperaban credenciales. */
const RESUME_WINDOW_MS = 7 * 86_400_000;

export type SendOutcome =
  | { outcome: "sent"; providerMessageId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "awaiting_credentials"; reason: string }
  | { outcome: "cancelled"; reason: string };

type Decision =
  | { kind: "done"; result: SendOutcome }
  | { kind: "invalid"; error: string }
  | { kind: "send_email"; to: string; rendered: RenderedEmail; dedupeKey: string; templateKey: string; payload: Record<string, unknown>; entityType: string | null; entityId: string | null }
  | { kind: "send_whatsapp"; to: string; dedupeKey: string; templateKey: string; payload: Record<string, unknown> };

export async function readiness(db: Database, channel: string): Promise<{ ready: true } | { ready: false; reason: string }> {
  if (channel === "email") {
    if (!(await isEnabled(db, "outbound_email"))) return { ready: false, reason: "Envío de email desactivado (feature flag outbound_email apagado)" };
    const cfg = resendConfig();
    await reflectIntegrationConfig(db, RESEND_INTEGRATION_KEY, cfg.ok, cfg.ok ? undefined : cfg.reason);
    if (!cfg.ok) return { ready: false, reason: `Email sin configurar: ${cfg.reason}` };
    return { ready: true };
  }
  if (channel === "whatsapp") {
    if (!(await isEnabled(db, "outbound_whatsapp"))) return { ready: false, reason: "Envío de WhatsApp desactivado (feature flag outbound_whatsapp apagado)" };
    if (!getWhatsAppTemplateSender()) return { ready: false, reason: "WhatsApp no disponible: el módulo sendWhatsAppTemplate (integración WhatsApp Cloud API) no está registrado en esta versión" };
    return { ready: true };
  }
  return { ready: false, reason: `Canal desconocido: ${channel}` };
}

export async function sendQueuedMessage(db: Database, messageId: string): Promise<SendOutcome> {
  const decision = await db.transaction().execute(async (trx): Promise<Decision> => {
    const m = await trx.selectFrom("outbound_messages").selectAll().where("id", "=", messageId).forUpdate().executeTakeFirst();
    if (!m) throw new PermanentJobError(`Mensaje ${messageId} inexistente`);
    if (["sent", "delivered", "cancelled"].includes(m.status)) return { kind: "done", result: { outcome: "skipped", reason: `ya estaba ${m.status}` } };
    if (m.status === "sending" && Date.now() - new Date(m.updated_at).getTime() < SENDING_LEASE_MS) {
      throw new Error("El mensaje se está enviando en otro proceso; se reintenta más tarde");
    }
    const payload = (m.payload ?? {}) as Record<string, unknown>;
    const expiresAt = typeof payload.expiresAt === "string" ? new Date(payload.expiresAt) : null;
    if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      const reason = "Venció antes de poder enviarse (contenía un link temporal)";
      await trx.updateTable("outbound_messages").set({ status: "cancelled", last_error: reason, payload: JSON.stringify(redactSensitive(m.template_key, payload)) }).where("id", "=", m.id).execute();
      return { kind: "done", result: { outcome: "cancelled", reason } };
    }
    const ready = await readiness(db, m.channel);
    if (!ready.ready) {
      await trx.updateTable("outbound_messages").set({ status: "awaiting_credentials", last_error: ready.reason }).where("id", "=", m.id).execute();
      return { kind: "done", result: { outcome: "awaiting_credentials", reason: ready.reason } };
    }
    let rendered: RenderedEmail | undefined;
    let sendPayload = payload;
    try {
      if (m.channel === "email") rendered = renderEmail(m.template_key, payload);
      else sendPayload = { ...payload, whatsappTemplate: renderWhatsApp(m.template_key, payload) };
    } catch (e) {
      if (e instanceof TemplateError) return { kind: "invalid", error: e.message };
      throw e;
    }
    await trx
      .updateTable("outbound_messages")
      .set({ status: "sending", attempts: sql`attempts + 1`, last_error: null, subject: rendered?.subject ?? m.subject })
      .where("id", "=", m.id)
      .execute();
    return m.channel === "email"
      ? { kind: "send_email", to: m.to_address, rendered: rendered!, dedupeKey: m.dedupe_key, templateKey: m.template_key, payload, entityType: m.entity_type, entityId: m.entity_id }
      : { kind: "send_whatsapp", to: m.to_address, dedupeKey: m.dedupe_key, templateKey: m.template_key, payload: sendPayload };
  });

  if (decision.kind === "done") return decision.result;
  if (decision.kind === "invalid") {
    await markFailedAndRedact(db, messageId, decision.error);
    throw new PermanentJobError(decision.error);
  }

  try {
    let providerMessageId: string;
    if (decision.kind === "send_email") {
      const r = await sendEmailViaResend(db, {
        to: decision.to,
        subject: decision.rendered.subject,
        html: decision.rendered.html,
        text: decision.rendered.text,
        idempotencyKey: decision.dedupeKey,
        tags: { template: decision.templateKey },
        entityType: decision.entityType ?? undefined,
        entityId: decision.entityId ?? undefined,
      });
      providerMessageId = r.providerMessageId;
    } else {
      const sender = getWhatsAppTemplateSender();
      if (!sender) throw new NotConfiguredError("WhatsApp no disponible: sendWhatsAppTemplate no está registrado");
      const r = await sender(db, { messageId, to: decision.to, templateKey: decision.templateKey, payload: decision.payload, dedupeKey: decision.dedupeKey });
      if (r.status === "awaiting_credentials") throw new NotConfiguredError(r.reason);
      providerMessageId = r.providerMessageId;
    }
    await db
      .updateTable("outbound_messages")
      .set({ status: "sent", sent_at: new Date(), provider_message_id: providerMessageId, last_error: null, payload: JSON.stringify(redactSensitive(decision.templateKey, decision.payload)) })
      .where("id", "=", messageId)
      .execute();
    return { outcome: "sent", providerMessageId };
  } catch (e) {
    const message = ((e as Error).message ?? String(e)).slice(0, 1000);
    if (e instanceof NotConfiguredError) {
      await db.updateTable("outbound_messages").set({ status: "awaiting_credentials", last_error: message }).where("id", "=", messageId).execute();
      return { outcome: "awaiting_credentials", reason: message };
    }
    if (e instanceof PermanentIntegrationError || e instanceof TemplateError) {
      // No se va a reintentar: el link de un solo uso no tiene por qué quedar guardado.
      await markFailedAndRedact(db, messageId, message);
      throw new PermanentJobError(message);
    }
    // Reintentable: se conserva el payload completo para el próximo intento (si el job muere, lo redacta onDead).
    await db.updateTable("outbound_messages").set({ status: "failed", last_error: message }).where("id", "=", messageId).execute();
    throw e;
  }
}

/** Marca `failed` (salvo que ya se haya enviado) y redacta los datos de un solo uso. */
async function markFailedAndRedact(db: Database, messageId: string, error: string | null): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const m = await trx.selectFrom("outbound_messages").select(["id", "status", "template_key", "payload", "last_error"]).where("id", "=", messageId).forUpdate().executeTakeFirst();
    if (!m) return;
    const delivered = ["sent", "delivered"].includes(m.status);
    await trx
      .updateTable("outbound_messages")
      .set({
        ...(delivered || m.status === "cancelled" ? {} : { status: "failed", last_error: (error ?? m.last_error ?? "Envío abandonado").slice(0, 1000) }),
        payload: JSON.stringify(redactSensitive(m.template_key, (m.payload ?? {}) as Record<string, unknown>)),
      })
      .where("id", "=", m.id)
      .execute();
  });
}

/** El job de envío murió (intentos agotados o lease vencido): no va a haber otro intento → se redacta. */
registerJobDeadHandler("messaging.send", async (payload, ctx) => {
  const id = typeof payload.messageId === "string" ? payload.messageId : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await markFailedAndRedact(ctx.db, id, `Envío abandonado: ${ctx.error}`);
});

/**
 * Mensajes que ya no se van a enviar (link vencido, o esperando credenciales fuera de la ventana de reanudación de 7 días):
 * pasan a `cancelled` y se redactan los datos de un solo uso. Corre con la tarea horaria de reanudación.
 */
export async function redactUndeliverableMessages(db: Database, limit = 500): Promise<{ cancelled: number }> {
  const staleBefore = new Date(Date.now() - RESUME_WINDOW_MS);
  const candidates = await db
    .selectFrom("outbound_messages")
    .select(["id", "status", "created_at", sql<string | null>`payload->>'expiresAt'`.as("expires_at")])
    .where("status", "in", ["queued", "failed", "awaiting_credentials"])
    .where((eb) => eb.or([eb.and([eb("status", "=", "awaiting_credentials"), eb("created_at", "<=", staleBefore)]), sql<boolean>`jsonb_exists(payload, 'expiresAt')`]))
    .orderBy("created_at")
    .limit(limit)
    .execute();
  const rows = candidates.filter((r) => {
    if (r.status === "awaiting_credentials" && r.created_at <= staleBefore) return true;
    const expires = r.expires_at ? Date.parse(r.expires_at) : Number.NaN;
    return Number.isFinite(expires) && expires < Date.now();
  });
  let cancelled = 0;
  for (const r of rows) {
    const done = await db.transaction().execute(async (trx) => {
      const m = await trx.selectFrom("outbound_messages").select(["id", "status", "template_key", "payload"]).where("id", "=", r.id).forUpdate().executeTakeFirst();
      if (!m || !["queued", "failed", "awaiting_credentials"].includes(m.status)) return false;
      const reason = m.status === "awaiting_credentials" ? "No se pudo enviar: siguió sin credenciales más de 7 días" : "Venció antes de poder enviarse (contenía un link temporal)";
      await trx
        .updateTable("outbound_messages")
        .set({ status: "cancelled", last_error: reason, payload: JSON.stringify(redactSensitive(m.template_key, (m.payload ?? {}) as Record<string, unknown>)) })
        .where("id", "=", m.id)
        .execute();
      return true;
    });
    if (done) cancelled++;
  }
  if (cancelled) log.info("messaging.undeliverable_cancelled", { cancelled });
  return { cancelled };
}

registerJobHandler("messaging.send", async (payload, ctx) => {
  const id = typeof payload.messageId === "string" ? payload.messageId : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PermanentJobError("messaging.send: messageId inválido");
  return sendQueuedMessage(ctx.db, id);
});

/**
 * Cuando se cargan credenciales o se enciende el flag, los mensajes que quedaron en awaiting_credentials
 * (últimos 7 días) vuelven a la cola. Los que tenían links temporales vencidos se cancelan al procesarse.
 */
export async function resumeAwaitingMessages(db: Database, limit = 200): Promise<{ requeued: number }> {
  let requeued = 0;
  for (const channel of ["email", "whatsapp"] as const) {
    const ready = await readiness(db, channel);
    if (!ready.ready) continue;
    const rows = await db
      .selectFrom("outbound_messages")
      .select("id")
      .where("status", "=", "awaiting_credentials")
      .where("channel", "=", channel)
      .where("created_at", ">", new Date(Date.now() - RESUME_WINDOW_MS))
      .orderBy("created_at")
      .limit(limit)
      .execute();
    for (const r of rows) {
      const updated = await db.updateTable("outbound_messages").set({ status: "queued" }).where("id", "=", r.id).where("status", "=", "awaiting_credentials").executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) continue;
      await enqueue(db, { type: "messaging.send", payload: { messageId: r.id }, dedupeKey: `messaging.send:${r.id}`, maxAttempts: 6 });
      requeued++;
    }
  }
  if (requeued) log.info("messaging.resumed", { requeued });
  return { requeued };
}

registerJobHandler("messaging.resume_awaiting", async (_p, ctx) => {
  try {
    const undeliverable = await redactUndeliverableMessages(ctx.db);
    return { ...(await resumeAwaitingMessages(ctx.db)), ...undeliverable };
  } catch (e) {
    log.error("messaging.resume_failed", errorFields(e));
    throw e;
  }
});
addScheduledTask({ type: "messaging.resume_awaiting", every: "hourly" });
