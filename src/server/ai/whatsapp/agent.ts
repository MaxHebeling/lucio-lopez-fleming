/**
 * Turno del asistente de WhatsApp: decide si responde la IA o una persona, ejecuta el loop de herramientas,
 * valida la salida (zod), aplica las guardas contra datos inventados y registra todo en ai_interactions.
 *
 * Orden de decisiones (todas en código):
 *  1. Conversación fuera de modo bot → la IA no responde.
 *  2. Flag whatsapp_ai_bot apagado → derivación a humano.
 *  3. Mensaje más nuevo pendiente / respuesta ya generada → nada (idempotencia).
 *  4. Reglas deterministas (pide persona, oferta, reserva, reclamo, documentos, cierre) → derivación.
 *  5. Sin ANTHROPIC_API_KEY → derivación. Presupuesto diario agotado → derivación.
 *  6. Loop con herramientas → salida JSON validada → guardas → respuesta en cola (y derivación si corresponde).
 *
 * Tiempo acotado: todo el turno tiene TURN_BUDGET_MS (holgado dentro del timeout del job) y cada llamada al modelo
 * AI_CALL_TIMEOUT_MS; si se agota el presupuesto cuenta como falla (y a la segunda, deriva). Respeta la cancelación
 * del job (`signal`). Si el job muere igual, `registerJobDeadHandler` deriva la conversación a una persona.
 *
 * Derivación + aviso al cliente son dos pasos (handoffConversation abre su propia transacción): se hacen idempotentes.
 * Primero se encola el mensaje (aviso o respuesta) con `payload.handoff` y después se deriva; si el proceso se corta
 * entre ambos, el reintento del job (o el dead handler) ve la derivación pendiente y la completa.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { sql, type Database, type Executor } from "../../db";
import type { SystemActor } from "../../auth/actor";
import { isEnabled } from "../../flags";
import { errorFields, log } from "../../log";
import { RetryableError, TimeoutError } from "../../resilience";
import { handoffConversation, queueOutboundMessage } from "../../conversations/service";
import { ASSISTANT_INTRO, HANDOFF_ACK_MESSAGE, type HandoffReason } from "../../conversations/labels";
import { aiModel, callModel, getAnthropicClient, type MessagesClient } from "../client";
import { budgetStatus } from "../budget";
import { estimateCostMicros, type TokenUsage } from "../pricing";
import { addCustomerText, emptyFacts, findViolations, type Violation } from "../guards";
import { assistantOutputSchema, contextBlock, OUTPUT_JSON_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, type AssistantOutput } from "./prompt";
import { executeTool, TOOL_DEFINITIONS, type ToolCallLog, type ToolContext } from "./tools";
import { detectHandoff } from "./rules";

export const MAX_TOOL_ROUNDS = 4;
/** Timeout del job whatsapp.ai_reply (lo usa inbound.ts al encolar). */
export const AI_REPLY_JOB_TIMEOUT_MS = 150_000;
/** Timeout de cada llamada al modelo. MAX_TOOL_ROUNDS × AI_CALL_TIMEOUT_MS ≤ TURN_BUDGET_MS. */
export const AI_CALL_TIMEOUT_MS = 25_000;
/** Presupuesto total del turno: deja ≥ 45 s del job para registrar, encolar y derivar. */
export const TURN_BUDGET_MS = 100_000;

export const HISTORY_MESSAGES = 20;
export const MAX_CONSECUTIVE_AI_FAILURES = 2;

export type TurnOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "replied"; messageId: string; interactionId: string; handoff: HandoffReason | null }
  | { outcome: "handoff"; reason: HandoffReason; interactionId?: string };

export type TurnDeps = {
  client?: MessagesClient | null;
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
  /** Cancelación del job (ctx.signal). */
  signal?: AbortSignal;
  /** Solo tests: presupuestos más cortos. */
  turnBudgetMs?: number;
  callTimeoutMs?: number;
};

type InteractionStatus = "ok" | "error" | "timeout" | "invalid_output" | "budget_exceeded" | "fallback";

