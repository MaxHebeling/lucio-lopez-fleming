import { beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/server/db";
import { resetFlagCache } from "@/server/flags";
import { processInboundMessage } from "@/server/integrations/whatsapp/inbound";
import { parseWebhook, type InboundMessageEvent } from "@/server/integrations/whatsapp/payload";
import { AI_CALL_TIMEOUT_MS, AI_REPLY_JOB_TIMEOUT_MS, MAX_TOOL_ROUNDS, runAssistantTurn, TURN_BUDGET_MS } from "@/server/ai/whatsapp/agent";
import { MAX_JOB_TIMEOUT_MS } from "@/server/jobs/queue";
import { runJobs } from "@/server/jobs/runner";
import { queueOutboundMessage } from "@/server/conversations/service";
import { RetryableError } from "@/server/resilience";
import "@/server/jobs/handlers";
import type { MessagesClient } from "@/server/ai/client";
import { HANDOFF_ACK_MESSAGE } from "@/server/conversations/labels";
import { PROMPT_VERSION } from "@/server/ai/whatsapp/prompt";
import { changeStatus, createProperty, publishProperty } from "@/server/properties/service";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { inboundTextPayload, whatsappEnv } from "../helpers/whatsapp";

const env = whatsappEnv();
let published: { code: number; slug: string };
let draftCode: number;
let seq = 0;

async function setFlag(key: string, enabled: boolean) {
  await testDb().updateTable("feature_flags").set({ enabled }).where("key", "=", key).execute();
  resetFlagCache();
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const db = testDb();
  await setFlag("whatsapp_ai_bot", true);
  const admin = await createStaff(db, ["administrador"]);
  const loc = await db.insertInto("locations").values({ kind: "neighborhood", name: "Tres Cerritos", slug: "tres-cerritos" }).returning("id").executeTakeFirstOrThrow();
  const p = await createProperty(db, admin, {
    title: "Casa con jardín en Tres Cerritos",
    typeKey: "casa",
    locationId: loc.id,
    bedrooms: 3,
    totalAreaM2: 420,
    coveredAreaM2: 180,
    addressStreet: "Calle Privada",
    addressNumber: "123",
    hideExactAddress: true,
    operations: [{ operation: "sale", currency: "USD", amount: 230000, priceHidden: false }],
  });
  await changeStatus(db, admin, p.id, "available");
  await db.insertInto("property_media").values({ property_id: p.id, kind: "image", source_url: "https://example.com/a.jpg", status: "verified", is_cover: true }).execute();
  await publishProperty(db, admin, p.id);
  published = { code: p.code, slug: p.slug };
  const draft = await createProperty(db, admin, {
    title: "Casa en borrador en Tres Cerritos",
    typeKey: "casa",
    locationId: loc.id,
    bedrooms: 3,
    operations: [{ operation: "sale", currency: "USD", amount: 99000, priceHidden: false }],
  });
  draftCode = draft.code;
});

async function inbound(text: string, opts: { waId?: string } = {}) {
  const db = testDb();
  const waId = opts.waId ?? `5493874440${String(100 + ++seq)}`;
  const r = parseWebhook(inboundTextPayload({ waId, text, name: "Ana Pérez" }).body);
  if (!r.ok) throw new Error("payload inválido");
  const ev = r.events[0] as InboundMessageEvent;
  const res = await processInboundMessage(db, await testSystemActor(db), ev);
  return { waId, conversationId: res.conversationId as string, messageId: res.messageId as string };
}

const usage = { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 };

function toolUse(name: string, input: Record<string, unknown>, id = `toolu_${++seq}`): Anthropic.Message {
  return {
    id: `msg_${seq}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage,
  } as unknown as Anthropic.Message;
}

function final(output: { reply: string; confidence?: string; handoff?: boolean; handoff_reason?: string; summary?: string }): Anthropic.Message {
  return {
    id: `msg_f${++seq}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: JSON.stringify({ confidence: "high", handoff: false, handoff_reason: "none", summary: "Busca casa en Tres Cerritos", ...output }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage,
  } as unknown as Anthropic.Message;
}

function fakeClient(responses: Array<Anthropic.Message | Error>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create: vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(structuredClone(body));
        const next = responses.shift();
        if (!next) throw new Error("sin respuesta preparada");
        if (next instanceof Error) throw next;
        return next;
      }),
    },
  };
  return { client, calls };
}

