/**
 * Webhook entrante de WhatsApp y procesamiento de cada evento.
 * - Recepción: firma HMAC verificada sobre el cuerpo crudo, un registro por mensaje/estado en webhook_events
 *   (único por proveedor + id externo), respuesta rápida y job `whatsapp.process_inbound` por evento nuevo.
 * - Procesamiento (job, idempotente): contacto único, conversación por número, mensaje por wamid, lead de WhatsApp
 *   y ruteo (asistente de IA o persona). Los estados de Meta actualizan los mensajes salientes.
 */
import { createHash } from "node:crypto";
import { sql, type Database } from "../../db";
import type { SystemActor } from "../../auth/actor";
import { isEnabled } from "../../flags";
import { enqueue } from "../../jobs/queue";
import { PermanentJobError } from "../../jobs/registry";
import { log } from "../../log";
import { rateLimit } from "../../rate-limit";
import { notifyUser } from "../../notifications";
import { captureLead } from "../../leads/capture";
import { resolveContactForCapture } from "../../contacts/service";
import { handoffConversation } from "../../conversations/service";
import { AI_REPLY_JOB_TIMEOUT_MS } from "../../ai/whatsapp/agent";
import { markAwaitingCredentials } from "../credentials";
import { WHATSAPP_INTEGRATION_KEY, WHATSAPP_PROVIDER } from "./config";
import { parseWebhook, type InboundMessageEvent, type StatusEvent, type WebhookEvent } from "./payload";
import { verifySignature } from "./signature";

export const PROCESS_INBOUND_JOB = "whatsapp.process_inbound";
export const AI_REPLY_JOB = "whatsapp.ai_reply";
export const MAX_WEBHOOK_BYTES = 1_000_000;

export type IngestResult = { status: number; body: Record<string, unknown>; newEvents: number };