async function recordInteraction(
  db: Executor,
  i: {
    conversationId: string;
    messageId: string;
    model: string;
    status: InteractionStatus;
    usage: TokenUsage;
    latencyMs: number;
    toolCalls: ToolCallLog[];
    error?: string | null;
    rounds: number;
    stopReason?: string | null;
    handoffReason?: string | null;
    violations?: Violation[];
  },
): Promise<string> {
  const row = await db
    .insertInto("ai_interactions")
    .values({
      purpose: "whatsapp_reply",
      conversation_id: i.conversationId,
      message_id: i.messageId,
      prompt_version: PROMPT_VERSION,
      model: i.model,
      status: i.status,
      input_tokens: i.usage.inputTokens,
      output_tokens: i.usage.outputTokens,
      cache_creation_input_tokens: i.usage.cacheCreationInputTokens,
      cache_read_input_tokens: i.usage.cacheReadInputTokens,
      cost_usd_micros: String(estimateCostMicros(i.model, i.usage)),
      latency_ms: i.latencyMs,
      tool_calls: JSON.stringify(i.toolCalls),
      error: i.error?.slice(0, 1000) ?? null,
      rounds: i.rounds,
      stop_reason: i.stopReason ?? null,
      handoff_reason: i.handoffReason ?? null,
      guard_violations: JSON.stringify(i.violations ?? []),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Avisa al cliente y deriva a una persona. handoffConversation abre su propia transacción, así que el orden hace el
 * par idempotente: primero se encola el aviso (único por mensaje respondido) marcado con `payload.handoff`; después
 * se deriva. Si el proceso se corta entre ambos, el reintento del job (o el dead handler) encuentra el aviso con la
 * derivación pendiente y la completa. Nunca queda un cliente derivado sin aviso ni un aviso sin derivación.
 */
export async function handoffWithAck(db: Database, actor: SystemActor, conversationId: string, messageId: string, reason: HandoffReason, detail?: string | null): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const conv = await trx.selectFrom("conversations").select("mode").where("id", "=", conversationId).forUpdate().executeTakeFirst();
    if (conv?.mode !== "bot") return; // ya la atiende una persona (o se cerró): no se avisa de nuevo
    const first = await isFirstBotMessage(trx, conversationId);
    await queueOutboundMessage(trx, {
      conversationId,
      senderKind: "bot",
      body: first ? `${ASSISTANT_INTRO} ${HANDOFF_ACK_MESSAGE}` : HANDOFF_ACK_MESSAGE,
      replyToMessageId: messageId,
      payload: { handoffAck: true, reason, handoff: reason },
    });
  });
  await handoffConversation(db, actor, { conversationId, reason, detail: detail ?? null });
}

/** Job muerto (agotó intentos, error permanente o lease vencido): la conversación no puede quedar sin respuesta. */
export async function handoffAfterDeadJob(db: Database, actor: SystemActor, input: { conversationId: string; messageId: string; error: string }): Promise<{ handedOff: boolean }> {
  const conv = await db.selectFrom("conversations").select(["mode"]).where("id", "=", input.conversationId).executeTakeFirst();
  if (conv?.mode !== "bot") return { handedOff: false };
  const pending = await pendingHandoff(db, input.messageId);
  await handoffWithAck(db, actor, input.conversationId, input.messageId, pending ?? "ai_error", `el asistente no pudo responder: ${input.error}`.slice(0, 200));
  return { handedOff: true };
}

/** Derivación que quedó pendiente en la respuesta/aviso ya encolado para este mensaje (ver handoffWithAck). */
async function pendingHandoff(db: Database, messageId: string): Promise<HandoffReason | null> {
  const r = await db.selectFrom("conversation_messages").select("payload").where("reply_to_message_id", "=", messageId).where("sender_kind", "=", "bot").executeTakeFirst();
  const h = (r?.payload as { handoff?: unknown } | null)?.handoff;
  return typeof h === "string" ? (h as HandoffReason) : null;
}

async function isFirstBotMessage(db: Executor, conversationId: string): Promise<boolean> {
  const r = await db.selectFrom("conversation_messages").select("id").where("conversation_id", "=", conversationId).where("sender_kind", "=", "bot").limit(1).executeTakeFirst();
  return !r;
}

