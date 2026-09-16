import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { resetFlagCache } from "@/server/flags";
import { runJobs } from "@/server/jobs/runner";
import { ingestWhatsAppWebhook, processInboundMessage, processWebhookEvent } from "@/server/integrations/whatsapp/inbound";
import { deliverConversationMessage, MSG_FLAG_OFF, MSG_NO_CREDENTIALS, MSG_WINDOW_EXPIRED } from "@/server/integrations/whatsapp/outbound";
import { parseWebhook, type InboundMessageEvent } from "@/server/integrations/whatsapp/payload";
import { closeConversation, replyAsHuman, retryOutboundMessage, returnToBot, takeConversation } from "@/server/conversations/service";
import { getConversation, listConversations } from "@/server/conversations/queries";
import { AppError } from "@/server/errors";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { inboundTextPayload, signed, statusPayload, TEST_APP_SECRET, whatsappEnv } from "../helpers/whatsapp";

const SECRET_VARS = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY", "WHATSAPP_REENGAGEMENT_TEMPLATE"];

async function setFlag(key: string, enabled: boolean) {
  await testDb().updateTable("feature_flags").set({ enabled }).where("key", "=", key).execute();
  resetFlagCache();
}

function eventFrom(body: unknown): InboundMessageEvent {
  const r = parseWebhook(body);
  if (!r.ok || r.events[0]?.kind !== "message") throw new Error("payload de prueba inválido");
  return r.events[0];
}

let waSeq = 0;
const newWaId = () => `549387555${String(1000 + ++waSeq).padStart(4, "0")}`;

beforeAll(async () => {
  for (const v of SECRET_VARS) delete process.env[v];
  await sql`delete from jobs`.execute(testDb());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webhook de WhatsApp", () => {
  it("sin App Secret: 503 y la integración queda awaiting_credentials", async () => {
    const db = testDb();
    await db.updateTable("integrations").set({ status: "active" }).where("key", "=", "whatsapp_cloud").execute();
    const { rawBody, signature } = signed(inboundTextPayload({ waId: newWaId(), text: "hola" }).body);
    const r = await ingestWhatsAppWebhook(db, { rawBody, signature, ip: "1.2.3.4", env: { NODE_ENV: "test" } as NodeJS.ProcessEnv });
    expect(r.status).toBe(503);
    const i = await db.selectFrom("integrations").select("status").where("key", "=", "whatsapp_cloud").executeTakeFirstOrThrow();
    expect(i.status).toBe("awaiting_credentials");
  });

  it("firma inválida → 401, se registra con signature_valid=false y no se procesa", async () => {
    const db = testDb();
    const { rawBody } = signed(inboundTextPayload({ waId: newWaId(), text: "hola" }).body);
    const forged = signed(JSON.parse(rawBody), "otro-secreto").signature;
    const r = await ingestWhatsAppWebhook(db, { rawBody, signature: forged, ip: "9.9.9.9", env: whatsappEnv() });
    expect(r.status).toBe(401);
    const rows = await db.selectFrom("webhook_events").select(["signature_valid", "status", "payload"]).where("signature_valid", "=", false).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ignored");
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("hola");
    const jobs = await db.selectFrom("jobs").select("id").where("type", "=", "whatsapp.process_inbound").execute();
    expect(jobs).toHaveLength(0);
  });

  it("webhook válido → evento + job; el mismo webhook repetido responde 200 sin reprocesar", async () => {
    const db = testDb();
    const p = inboundTextPayload({ waId: newWaId(), text: "Hola, busco casa" });
    const { rawBody, signature } = signed(p.body, TEST_APP_SECRET);
    const first = await ingestWhatsAppWebhook(db, { rawBody, signature, ip: "1.1.1.1", env: whatsappEnv() });
    expect(first).toMatchObject({ status: 200, newEvents: 1 });
    const second = await ingestWhatsAppWebhook(db, { rawBody, signature, ip: "1.1.1.1", env: whatsappEnv() });
    expect(second).toMatchObject({ status: 200, newEvents: 0 });
    const events = await db.selectFrom("webhook_events").select(["id", "status"]).where("external_event_id", "=", `message:${p.wamid}`).execute();
    expect(events).toHaveLength(1);
    const jobs = await db.selectFrom("jobs").select("payload").where("type", "=", "whatsapp.process_inbound").execute();
    expect(jobs).toHaveLength(1);

    // Procesar dos veces el mismo evento: la segunda no hace nada
    const actor = await testSystemActor(db);
    await setFlag("whatsapp_ai_bot", false);
    const r1 = await processWebhookEvent(db, actor, events[0]!.id);
    const r2 = await processWebhookEvent(db, actor, events[0]!.id);
    expect(r1).toMatchObject({ duplicate: false, leadCreated: true });
    expect(r2).toEqual({ skipped: "ya procesado o ignorado" });
  });

  it("eventos de otro número de WhatsApp Business se ignoran", async () => {
    const db = testDb();
    const p = inboundTextPayload({ waId: newWaId(), text: "hola" });
    const { rawBody, signature } = signed(p.body);
    const r = await ingestWhatsAppWebhook(db, { rawBody, signature, ip: null, env: whatsappEnv({ WHATSAPP_PHONE_NUMBER_ID: "999" }) });
    expect(r.newEvents).toBe(0);
    const ev = await db.selectFrom("webhook_events").select("status").where("external_event_id", "=", `message:${p.wamid}`).executeTakeFirstOrThrow();
    expect(ev.status).toBe("ignored");
  });
});