export async function ingestWhatsAppWebhook(
  db: Database,
  input: { rawBody: string; signature: string | null; ip: string | null; env?: NodeJS.ProcessEnv },
): Promise<IngestResult> {
  const env = input.env ?? process.env;
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    await markAwaitingCredentials(db, WHATSAPP_INTEGRATION_KEY, ["WHATSAPP_APP_SECRET"]);
    log.warn("whatsapp.webhook_not_configured", {});
    return { status: 503, body: { error: "not_configured" }, newEvents: 0 };
  }
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "too_large" }, newEvents: 0 };

  if (!verifySignature(input.rawBody, input.signature, appSecret)) {
    // Se registra (sin el contenido no verificado) con límite por IP para que un atacante no llene la tabla.
    const allowed = input.ip ? (await rateLimit(db, `whatsapp:webhook:invalid:${input.ip}`, 20, 600)).allowed : true;
    if (allowed) {
      const sha256 = createHash("sha256").update(input.rawBody).digest("hex");
      await db
        .insertInto("webhook_events")
        .values({
          provider: WHATSAPP_PROVIDER,
          external_event_id: `invalid_signature:${sha256}`,
          signature_valid: false,
          payload: JSON.stringify({ sha256, bytes: Buffer.byteLength(input.rawBody, "utf8"), signaturePresent: Boolean(input.signature) }),
          status: "ignored",
          last_error: "firma X-Hub-Signature-256 inválida",
        })
        .onConflict((oc) => oc.columns(["provider", "external_event_id"]).doNothing())
        .execute();
    }
    log.warn("whatsapp.webhook_invalid_signature", { ip: input.ip, signaturePresent: Boolean(input.signature) });
    return { status: 401, body: { error: "invalid_signature" }, newEvents: 0 };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" }, newEvents: 0 };
  }
  const parsed = parseWebhook(json);
  if (!parsed.ok) {
    // Firmado por Meta pero de otro producto/forma: se confirma para que no reintente durante 7 días.
    log.warn("whatsapp.webhook_unsupported", { error: parsed.error });
    return { status: 200, body: { received: 0, ignored: parsed.error }, newEvents: 0 };
  }

  const expectedPhoneId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
  let newEvents = 0;
  await db.transaction().execute(async (trx) => {
    for (const ev of parsed.events) {
      const foreign = Boolean(expectedPhoneId && ev.phoneNumberId && ev.phoneNumberId !== expectedPhoneId);
      const row = await trx
        .insertInto("webhook_events")
        .values({
          provider: WHATSAPP_PROVIDER,
          external_event_id: ev.externalEventId,
          signature_valid: true,
          payload: JSON.stringify(ev),
          status: foreign ? "ignored" : "received",
          last_error: foreign ? "phone_number_id distinto del configurado" : null,
        })
        .onConflict((oc) => oc.columns(["provider", "external_event_id"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!row || foreign) continue;
      newEvents++;
      await enqueue(trx, {
        type: PROCESS_INBOUND_JOB,
        payload: { webhookEventId: row.id },
        dedupeKey: `${PROCESS_INBOUND_JOB}:${row.id}`,
        maxAttempts: 6,
        timeoutMs: 60_000,
        priority: ev.kind === "message" ? 40 : 60,
      });
    }
  });
  return { status: 200, body: { received: parsed.events.length, new: newEvents }, newEvents };
}

// ───────────────────────────── Procesamiento ─────────────────────────────

export async function processWebhookEvent(db: Database, actor: SystemActor, webhookEventId: string): Promise<Record<string, unknown>> {
  const claimed = await sql<{ payload: WebhookEvent }>`
    update webhook_events set status = 'processing', attempts = attempts + 1
     where id = ${webhookEventId} and provider = ${WHATSAPP_PROVIDER} and signature_valid and status in ('received', 'processing', 'failed')
    returning payload`.execute(db);
  const row = claimed.rows[0];
  if (!row) return { skipped: "ya procesado o ignorado" };
  const ev = row.payload;
  try {
    const result = ev.kind === "message" ? await processInboundMessage(db, actor, ev) : await processStatus(db, ev);
    await db
      .updateTable("webhook_events")
      .set({ status: result.ignored ? "ignored" : "processed", processed_at: new Date(), last_error: typeof result.ignored === "string" ? result.ignored : null })
      .where("id", "=", webhookEventId)
      .execute();
    return result;
  } catch (e) {
    await db
      .updateTable("webhook_events")
      .set({ status: "failed", last_error: ((e as Error).message ?? String(e)).slice(0, 1000) })
      .where("id", "=", webhookEventId)
      .execute();
    throw e;
  }
}

const TEXT_KINDS = new Set(["text", "button", "interactive"]);

export async function leadReuseDays(db: Database): Promise<number> {
  const s = await db.selectFrom("settings").select("value").where("key", "=", "whatsapp.lead_reuse_days").executeTakeFirst();
  const n = Number(s?.value);
  return Number.isInteger(n) && n > 0 && n <= 365 ? n : 30;
}

export async function processInboundMessage(db: Database, actor: SystemActor, ev: InboundMessageEvent): Promise<Record<string, unknown>> {
  if (ev.messageKind === "reaction") return { ignored: "reacción" };
  const sentAt = new Date(Math.min(ev.timestamp * 1000, Date.now()));

  const stored = await db.transaction().execute(async (trx) => {
    // Conversación existente con contacto: se reutiliza (evita crear contactos si el teléfono es ambiguo)
    const existing = await trx.selectFrom("conversations").select(["contact_id"]).where("channel", "=", "whatsapp").where("external_thread_id", "=", ev.waId).executeTakeFirst();
    const contactId =
      existing?.contact_id ??
      (await resolveContactForCapture(trx, actor, { name: ev.profileName, phone: `+${ev.waId}`, phoneIsWhatsapp: true, source: "whatsapp" })).contactId;
    const conv = await sql<{ id: string }>`
      insert into conversations(channel, external_thread_id, contact_id, mode)
      values ('whatsapp', ${ev.waId}, ${contactId}, 'bot')
      on conflict (channel, external_thread_id) do update set contact_id = coalesce(conversations.contact_id, excluded.contact_id)
      returning id`.execute(trx);
    const conversationId = conv.rows[0]!.id;
    const current = await trx.selectFrom("conversations").select(["id", "mode", "assigned_user_id", "contact_id"]).where("id", "=", conversationId).forUpdate().executeTakeFirstOrThrow();

    const inserted = await sql<{ id: string }>`
      insert into conversation_messages(conversation_id, direction, sender_kind, body, kind, payload, external_message_id, status, created_at)
      values (${conversationId}, 'inbound', 'contact', ${ev.text}, ${ev.messageKind}, ${JSON.stringify({ whatsapp: ev.raw })}::jsonb,
              ${ev.messageId}, 'received', ${sentAt})
      on conflict (conversation_id, external_message_id) where external_message_id is not null do nothing
      returning id`.execute(trx);
    const isNew = Boolean(inserted.rows[0]);
    const messageId =
      inserted.rows[0]?.id ??
      (await trx.selectFrom("conversation_messages").select("id").where("conversation_id", "=", conversationId).where("external_message_id", "=", ev.messageId).executeTakeFirstOrThrow()).id;

    let mode = current.mode;
    if (isNew) {
      // Un mensaje nuevo reabre una conversación cerrada (la atiende el asistente si está activo, si no una persona)
      if (mode === "closed") mode = "bot";
      await sql`
        update conversations set
          last_inbound_at = greatest(coalesce(last_inbound_at, ${sentAt}), ${sentAt}),
          last_message_at = greatest(coalesce(last_message_at, ${sentAt}), ${sentAt}),
          mode = ${mode}, closed_at = case when mode = 'closed' then null else closed_at end,
          handoff_reason = case when mode = 'closed' then null else handoff_reason end,
          ai_failures = case when mode = 'closed' then 0 else ai_failures end
        where id = ${conversationId}`.execute(trx);
    }
    return { conversationId, contactId: current.contact_id ?? contactId, messageId, isNew, mode, assignedUserId: current.assigned_user_id };
  });

  const lead = await ensureWhatsAppLead(db, actor, { ...stored, ev });

  // Ruteo: idempotente aunque el job se repita (dedupe del job de IA + derivación que solo actúa en modo bot)
  let routed: string;
  if (stored.mode === "bot") {
    const botOn = await isEnabled(db, "whatsapp_ai_bot");
    if (!botOn) {
      await handoffConversation(db, actor, { conversationId: stored.conversationId, reason: "bot_disabled" });
      routed = "human:bot_disabled";
    } else if (!TEXT_KINDS.has(ev.messageKind) || !ev.text?.trim()) {
      await handoffConversation(db, actor, {
        conversationId: stored.conversationId,
        reason: ev.messageKind === "document" ? "documents" : "unsupported_message",
        detail: `tipo ${ev.messageKind}`,
      });
      routed = "human:unsupported";
    } else {
      await enqueue(db, {
        type: AI_REPLY_JOB,
        payload: { conversationId: stored.conversationId, messageId: stored.messageId },
        dedupeKey: `${AI_REPLY_JOB}:${stored.messageId}`,
        maxAttempts: 3,
        timeoutMs: AI_REPLY_JOB_TIMEOUT_MS,
        priority: 40,
      });
      routed = "bot";
    }
  } else {
    routed = "human";
    if (stored.isNew && stored.mode === "human" && stored.assignedUserId) {
      const hour = new Date().toISOString().slice(0, 13);
      await notifyUser(db, stored.assignedUserId, {
        kind: "conversation.message",
        title: "Nuevo mensaje de WhatsApp",
        body: (ev.text ?? `[${ev.messageKind}]`).slice(0, 200),
        link: `/crm/conversaciones/${stored.conversationId}`,
        entityType: "conversation",
        entityId: stored.conversationId,
        dedupeKey: `whatsapp:msg:${stored.conversationId}:${hour}`,
      });
    }
  }
  return { conversationId: stored.conversationId, messageId: stored.messageId, duplicate: !stored.isNew, leadId: lead.leadId, leadCreated: lead.created, routed };
}

async function ensureWhatsAppLead(
  db: Database,
  actor: SystemActor,
  s: { conversationId: string; contactId: string; messageId: string; isNew: boolean; ev: InboundMessageEvent },
): Promise<{ leadId: string; created: boolean }> {
  const days = await leadReuseDays(db);
  // Clave de idempotencia: conversación + número de lead. Un reintento del mismo mensaje o dos mensajes
  // procesados en paralelo calculan la misma clave y no duplican el lead. Se cuenta ANTES de buscar el lead
  // abierto: si otro proceso lo crea entre ambas consultas, o se encuentra o la clave choca.
  const seq = await db
    .selectFrom("leads")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("conversation_id", "=", s.conversationId)
    .executeTakeFirstOrThrow();
  const open = await db
    .selectFrom("leads")
    .select(["id", "conversation_id", "external_id"])
    .where("contact_id", "=", s.contactId)
    .where("source_key", "=", "whatsapp")
    .where("status", "in", ["new", "contacted", "qualified"])
    .where("deleted_at", "is", null)
    .where("created_at", ">", sql<Date>`now() - make_interval(days => ${days})`)
    .orderBy("created_at", "desc")
    .executeTakeFirst();

  if (open) {
    await db.transaction().execute(async (trx) => {
      if (!open.conversation_id) await trx.updateTable("leads").set({ conversation_id: s.conversationId }).where("id", "=", open.id).where("conversation_id", "is", null).execute();
      const already = await trx
        .selectFrom("activities")
        .select("id")
        .where("entity_type", "=", "lead")
        .where("entity_id", "=", open.id)
        .where(sql<string>`metadata->>'messageId'`, "=", s.messageId)
        .executeTakeFirst();
      // El mensaje que originó el lead ya está en el lead: no se duplica como actividad
      if (!already && open.external_id !== s.ev.messageId.slice(0, 200)) {
        await trx
          .insertInto("activities")
          .values({
            entity_type: "lead",
            entity_id: open.id,
            kind: "whatsapp_message",
            summary: `Nuevo mensaje por WhatsApp: ${(s.ev.text ?? `[${s.ev.messageKind}]`).slice(0, 140)}`,
            metadata: JSON.stringify({ messageId: s.messageId, conversationId: s.conversationId }),
          })
          .execute();
      }
    });
    return { leadId: open.id, created: false };
  }

  const r = await captureLead(db, actor, {
    name: s.ev.profileName,
    phone: `+${s.ev.waId}`,
    phoneIsWhatsapp: true,
    message: s.ev.text?.slice(0, 5000) ?? `[${s.ev.messageKind}]`,
    sourceKey: "whatsapp",
    conversationId: s.conversationId,
    externalId: s.ev.messageId.slice(0, 200),
    idempotencyKey: `whatsapp:${s.conversationId}:${Number(seq.n) + 1}`,
  });
  return { leadId: r.leadId, created: !r.duplicate };
}

const STATUS_RANK: Record<string, number> = { queued: 0, awaiting_credentials: 0, failed: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

export async function processStatus(db: Database, ev: StatusEvent): Promise<Record<string, unknown>> {
  if (ev.status === "other") return { ignored: `estado ${ev.rawStatus}` };
  const msg = await db
    .selectFrom("conversation_messages")
    .select(["id", "status"])
    .where("external_message_id", "=", ev.messageId)
    .where("direction", "=", "outbound")
    .executeTakeFirst();
  if (!msg) {
    // El webhook puede llegar antes de que guardemos el wamid devuelto por la API: se reintenta un rato.
    if (Date.now() - ev.timestamp * 1000 < 15 * 60_000) throw new Error(`Mensaje ${ev.messageId} todavía no registrado`);
    return { ignored: "mensaje saliente desconocido" };
  }
  const at = new Date(ev.timestamp * 1000);
  if (ev.status === "failed") {
    if ((STATUS_RANK[msg.status] ?? 0) >= STATUS_RANK.delivered!) return { ignored: "falla posterior a la entrega" };
    const detail = [ev.error?.title, ev.error?.detail].filter(Boolean).join(": ") || "WhatsApp informó una falla de entrega";
    await db
      .updateTable("conversation_messages")
      .set({ status: "failed", failed_at: at, status_updated_at: new Date(), error: detail.slice(0, 500), error_code: ev.error?.code ?? null })
      .where("id", "=", msg.id)
      .execute();
    return { messageId: msg.id, status: "failed" };
  }
  const column = ev.status === "sent" ? "sent_at" : ev.status === "delivered" ? "delivered_at" : "read_at";
  const r = await sql`
    update conversation_messages set status = ${ev.status}, ${sql.ref(column)} = coalesce(${sql.ref(column)}, ${at}),
      sent_at = coalesce(sent_at, ${at}), status_updated_at = now(), error = null, error_code = null
    where id = ${msg.id}
      and (case status when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 when 'sending' then 1 else 0 end) < ${STATUS_RANK[ev.status]!}`.execute(db);
  if (Number(r.numAffectedRows ?? 0) === 0) return { messageId: msg.id, status: msg.status, unchanged: true };
  return { messageId: msg.id, status: ev.status };
}

export function assertWebhookEventId(payload: Record<string, unknown>): string {
  const id = payload.webhookEventId;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new PermanentJobError("webhookEventId inválido");
  return id;
}