/** Historial para el modelo: roles alternados, empieza y termina con el cliente. */
export function buildHistory(rows: Array<{ direction: string; body: string | null; kind: string }>): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const r of rows) {
    const role = r.direction === "inbound" ? "user" : "assistant";
    const text = r.body?.trim() || (r.direction === "inbound" ? `[El cliente envió un mensaje de tipo ${r.kind} sin texto]` : null);
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.role === role && typeof last.content === "string") last.content = `${last.content}\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  while (out.length && out.at(-1)!.role !== "user") out.pop();
  return out;
}

function addUsage(total: TokenUsage, u: Anthropic.Usage | undefined): void {
  if (!u) return;
  total.inputTokens += u.input_tokens ?? 0;
  total.outputTokens += u.output_tokens ?? 0;
  total.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
  total.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
}

export function parseAssistantOutput(message: Anthropic.Message): { ok: true; value: AssistantOutput } | { ok: false; error: string } {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) return { ok: false, error: `sin texto final (stop_reason=${message.stop_reason})` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "la salida no es JSON válido" };
  }
  const parsed = assistantOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: `salida inválida: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return { ok: true, value: parsed.data };
}

async function registerFailure(
  db: Database,
  actor: SystemActor,
  conversationId: string,
  messageId: string,
  interactionId: string,
  error: string,
): Promise<TurnOutcome> {
  const r = await sql<{ ai_failures: number }>`
    update conversations set ai_failures = ai_failures + 1 where id = ${conversationId} returning ai_failures`.execute(db);
  const failures = r.rows[0]?.ai_failures ?? MAX_CONSECUTIVE_AI_FAILURES;
  if (failures >= MAX_CONSECUTIVE_AI_FAILURES) {
    await handoffWithAck(db, actor, conversationId, messageId, "ai_error", error.slice(0, 200));
    return { outcome: "handoff", reason: "ai_error", interactionId };
  }
  // Primera falla: el job se reintenta con backoff; el mensaje del cliente no se pierde.
  throw new RetryableError(`Falla del asistente (${failures}/${MAX_CONSECUTIVE_AI_FAILURES}): ${error}`);
}