describe("procesamiento de mensajes entrantes", () => {
  it("crea contacto, conversación, mensaje y lead; el mismo mensaje dos veces no duplica nada", async () => {
    const db = testDb();
    const actor = await testSystemActor(db);
    await setFlag("whatsapp_ai_bot", true);
    const waId = newWaId();
    const ev = eventFrom(inboundTextPayload({ waId, text: "Hola, quiero info de departamentos", name: "Laura Gómez" }).body);

    const a = await processInboundMessage(db, actor, ev);
    const b = await processInboundMessage(db, actor, ev);
    expect(a).toMatchObject({ duplicate: false, leadCreated: true, routed: "bot" });
    expect(b).toMatchObject({ duplicate: true, leadCreated: false, leadId: a.leadId });

    const conv = await db.selectFrom("conversations").selectAll().where("external_thread_id", "=", waId).execute();
    expect(conv).toHaveLength(1);
    const msgs = await db.selectFrom("conversation_messages").select(["direction", "body"]).where("conversation_id", "=", conv[0]!.id).execute();
    expect(msgs).toEqual([{ direction: "inbound", body: "Hola, quiero info de departamentos" }]);
    const contact = await db.selectFrom("contacts").select("display_name").where("id", "=", conv[0]!.contact_id!).executeTakeFirstOrThrow();
    expect(contact.display_name).toBe("Laura Gómez");
    const phone = await db.selectFrom("contact_phones").select(["phone_e164", "is_whatsapp"]).where("contact_id", "=", conv[0]!.contact_id!).executeTakeFirstOrThrow();
    expect(phone).toEqual({ phone_e164: `+${waId}`, is_whatsapp: true });
    const leads = await db.selectFrom("leads").select(["source_key", "conversation_id"]).where("contact_id", "=", conv[0]!.contact_id!).execute();
    expect(leads).toEqual([{ source_key: "whatsapp", conversation_id: conv[0]!.id }]);
    const aiJobs = await db.selectFrom("jobs").select("id").where("type", "=", "whatsapp.ai_reply").where(sql<string>`payload->>'conversationId'`, "=", conv[0]!.id).execute();
    expect(aiJobs).toHaveLength(1);

    // Segundo mensaje: mismo lead, con actividad
    const ev2 = eventFrom(inboundTextPayload({ waId, text: "¿Tienen en Tres Cerritos?", name: "Laura Gómez" }).body);
    const c = await processInboundMessage(db, actor, ev2);
    expect(c).toMatchObject({ leadId: a.leadId, leadCreated: false });
    const acts = await db.selectFrom("activities").select("kind").where("entity_id", "=", a.leadId as string).where("kind", "=", "whatsapp_message").execute();
    expect(acts).toHaveLength(1);
  });

  it("dos mensajes nuevos del mismo número procesados en paralelo: un contacto, una conversación, un lead", async () => {
    const db = testDb();
    const actor = await testSystemActor(db);
    await setFlag("whatsapp_ai_bot", true);
    const waId = newWaId();
    const [a, b] = await Promise.all([
      processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "Hola" }).body)),
      processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "¿Están?" }).body)),
    ]);
    expect(a.conversationId).toBe(b.conversationId);
    expect(a.leadId).toBe(b.leadId);
    const contacts = await db.selectFrom("contact_phones").select("contact_id").where("phone_e164", "=", `+${waId}`).execute();
    expect(contacts).toHaveLength(1);
    const leads = await db.selectFrom("leads").select("id").where("conversation_id", "=", a.conversationId as string).execute();
    expect(leads).toHaveLength(1);
  });

  it("flag whatsapp_ai_bot apagado → todo a humano con aviso a administración; el mensaje queda guardado", async () => {
    const db = testDb();
    const actor = await testSystemActor(db);
    const admin = await createStaff(db, ["administrador"]);
    await setFlag("whatsapp_ai_bot", false);
    const waId = newWaId();
    const r = await processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "Hola, ¿siguen alquilando?" }).body));
    expect(r.routed).toBe("human:bot_disabled");
    const conv = await db.selectFrom("conversations").select(["id", "mode", "handoff_reason"]).where("external_thread_id", "=", waId).executeTakeFirstOrThrow();
    expect(conv).toMatchObject({ mode: "human", handoff_reason: "bot_disabled" });
    const notes = await db.selectFrom("notifications").select(["kind", "body", "link"]).where("user_id", "=", admin.userId).where("kind", "=", "conversation.handoff").execute();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain("¿siguen alquilando?");
    expect(notes[0]!.link).toBe(`/crm/conversaciones/${conv.id}`);
    const msgs = await db.selectFrom("conversation_messages").select("body").where("conversation_id", "=", conv.id).execute();
    expect(msgs).toHaveLength(1);
    const events = await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", conv.id).execute();
    expect(events.map((e) => e.event_type)).toEqual(["conversation.handoff"]);
  });

  it("audio o foto sin texto → persona (la IA no los interpreta)", async () => {
    const db = testDb();
    const actor = await testSystemActor(db);
    await setFlag("whatsapp_ai_bot", true);
    const waId = newWaId();
    const r = await processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "", type: "audio", extra: { audio: { id: "media1" } } }).body));
    expect(r.routed).toBe("human:unsupported");
    const conv = await db.selectFrom("conversations").select(["mode", "handoff_reason"]).where("external_thread_id", "=", waId).executeTakeFirstOrThrow();
    expect(conv).toEqual({ mode: "human", handoff_reason: "unsupported_message" });
  });

  it("pipeline completo sin credenciales: la IA deriva y la respuesta automática queda visible como no enviada", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    await setFlag("whatsapp_ai_bot", true);
    await setFlag("outbound_whatsapp", true);
    const waId = newWaId();
    const p = inboundTextPayload({ waId, text: "Hola, busco un terreno" });
    const { rawBody, signature } = signed(p.body);
    await ingestWhatsAppWebhook(db, { rawBody, signature, ip: null, env: whatsappEnv() });
    await runJobs(db, { budgetMs: 10_000 });

    const conv = await db.selectFrom("conversations").select(["id", "mode", "handoff_reason"]).where("external_thread_id", "=", waId).executeTakeFirstOrThrow();
    expect(conv).toMatchObject({ mode: "human", handoff_reason: "ai_unavailable" });
    const out = await db.selectFrom("conversation_messages").select(["status", "error", "sender_kind"]).where("conversation_id", "=", conv.id).where("direction", "=", "outbound").execute();
    expect(out).toEqual([{ status: "awaiting_credentials", error: MSG_NO_CREDENTIALS, sender_kind: "bot" }]);
    const integrations = await db.selectFrom("integrations").select(["key", "status"]).where("key", "in", ["whatsapp_cloud", "anthropic"]).orderBy("key").execute();
    expect(integrations).toEqual([
      { key: "anthropic", status: "awaiting_credentials" },
      { key: "whatsapp_cloud", status: "awaiting_credentials" },
    ]);
    await setFlag("outbound_whatsapp", false);
  });
});