describe("asistente de WhatsApp con herramientas sobre la base real", () => {
  it("respuesta fundada en search_properties: se encola, se registra la interacción y se guardan las propiedades mostradas", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Hola, busco casa en Tres Cerritos");
    const link = `https://www.example.test/propiedades/${published.slug}`;
    const { client, calls } = fakeClient([
      toolUse("search_properties", { operation: "sale", property_type: "casa", locality: "tres cerritos" }),
      final({ reply: `Tenemos la casa código ${published.code} en venta a USD 230.000, con 180 m² cubiertos. Mirala acá: ${link}` }),
    ]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r.outcome).toBe("replied");

    // El modelo recibió solo la propiedad publicada, sin dirección exacta
    const toolResult = (calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    const result = JSON.parse(String(toolResult.content));
    expect(result.results.map((p: { code: number }) => p.code)).toEqual([published.code]);
    expect(result.results[0]).toMatchObject({ address: "No se informa la dirección exacta", link });
    expect(result.results[0].operations).toEqual([{ operation: "Venta", price: "USD 230.000" }]);
    expect(JSON.stringify(result)).not.toContain("Calle Privada");
    expect(result.results.map((p: { code: number }) => p.code)).not.toContain(draftCode);
    expect(JSON.stringify(result)).not.toContain("borrador");
    expect(calls[0]!.model).toBe("claude-sonnet-5");

    const out = await db.selectFrom("conversation_messages").select(["body", "sender_kind", "status", "reply_to_message_id"]).where("conversation_id", "=", conversationId).where("direction", "=", "outbound").execute();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sender_kind: "bot", status: "queued", reply_to_message_id: messageId });
    expect(out[0]!.body).toMatch(/^Hola, soy el asistente virtual de Lucio López Fleming\./);

    const ai = await db.selectFrom("ai_interactions").selectAll().where("conversation_id", "=", conversationId).executeTakeFirstOrThrow();
    expect(ai).toMatchObject({ status: "ok", prompt_version: PROMPT_VERSION, model: "claude-sonnet-5", input_tokens: 2400, output_tokens: 300, cache_read_input_tokens: 1600, rounds: 2, purpose: "whatsapp_reply" });
    // 2400×2 + 300×10 + 1600×0,2 micro-USD
    expect(Number(ai.cost_usd_micros)).toBe(8120);
    expect((ai.tool_calls as Array<{ name: string; ok: boolean }>).map((t) => [t.name, t.ok])).toEqual([["search_properties", true]]);

    const conv = await db.selectFrom("conversations").select(["mode", "summary", "collected"]).where("id", "=", conversationId).executeTakeFirstOrThrow();
    expect(conv.mode).toBe("bot");
    expect(conv.summary).toBe("Busca casa en Tres Cerritos");
    expect((conv.collected as { properties_shown: number[] }).properties_shown).toEqual([published.code]);

    // Repetir el job no genera otra respuesta ni otra llamada
    const again = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(again).toEqual({ outcome: "skipped", reason: "ya respondido" });
  });

  it("IA que alucina un precio → se descarta, se deriva a una persona y el cliente recibe solo el aviso fijo", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const { conversationId, messageId } = await inbound("¿Cuánto sale la casa de Tres Cerritos?");
    const { client } = fakeClient([
      toolUse("get_property", { code: published.code }),
      final({ reply: `La casa código ${published.code} sale USD 210.000 y la podés ver cuando quieras.` }),
    ]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r).toMatchObject({ outcome: "handoff", reason: "ai_guard" });

    const out = await db.selectFrom("conversation_messages").select("body").where("conversation_id", "=", conversationId).where("direction", "=", "outbound").execute();
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toContain(HANDOFF_ACK_MESSAGE);
    expect(out[0]!.body).not.toContain("210");

    const ai = await db.selectFrom("ai_interactions").select(["status", "guard_violations", "handoff_reason"]).where("conversation_id", "=", conversationId).executeTakeFirstOrThrow();
    expect(ai).toMatchObject({ status: "fallback", handoff_reason: "ai_guard", guard_violations: [{ kind: "amount", value: "210000" }] });
    const conv = await db.selectFrom("conversations").select(["mode", "handoff_reason"]).where("id", "=", conversationId).executeTakeFirstOrThrow();
    expect(conv).toEqual({ mode: "human", handoff_reason: "ai_guard" });
    const note = await db.selectFrom("notifications").select(["title", "body"]).where("user_id", "=", admin.userId).where("entity_id", "=", conversationId).executeTakeFirstOrThrow();
    expect(note.body).toContain("Ana Pérez");
    expect(note.body).toContain("¿Cuánto sale la casa de Tres Cerritos?");

    // En modo humano la IA no responde más
    const next = await inbound("¿Hola?", { waId: (await db.selectFrom("conversations").select("external_thread_id").where("id", "=", conversationId).executeTakeFirstOrThrow()).external_thread_id });
    const { client: c2 } = fakeClient([]);
    expect(await runAssistantTurn(db, await testSystemActor(db), next, { client: c2, env })).toEqual({ outcome: "skipped", reason: "modo human" });
    expect(c2.messages.create).not.toHaveBeenCalled();
  });

  it("mencionar un código o precio sin haber consultado herramientas en el turno también deriva", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Me interesa la que vi en la web");
    const { client } = fakeClient([final({ reply: `¡Genial! La propiedad #${published.code} está a USD 230.000.` })]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r).toMatchObject({ outcome: "handoff", reason: "ai_guard" });
  });

  it("presupuesto diario agotado → no se llama a la IA y la conversación va a una persona", async () => {
    const db = testDb();
    await db.updateTable("settings").set({ value: JSON.stringify(0.01) }).where("key", "=", "ai.daily_budget_usd").execute();
    await db.insertInto("ai_interactions").values({ purpose: "whatsapp_reply", prompt_version: PROMPT_VERSION, model: "claude-sonnet-5", status: "ok", cost_usd_micros: "20000" }).execute();
    const { conversationId, messageId } = await inbound("Hola, busco departamento");
    const { client } = fakeClient([]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r).toMatchObject({ outcome: "handoff", reason: "budget_exhausted" });
    expect(client.messages.create).not.toHaveBeenCalled();
    const ai = await db.selectFrom("ai_interactions").select("status").where("conversation_id", "=", conversationId).executeTakeFirstOrThrow();
    expect(ai.status).toBe("budget_exceeded");
    await sql`delete from ai_interactions where conversation_id is null`.execute(db);
    await db.updateTable("settings").set({ value: JSON.stringify(5) }).where("key", "=", "ai.daily_budget_usd").execute();
  });

  it("sin ANTHROPIC_API_KEY → awaiting_credentials y derivación", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Hola");
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { env: whatsappEnv() });
    expect(r).toMatchObject({ outcome: "handoff", reason: "ai_unavailable" });
    const i = await db.selectFrom("integrations").select("status").where("key", "=", "anthropic").executeTakeFirstOrThrow();
    expect(i.status).toBe("awaiting_credentials");
  });

  it("pedido de oferta o persona: regla determinista deriva sin llamar a la IA", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Ofrezco 200 mil por la casa, ¿aceptan?");
    const { client } = fakeClient([]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r).toMatchObject({ outcome: "handoff", reason: "negotiation" });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("request_visit crea una tarea para un asesor y nunca una cita confirmada", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("¿Puedo ir a verla el sábado a la mañana?");
    const { client } = fakeClient([
      toolUse("request_visit", { property_code: published.code, preferred_times: "sábado a la mañana" }),
      final({ reply: "Listo, registré tu pedido. Un asesor te va a contactar para coordinar día y horario." }),
    ]);
    const before = await db.selectFrom("appointments").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r.outcome).toBe("replied");
    const after = await db.selectFrom("appointments").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
    const tasks = await db.selectFrom("tasks").select(["title", "description", "status", "entity_type"]).where("dedupe_key", "like", `whatsapp:visit:${messageId}:%`).execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: `Coordinar visita a #${published.code}`, status: "open", entity_type: "lead" });
    expect(tasks[0]!.description).toContain("NO está confirmado");
  });

  it("record_requirements guarda necesidades y presupuesto; handoff_to_human deriva después de responder", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Busco alquilar un depto de 2 dormitorios, tengo 600 mil pesos por mes");
    const { client } = fakeClient([
      toolUse("record_requirements", { operation: "rent", property_types: ["departamento"], min_bedrooms: 2, budget_max: 600000, budget_currency: "ARS" }),
      toolUse("handoff_to_human", { reason: "other", note: "quiere asesoramiento" }),
      final({ reply: "Anotado: depto de 2 dormitorios hasta $ 600.000. Te va a escribir una persona del equipo.", handoff: true, handoff_reason: "other" }),
    ]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env });
    expect(r).toMatchObject({ outcome: "replied", handoff: "other" });
    const conv = await db.selectFrom("conversations").select(["mode", "collected"]).where("id", "=", conversationId).executeTakeFirstOrThrow();
    expect(conv.mode).toBe("human");
    expect((conv.collected as { requirements: Record<string, unknown> }).requirements).toMatchObject({ operation: "rent", min_bedrooms: 2, budget_max: 600000, budget_currency: "ARS" });
    const lead = await db.selectFrom("leads").select("operation_interest").where("conversation_id", "=", conversationId).executeTakeFirstOrThrow();
    expect(lead.operation_interest).toBe("rent");
  });

  it("errores repetidos de la IA: el primero se reintenta, el segundo deriva", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Hola, ¿qué casas tienen?");
    const actor = await testSystemActor(db);
    const bad = () => final({ reply: "" }); // salida inválida (vacía sin derivación)
    const { client } = fakeClient([bad(), bad()]);
    await expect(runAssistantTurn(db, actor, { conversationId, messageId }, { client, env })).rejects.toThrow(/Falla del asistente \(1\/2\)/);
    const r = await runAssistantTurn(db, actor, { conversationId, messageId }, { client, env });
    expect(r).toMatchObject({ outcome: "handoff", reason: "ai_error" });
    const statuses = await db.selectFrom("ai_interactions").select("status").where("conversation_id", "=", conversationId).execute();
    expect(statuses.map((s) => s.status)).toEqual(["invalid_output", "invalid_output"]);
  });

  it("errores de API reintentables se reintentan dentro del turno", async () => {
    const db = testDb();
    const { conversationId, messageId } = await inbound("Hola");
    const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
    const overloaded = new AnthropicSdk.InternalServerError(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers());
    const { client } = fakeClient([overloaded, final({ reply: "¡Hola! ¿Qué tipo de propiedad estás buscando?" })]);
    const r = await runAssistantTurn(db, await testSystemActor(db), { conversationId, messageId }, { client, env, sleep: async () => {} });
    expect(r.outcome).toBe("replied");
  });

  describe("tiempo acotado, job muerto y derivación idempotente", () => {
    it("presupuesto: rondas × timeout por llamada entra holgado en el timeout del job", () => {
      expect(MAX_TOOL_ROUNDS * AI_CALL_TIMEOUT_MS).toBeLessThanOrEqual(TURN_BUDGET_MS);
      expect(TURN_BUDGET_MS + 30_000).toBeLessThanOrEqual(AI_REPLY_JOB_TIMEOUT_MS);
      expect(AI_REPLY_JOB_TIMEOUT_MS).toBeLessThanOrEqual(MAX_JOB_TIMEOUT_MS);
    });

    it("la IA no responde: el turno termina dentro de su presupuesto (sin colgar el job) y a la segunda deriva", async () => {
      const db = testDb();
      const { conversationId, messageId } = await inbound("Hola, ¿tienen casas?");
      const actor = await testSystemActor(db);
      await sql`update integrations set circuit_open_until = null, consecutive_failures = 0 where key = 'anthropic'`.execute(db);
      let created = 0;
      const client: MessagesClient = {
        messages: {
          create: (_b, o) => {
            created++;
            return new Promise<Anthropic.Message>((_r, reject) => o?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
          },
        },
      };
      const t0 = Date.now();
      await expect(runAssistantTurn(db, actor, { conversationId, messageId }, { client, env, sleep: async () => {}, turnBudgetMs: 1_500, callTimeoutMs: 400 })).rejects.toBeInstanceOf(RetryableError);
      expect(Date.now() - t0).toBeLessThan(5_000);
      expect(created).toBeLessThanOrEqual(3);
      const r = await runAssistantTurn(db, actor, { conversationId, messageId }, { client, env, sleep: async () => {}, turnBudgetMs: 1_500, callTimeoutMs: 400 });
      expect(r).toMatchObject({ outcome: "handoff", reason: "ai_error" });
      const statuses = await db.selectFrom("ai_interactions").select("status").where("conversation_id", "=", conversationId).execute();
      expect(statuses.map((x) => x.status)).toEqual(["timeout", "timeout"]);
    });

    it("job de IA muerto (lease vencido en el último intento) → la conversación pasa a una persona con aviso al cliente y notificación", async () => {
      const db = testDb();
      await sql`delete from jobs`.execute(db);
      const admin = await createStaff(db, ["administrador"]);
      const { conversationId, messageId } = await inbound("Hola, quiero info de alquileres");
      await sql`delete from jobs`.execute(db);
      await sql`insert into jobs(type, payload, status, attempts, max_attempts, timeout_ms, locked_by, lease_expires_at, started_at)
        values ('whatsapp.ai_reply', ${JSON.stringify({ conversationId, messageId })}::jsonb, 'running', 3, 3, 150000, 'w-muerto', now() - interval '1 minute', now() - interval '4 minutes')`.execute(db);
      await runJobs(db, { budgetMs: 10_000 });
      const conv = await db.selectFrom("conversations").select(["mode", "handoff_reason"]).where("id", "=", conversationId).executeTakeFirstOrThrow();
      expect(conv).toEqual({ mode: "human", handoff_reason: "ai_error" });
      const out = await db.selectFrom("conversation_messages").select(["body", "sender_kind", "reply_to_message_id"]).where("conversation_id", "=", conversationId).where("direction", "=", "outbound").execute();
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ sender_kind: "bot", reply_to_message_id: messageId });
      expect(out[0]!.body).toContain(HANDOFF_ACK_MESSAGE);
      const notes = await db.selectFrom("notifications").select(["kind"]).where("user_id", "=", admin.userId).where("kind", "=", "conversation.handoff").execute();
      expect(notes.length).toBeGreaterThanOrEqual(1);
    });

    it("corte entre el aviso y la derivación: el reintento del job completa la derivación sin repetir el aviso", async () => {
      const db = testDb();
      const actor = await testSystemActor(db);
      const { conversationId, messageId } = await inbound("Quiero hacer una oferta por la casa");
      // Primer intento: encoló el aviso y se cortó antes de derivar
      await db.transaction().execute((trx) =>
        queueOutboundMessage(trx, { conversationId, senderKind: "bot", body: HANDOFF_ACK_MESSAGE, replyToMessageId: messageId, payload: { handoffAck: true, handoff: "negotiation" } }),
      );
      const { client } = fakeClient([]);
      const r = await runAssistantTurn(db, actor, { conversationId, messageId }, { client, env });
      expect(r).toMatchObject({ outcome: "handoff", reason: "negotiation" });
      const conv = await db.selectFrom("conversations").select(["mode", "handoff_reason"]).where("id", "=", conversationId).executeTakeFirstOrThrow();
      expect(conv).toEqual({ mode: "human", handoff_reason: "negotiation" });
      await runAssistantTurn(db, actor, { conversationId, messageId }, { client, env });
      const out = await db.selectFrom("conversation_messages").select(["body"]).where("conversation_id", "=", conversationId).where("direction", "=", "outbound").execute();
      expect(out).toHaveLength(1);
      expect(client.messages.create).not.toHaveBeenCalled();
    });

    it("corte entre la respuesta y la derivación: el reintento completa la derivación", async () => {
      const db = testDb();
      const actor = await testSystemActor(db);
      const { conversationId, messageId } = await inbound("Hola, busco casa");
      await db.transaction().execute((trx) =>
        queueOutboundMessage(trx, { conversationId, senderKind: "bot", body: "¡Hola! Te paso con un asesor.", replyToMessageId: messageId, payload: { handoff: "low_confidence" } }),
      );
      const { client } = fakeClient([]);
      const r = await runAssistantTurn(db, actor, { conversationId, messageId }, { client, env });
      expect(r).toMatchObject({ outcome: "replied", handoff: "low_confidence" });
      const conv = await db.selectFrom("conversations").select(["mode", "handoff_reason"]).where("id", "=", conversationId).executeTakeFirstOrThrow();
      expect(conv).toEqual({ mode: "human", handoff_reason: "low_confidence" });
    });
  });
});