export async function runAssistantTurn(db: Database, actor: SystemActor, input: { conversationId: string; messageId: string }, deps: TurnDeps = {}): Promise<TurnOutcome> {
  const conv = await db
    .selectFrom("conversations as c")
    .leftJoin("contacts as ct", "ct.id", "c.contact_id")
    .select(["c.id", "c.mode", "c.collected", "ct.display_name"])
    .where("c.id", "=", input.conversationId)
    .executeTakeFirst();
  if (!conv) return { outcome: "skipped", reason: "conversación inexistente" };
  if (conv.mode !== "bot") return { outcome: "skipped", reason: `modo ${conv.mode}` };

  if (!(await isEnabled(db, "whatsapp_ai_bot"))) {
    await handoffConversation(db, actor, { conversationId: conv.id, reason: "bot_disabled" });
    return { outcome: "handoff", reason: "bot_disabled" };
  }

  const latestInbound = await db
    .selectFrom("conversation_messages")
    .select(["id"])
    .where("conversation_id", "=", conv.id)
    .where("direction", "=", "inbound")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (latestInbound?.id !== input.messageId) return { outcome: "skipped", reason: "hay un mensaje más nuevo" };
  const answered = await db
    .selectFrom("conversation_messages")
    .select(["id", "payload"])
    .where("reply_to_message_id", "=", input.messageId)
    .where("sender_kind", "=", "bot")
    .executeTakeFirst();
  if (answered) {
    // Corte entre encolar la respuesta (o el aviso) y derivar: el mensaje recuerda la derivación pendiente.
    const pending = (answered.payload as { handoff?: unknown; handoffAck?: unknown } | null) ?? {};
    if (typeof pending.handoff === "string") {
      const reason = pending.handoff as HandoffReason;
      await handoffConversation(db, actor, { conversationId: conv.id, reason, detail: "derivación completada tras un reintento" });
      return pending.handoffAck ? { outcome: "handoff", reason } : { outcome: "replied", messageId: answered.id, interactionId: "", handoff: reason };
    }
    return { outcome: "skipped", reason: "ya respondido" };
  }

  const rows = await db
    .selectFrom("conversation_messages")
    .select(["direction", "body", "kind", "created_at", "sender_kind"])
    .where("conversation_id", "=", conv.id)
    .where((eb) => eb.or([eb("direction", "=", "inbound"), eb("status", "in", ["queued", "sending", "sent", "delivered", "read"])]))
    .orderBy("created_at", "desc")
    .limit(HISTORY_MESSAGES)
    .execute();
  rows.reverse();

  // Mensajes del cliente desde la última respuesta: reglas deterministas de derivación
  const lastOutboundIdx = rows.map((r) => r.direction).lastIndexOf("outbound");
  const pendingText = rows
    .slice(lastOutboundIdx + 1)
    .filter((r) => r.direction === "inbound")
    .map((r) => r.body ?? "")
    .join("\n");
  const ruleReason = detectHandoff(pendingText);
  if (ruleReason) {
    await handoffWithAck(db, actor, conv.id, input.messageId, ruleReason, "regla automática");
    return { outcome: "handoff", reason: ruleReason };
  }

  const client = deps.client !== undefined ? deps.client : await getAnthropicClient(db, deps.env);
  const model = aiModel(deps.env);
  if (!client) {
    await handoffWithAck(db, actor, conv.id, input.messageId, "ai_unavailable");
    return { outcome: "handoff", reason: "ai_unavailable" };
  }

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const toolCalls: ToolCallLog[] = [];
  const t0 = Date.now();
  const deadline = t0 + (deps.turnBudgetMs ?? TURN_BUDGET_MS);
  const callTimeoutMs = deps.callTimeoutMs ?? AI_CALL_TIMEOUT_MS;

  if ((await budgetStatus(db)).exhausted) {
    const interactionId = await recordInteraction(db, { conversationId: conv.id, messageId: input.messageId, model, status: "budget_exceeded", usage, latencyMs: 0, toolCalls, rounds: 0, handoffReason: "budget_exhausted" });
    await handoffWithAck(db, actor, conv.id, input.messageId, "budget_exhausted");
    return { outcome: "handoff", reason: "budget_exhausted", interactionId };
  }

  const history = buildHistory(rows);
  if (!history.length) return { outcome: "skipped", reason: "sin mensajes del cliente" };

  const facts = emptyFacts();
  for (const r of rows) if (r.direction === "inbound" && r.body) addCustomerText(facts, r.body);
  const ctx: ToolContext = {
    db,
    actor,
    conversationId: conv.id,
    inboundMessageId: input.messageId,
    facts,
    appUrl: (deps.env ?? process.env).APP_URL?.replace(/\/+$/, "") ?? "",
    handoff: null,
  };
  const firstBotMessage = !rows.some((r) => r.sender_kind === "bot");
  const collected = (conv.collected ?? {}) as { requirements?: unknown };
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: contextBlock({
        contactName: conv.display_name,
        firstBotMessage,
        requirements: collected.requirements ?? null,
        today: new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: "America/Argentina/Salta" }).format(new Date()),
      }),
    },
  ];

  const messages: Anthropic.MessageParam[] = [...history];
  let final: Anthropic.Message | null = null;
  let rounds = 0;
  let stopReason: string | null = null;

  for (; rounds < MAX_TOOL_ROUNDS; ) {
    if (rounds > 0 && (await budgetStatus(db)).exhausted) {
      const interactionId = await recordInteraction(db, { conversationId: conv.id, messageId: input.messageId, model, status: "budget_exceeded", usage, latencyMs: Date.now() - t0, toolCalls, rounds, handoffReason: "budget_exhausted" });
      await handoffWithAck(db, actor, conv.id, input.messageId, "budget_exhausted");
      return { outcome: "handoff", reason: "budget_exhausted", interactionId };
    }
    if (deps.signal?.aborted) throw new Error("Turno del asistente cancelado: el job superó su tiempo (no se encola respuesta)");
    let message: Anthropic.Message;
    try {
      message = await callModel(
        db,
        client,
        { model, max_tokens: 1024, system, messages, tools: TOOL_DEFINITIONS, output_config: { format: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA } } },
        { entityId: conv.id, sleep: deps.sleep, timeoutMs: callTimeoutMs, deadline, signal: deps.signal },
      );
    } catch (e) {
      if (deps.signal?.aborted) throw e;
      const status: InteractionStatus = e instanceof TimeoutError ? "timeout" : "error";
      const error = (e as Error).message ?? String(e);
      log.warn("ai.whatsapp_call_failed", { conversationId: conv.id, ...errorFields(e) });
      const interactionId = await recordInteraction(db, { conversationId: conv.id, messageId: input.messageId, model, status, usage, latencyMs: Date.now() - t0, toolCalls, error, rounds });
      return registerFailure(db, actor, conv.id, input.messageId, interactionId, error);
    }
    rounds++;
    addUsage(usage, message.usage);
    stopReason = message.stop_reason;
    if (message.stop_reason !== "tool_use") {
      final = message;
      break;
    }
    messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      const r = await executeTool(block.name, block.input, ctx);
      toolCalls.push(r.log);
      results.push({ type: "tool_result", tool_use_id: block.id, content: r.content, is_error: r.isError });
    }
    messages.push({ role: "user", content: results });
  }

  if (deps.signal?.aborted) throw new Error("Turno del asistente cancelado: el job superó su tiempo (no se encola respuesta)");
  const latencyMs = Date.now() - t0;
  const parsed = final ? parseAssistantOutput(final) : ({ ok: false, error: `sin respuesta final tras ${rounds} rondas de herramientas` } as const);
  if (!parsed.ok) {
    const interactionId = await recordInteraction(db, { conversationId: conv.id, messageId: input.messageId, model, status: "invalid_output", usage, latencyMs, toolCalls, error: parsed.error, rounds, stopReason });
    return registerFailure(db, actor, conv.id, input.messageId, interactionId, parsed.error);
  }
  const output = parsed.value;

  let reply = output.reply;
  if (reply && firstBotMessage && !/asistente virtual/i.test(reply)) reply = `${ASSISTANT_INTRO} ${reply}`;

  const violations = reply ? findViolations(reply, facts) : [];
  if (violations.length) {
    const interactionId = await recordInteraction(db, {
      conversationId: conv.id,
      messageId: input.messageId,
      model,
      status: "fallback",
      usage,
      latencyMs,
      toolCalls,
      error: "respuesta descartada por datos no verificados",
      rounds,
      stopReason,
      handoffReason: "ai_guard",
      violations,
    });
    log.warn("ai.whatsapp_guard_blocked", { conversationId: conv.id, interactionId, violations });
    await sql`update conversations set summary = ${output.summary || null} where id = ${conv.id}`.execute(db);
    await handoffWithAck(db, actor, conv.id, input.messageId, "ai_guard", violations.map((v) => `${v.kind}:${v.value}`).join(", ").slice(0, 200));
    return { outcome: "handoff", reason: "ai_guard", interactionId };
  }

  const handoffReason: HandoffReason | null = ctx.handoff
    ? (ctx.handoff.reason as HandoffReason)
    : output.handoff
      ? output.handoff_reason === "none"
        ? "other"
        : output.handoff_reason
      : output.confidence === "low"
        ? "low_confidence"
        : null;

  const { interactionId, messageId } = await db.transaction().execute(async (trx) => {
    const interactionId = await recordInteraction(trx, {
      conversationId: conv.id,
      messageId: input.messageId,
      model,
      status: "ok",
      usage,
      latencyMs,
      toolCalls,
      rounds,
      stopReason,
      handoffReason,
    });
    await trx
      .updateTable("conversations")
      .set({ ai_failures: 0, summary: output.summary || null })
      .where("id", "=", conv.id)
      .execute();
    const queued = reply
      ? await queueOutboundMessage(trx, {
          conversationId: conv.id,
          senderKind: "bot",
          body: reply,
          replyToMessageId: input.messageId,
          // `handoff`: si el proceso se corta antes de derivar, el reintento del job completa la derivación.
          payload: { aiInteractionId: interactionId, promptVersion: PROMPT_VERSION, confidence: output.confidence, ...(handoffReason ? { handoff: handoffReason } : {}) },
        })
      : null;
    return { interactionId, messageId: queued?.messageId ?? null };
  });

  if (handoffReason) {
    if (messageId) await handoffConversation(db, actor, { conversationId: conv.id, reason: handoffReason, detail: ctx.handoff?.note ?? null });
    else await handoffWithAck(db, actor, conv.id, input.messageId, handoffReason, ctx.handoff?.note ?? null);
  }
  if (!messageId) return { outcome: "handoff", reason: handoffReason ?? "other", interactionId };
  return { outcome: "replied", messageId, interactionId, handoff: handoffReason };
}