describe("envío y estados", () => {
  async function conversationWithReply(opts: { hoursSinceInbound?: number } = {}) {
    const db = testDb();
    const actor = await testSystemActor(db);
    await setFlag("whatsapp_ai_bot", false);
    const waId = newWaId();
    const ts = Math.floor(Date.now() / 1000) - Math.round((opts.hoursSinceInbound ?? 0) * 3600);
    await processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "Hola", timestamp: ts }).body));
    const conv = await db.selectFrom("conversations").select("id").where("external_thread_id", "=", waId).executeTakeFirstOrThrow();
    const agent = await createStaff(db, ["agente"]);
    const reply = await replyAsHuman(db, agent, { conversationId: conv.id, body: "Hola, ¿en qué te ayudo?", idempotencyKey: `k-${waId}` });
    return { db, waId, conversationId: conv.id, messageId: reply.messageId, agent };
  }

  it("flag outbound_whatsapp apagado → queda en cola con el motivo, sin llamar a Meta", async () => {
    const { db, messageId } = await conversationWithReply();
    await setFlag("outbound_whatsapp", false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await deliverConversationMessage(db, messageId, { env: whatsappEnv() });
    expect(r).toMatchObject({ result: "held", status: "queued" });
    expect(fetchMock).not.toHaveBeenCalled();
    const m = await db.selectFrom("conversation_messages").select(["status", "error"]).where("id", "=", messageId).executeTakeFirstOrThrow();
    expect(m).toEqual({ status: "queued", error: MSG_FLAG_OFF });
  });

  it("con credenciales (HTTP mockeado): envía, guarda el wamid y los estados solo avanzan", async () => {
    const { db, messageId, waId } = await conversationWithReply();
    await setFlag("outbound_whatsapp", true);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ messaging_product: "whatsapp", to: waId, type: "text", text: { body: "Hola, ¿en qué te ayudo?" } });
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token-no-real");
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: waId, wa_id: waId }], messages: [{ id: "wamid.SENT1" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await deliverConversationMessage(db, messageId, { env: whatsappEnv() });
    expect(r).toEqual({ result: "sent", wamid: "wamid.SENT1" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v26.0/100000000000001/messages");
    // Reintento del job: no reenvía
    expect(await deliverConversationMessage(db, messageId, { env: whatsappEnv() })).toMatchObject({ result: "skipped" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const actor = await testSystemActor(db);
    const push = async (status: string) => {
      const { rawBody, signature } = signed(statusPayload({ wamid: "wamid.SENT1", status, recipient: waId }));
      await ingestWhatsAppWebhook(db, { rawBody, signature, ip: null, env: whatsappEnv() });
      const ev = await db.selectFrom("webhook_events").select("id").where("external_event_id", "=", `status:wamid.SENT1:${status}`).executeTakeFirstOrThrow();
      return processWebhookEvent(db, actor, ev.id);
    };
    await push("read");
    await push("delivered"); // llega tarde: no retrocede
    const m = await db.selectFrom("conversation_messages").select(["status", "read_at", "delivered_at"]).where("id", "=", messageId).executeTakeFirstOrThrow();
    expect(m.status).toBe("read");
    expect(m.read_at).not.toBeNull();
    const integration = await db.selectFrom("integrations").select("status").where("key", "=", "whatsapp_cloud").executeTakeFirstOrThrow();
    expect(integration.status).toBe("active");
    await setFlag("outbound_whatsapp", false);
  });

  it("5xx de Meta se reintenta y luego envía; 131047 (ventana vencida) queda failed sin reintentar", async () => {
    const { db, messageId } = await conversationWithReply();
    await setFlag("outbound_whatsapp", true);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++calls === 1 ? new Response("upstream", { status: 502 }) : new Response(JSON.stringify({ messages: [{ id: "wamid.RETRY" }] }), { status: 200 }))),
    );
    expect(await deliverConversationMessage(db, messageId, { env: whatsappEnv(), sleep: async () => {} })).toEqual({ result: "sent", wamid: "wamid.RETRY" });
    expect(calls).toBe(2);

    const second = await conversationWithReply();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 })));
    const r = await deliverConversationMessage(db, second.messageId, { env: whatsappEnv(), sleep: async () => {} });
    expect(r).toMatchObject({ result: "failed", code: "131047" });
    const m = await db.selectFrom("conversation_messages").select(["status", "error"]).where("id", "=", second.messageId).executeTakeFirstOrThrow();
    expect(m).toEqual({ status: "failed", error: MSG_WINDOW_EXPIRED });
    await setFlag("outbound_whatsapp", false);
  });

  it("ventana de 24 h vencida localmente: no llama a Meta y lo explica; estado failed de Meta se refleja", async () => {
    const { db, messageId, waId } = await conversationWithReply({ hoursSinceInbound: 30 });
    await setFlag("outbound_whatsapp", true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await deliverConversationMessage(db, messageId, { env: whatsappEnv() })).toMatchObject({ result: "failed", code: "window_expired" });
    expect(fetchMock).not.toHaveBeenCalled();

    // Estado failed informado por webhook para un mensaje enviado
    await db.updateTable("conversation_messages").set({ status: "sent", external_message_id: "wamid.F1" }).where("id", "=", messageId).execute();
    const { rawBody, signature } = signed(statusPayload({ wamid: "wamid.F1", status: "failed", recipient: waId, errors: [{ code: 131026, title: "Message undeliverable" }] }));
    await ingestWhatsAppWebhook(db, { rawBody, signature, ip: null, env: whatsappEnv() });
    const ev = await db.selectFrom("webhook_events").select("id").where("external_event_id", "=", "status:wamid.F1:failed").executeTakeFirstOrThrow();
    await processWebhookEvent(db, await testSystemActor(db), ev.id);
    const m = await db.selectFrom("conversation_messages").select(["status", "error_code", "error"]).where("id", "=", messageId).executeTakeFirstOrThrow();
    expect(m).toEqual({ status: "failed", error_code: "131026", error: "Message undeliverable" });
    await setFlag("outbound_whatsapp", false);
  });
});

describe("acciones del equipo sobre conversaciones", () => {
  it("permisos, idempotencia de respuesta, tomar / devolver / cerrar y bandeja", async () => {
    const db = testDb();
    const actor = await testSystemActor(db);
    await setFlag("whatsapp_ai_bot", true);
    const waId = newWaId();
    await processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "Hola", name: "Pedro" }).body));
    const conv = await db.selectFrom("conversations").select("id").where("external_thread_id", "=", waId).executeTakeFirstOrThrow();

    const readonly = await createStaff(db, ["solo_lectura"]);
    const marketing = await createStaff(db, ["marketing"]);
    const agent = await createStaff(db, ["agente"]);
    await expect(replyAsHuman(db, readonly, { conversationId: conv.id, body: "x", idempotencyKey: "abcdefgh1" })).rejects.toBeInstanceOf(AppError);
    await expect(listConversations(db, marketing, {})).rejects.toThrow(/permiso/);

    const unanswered = await listConversations(db, agent, { unanswered: "1" });
    expect(unanswered.items.map((i) => i.id)).toContain(conv.id);

    // Doble click: un solo mensaje y un solo job
    const r1 = await replyAsHuman(db, agent, { conversationId: conv.id, body: "Hola Pedro", idempotencyKey: "doble-click-1" });
    const r2 = await replyAsHuman(db, agent, { conversationId: conv.id, body: "Hola Pedro", idempotencyKey: "doble-click-1" });
    expect(r2).toEqual({ messageId: r1.messageId, duplicate: true });
    const jobs = await db.selectFrom("jobs").select("id").where(sql<string>`payload->>'messageId'`, "=", r1.messageId).execute();
    expect(jobs).toHaveLength(1);

    let row = await db.selectFrom("conversations").select(["mode", "assigned_user_id", "handoff_reason"]).where("id", "=", conv.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ mode: "human", assigned_user_id: agent.userId, handoff_reason: "taken_by_agent" });
    const mine = await listConversations(db, agent, { mine: "1", view: "human" });
    expect(mine.items.map((i) => i.id)).toEqual([conv.id]);
    expect((await listConversations(db, agent, { unanswered: "1" })).items.map((i) => i.id)).not.toContain(conv.id);

    await returnToBot(db, agent, conv.id);
    row = await db.selectFrom("conversations").select(["mode", "assigned_user_id", "handoff_reason"]).where("id", "=", conv.id).executeTakeFirstOrThrow();
    expect(row.mode).toBe("bot");
    await takeConversation(db, agent, conv.id);
    await closeConversation(db, agent, conv.id);
    await expect(replyAsHuman(db, agent, { conversationId: conv.id, body: "x", idempotencyKey: "cerrada-1" })).rejects.toThrow(/cerrada/);

    // Detalle con historial y estado real del envío
    const detail = await getConversation(db, agent, conv.id);
    expect(detail.messages.map((m) => [m.direction, m.status])).toEqual([
      ["inbound", "received"],
      ["outbound", "queued"],
    ]);
    expect(detail.lead?.id).toBeTruthy();

    // Reintento manual
    await db.updateTable("conversation_messages").set({ status: "failed" }).where("id", "=", r1.messageId).execute();
    await sql`delete from jobs where payload->>'messageId' = ${r1.messageId}`.execute(db);
    await retryOutboundMessage(db, agent, r1.messageId);
    const again = await db.selectFrom("conversation_messages").select("status").where("id", "=", r1.messageId).executeTakeFirstOrThrow();
    expect(again.status).toBe("queued");

    const audits = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", conv.id).orderBy("id").execute();
    expect(audits.map((a) => a.action)).toEqual(["CONVERSATION_REPLIED", "CONVERSATION_RETURNED_TO_BOT", "CONVERSATION_TAKEN", "CONVERSATION_CLOSED", "CONVERSATION_MESSAGE_RETRY"]);

    // Un mensaje nuevo reabre la conversación cerrada
    await processInboundMessage(db, actor, eventFrom(inboundTextPayload({ waId, text: "Volví" }).body));
    const reopened = await db.selectFrom("conversations").select("mode").where("id", "=", conv.id).executeTakeFirstOrThrow();
    expect(reopened.mode).toBe("bot");
  });
});
