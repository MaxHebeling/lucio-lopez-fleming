/**
 * Copiloto del CRM «✦ Asistente IA». Orquesta el AI Core; no tiene SQL de negocio propio (usa herramientas y retrieval).
 *
 * Pipeline (todo en el servidor, en este orden):
 *   1. Autorización: sesión de equipo + permiso `ai.copilot` + flag `ai_copilot`. Límite por usuario.
 *   2. Contexto de pantalla re-validado (context.ts) y sesión (memory.ts).
 *   3. Asistente: intención determinista → retrieval de la guía filtrado por permisos → [modelo con salida
 *      estructurada] → validación zod + fuentes + guardas → respuesta con links.
 *      Analista: consulta rápida o intención → herramientas `read` con RBAC → [modelo que elige herramientas y separa
 *      hechos de interpretación] → validación + guardas. Los HECHOS se muestran desde los resultados, no desde el texto.
 *   4. Sin clave, presupuesto agotado, límite, timeout, circuito abierto, salida inválida o guarda → respuesta
 *      determinista honesta (guía o datos) con `notice`. El CRM nunca depende de la IA.
 *   5. Registro (ai_interactions sin prompts) + mensaje de sesión + evento `ai.answer.generated`, en una transacción.
 */
import { sql, type Database } from "../../db";
import { requirePermission, requireStaff, type Actor, type StaffActor } from "../../auth/actor";
import { AppError, forbidden } from "../../errors";
import { emitEvent } from "../../events";
import { isEnabled } from "../../flags";
import { errorFields, log } from "../../log";
import { rateLimit } from "../../rate-limit";
import { parseInput } from "../../validate";
import { budgetStatus } from "../budget";
import { addCustomerText, addGroundedRoutes, addGroundedText, emptyFacts, findViolations, type GroundingFacts } from "../guards";
import { getAnthropicProvider } from "../core/anthropic";
import { hrefForRoute, resolveScreenContext, type ScreenContext } from "../core/context";
import { AIOutputError, classifyAIError, type AIFailureReason } from "../core/errors";
import { redactForModel, responseJsonSchema, untrustedData } from "../core/governance";
import { appendMessage, openConversation, recentTurns } from "../core/memory";
import type { EnabledFlags, ToolRegistry, ToolResult } from "../core/registry";
import { modelFor } from "../core/routing";
import { addUsage, emptyUsage, textOf, type AIContentBlock, type AIMessage, type AIProvider, type AIToolUseBlock } from "../core/types";
import { recordUsage, type AIStatus, type ToolUseLog } from "../core/usage";
import { defaultRegistry } from "../domains";
import { excerpt, knowledgeStats, searchKnowledge, type KnowledgeHit } from "../knowledge/retrieval";
import { analystOutputSchema } from "../prompts/copilot-analyst";
import { DETERMINISTIC_REF, PROMPTS, promptRef } from "../prompts/registry";
import { assistantOutputSchema } from "../prompts/copilot-assistant";
import { noticeFor } from "./notices";
import { copilotAskSchema, copilotFeedbackSchema, copilotStatusSchema, type CopilotAnswer, type CopilotFactGroup, type CopilotStatus, type GeneratedBy, type GuideExcerpt } from "./types";

export const COPILOT_FLAG = "ai_copilot";
export const DEFAULT_REQUESTS_PER_HOUR = 60;
export const MAX_ANALYST_ROUNDS = 3;
export const CALL_TIMEOUT_MS = 20_000;
export const TURN_BUDGET_MS = 45_000;
export const COPILOT_SHORTCUT = "Ctrl + I (⌘ + I en Mac)";

export type CopilotDeps = {
  /** Solo tests: proveedor inyectado (null = sin clave). En runtime se usa Anthropic vía client.ts. */
  provider?: AIProvider | null;
  env?: NodeJS.ProcessEnv;
  registry?: ToolRegistry;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  callTimeoutMs?: number;
};

// ───────────────────────────── Autorización y disponibilidad ─────────────────────────────

async function authorize(db: Database, actor: Actor): Promise<StaffActor> {
  requireStaff(actor);
  requirePermission(actor, "ai.copilot");
  if (!(await isEnabled(db, COPILOT_FLAG))) throw new AppError("unavailable", noticeFor("flag_disabled")!);
  return actor;
}

async function requestsPerHour(db: Database): Promise<number> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", "ai.copilot.requests_per_hour").executeTakeFirst();
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : DEFAULT_REQUESTS_PER_HOUR;
}

type ProviderState = { provider: AIProvider | null; reason: AIFailureReason | null };

async function resolveProvider(db: Database, deps: CopilotDeps): Promise<ProviderState> {
  const provider = deps.provider !== undefined ? deps.provider : await getAnthropicProvider(db, deps.env);
  if (!provider) return { provider: null, reason: "not_configured" };
  if ((await budgetStatus(db)).exhausted) return { provider: null, reason: "budget_exhausted" };
  return { provider, reason: null };
}

async function enabledFlags(db: Database, registry: ToolRegistry): Promise<EnabledFlags> {
  const keys = registry.quickFlags();
  const on = await Promise.all(keys.map(async (k) => [k, await isEnabled(db, k)] as const));
  return new Set(on.filter(([, v]) => v).map(([k]) => k));
}

function envConfigured(deps: CopilotDeps): boolean {
  if (deps.provider !== undefined) return deps.provider !== null;
  return Boolean((deps.env ?? process.env).ANTHROPIC_API_KEY?.trim());
}

export async function getCopilotStatus(db: Database, rawActor: Actor, raw: unknown, deps: CopilotDeps = {}): Promise<CopilotStatus> {
  const actor = await authorize(db, rawActor);
  const input = parseInput(copilotStatusSchema, raw ?? {});
  const registry = deps.registry ?? defaultRegistry();
  const screen = await resolveScreenContext(db, actor, input.path);
  const configured = envConfigured(deps);
  const budget = await budgetStatus(db);
  const stats = await knowledgeStats(db);
  const reason: AIFailureReason | null = !configured ? "not_configured" : budget.exhausted ? "budget_exhausted" : null;
  return {
    aiConfigured: configured,
    budgetExhausted: budget.exhausted,
    notice: noticeFor(reason),
    screen: screen ? { moduleLabel: screen.moduleLabel, entityLabel: screen.entity?.label ?? null, entityIgnored: screen.entityIgnored } : null,
    quickQueries: registry.quickQueries(actor, screen, await enabledFlags(db, registry)).map(({ id, label }) => ({ id, label })),
    knowledgeReady: stats.chunks > 0,
    shortcut: COPILOT_SHORTCUT,
  };
}

// ───────────────────────────── Contexto para el modelo ─────────────────────────────

const whenFmt = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Salta" });

function contextBlock(actor: StaffActor, screen: ScreenContext | null, now: Date): string {
  const lines = [
    `Fecha y hora (Salta): ${whenFmt.format(now)}`,
    `Rol del usuario: ${actor.roles.join(", ") || "sin rol"}`,
    `Pantalla: ${screen?.moduleLabel ?? "fuera de un módulo"}${screen?.entity ? ` › ${screen.entity.label}` : ""}`,
  ];
  return untrustedData("contexto_pantalla", lines.join("\n"), 800);
}

/** Resultado de herramienta → JSON para el modelo: PII minimizada y contenido libre como datos no confiables. */
export function toolResultForModel(r: ToolResult): string {
  const payload = {
    title: r.title,
    summary: r.summary,
    total: r.total,
    truncated: r.truncated,
    scope: r.scope,
    period: r.period ?? undefined,
    items: r.items.map((i) => ({ label: i.label, detail: i.detail ?? undefined, badge: i.badge ?? undefined, definition: i.definition ?? undefined })),
  };
  const parts = [redactForModel(JSON.stringify(payload))];
  for (const u of r.untrusted ?? []) parts.push(untrustedData(u.source, redactForModel(u.text), 2000));
  return parts.join("\n");
}

/**
 * Hechos verificables = campos estructurados de los resultados. El texto libre (`untrusted`: descripciones, mensajes)
 * NO cuenta como evidencia: un precio escrito en una descripción (o inyectado) no habilita al modelo a afirmarlo.
 */
function groundToolResult(facts: GroundingFacts, r: ToolResult): void {
  const texts = [r.title, r.summary, String(r.total), r.period ?? "", ...r.items.flatMap((i) => [i.label, i.detail ?? "", i.badge ?? "", i.definition ?? ""])];
  for (const t of texts) {
    addGroundedText(facts, t);
    addGroundedRoutes(facts, t);
    for (const m of t.matchAll(/#(\d{1,7})\b/g)) facts.propertyCodes.add(Number(m[1]));
  }
  for (const i of r.items) if (i.href) addGroundedRoutes(facts, i.href);
  if (r.source.href) addGroundedRoutes(facts, r.source.href);
}

function factGroup(r: ToolResult): CopilotFactGroup {
  return { title: r.title, summary: r.summary, items: r.items, total: r.total, truncated: r.truncated, source: r.source, scope: r.scope, period: r.period ?? null };
}

function guideExcerpts(hits: KnowledgeHit[], screen: ScreenContext | null, max = 3): GuideExcerpt[] {
  // La sección más relevante va completa (es la respuesta); las demás, como extracto.
  return hits.slice(0, max).map((h, i) => ({ heading: h.heading, document: h.documentTitle, excerpt: excerpt(h.body, i === 0 ? 2500 : 500), href: hrefForRoute(h.route, screen) }));
}

// ───────────────────────────── Turno ─────────────────────────────

type Outcome = {
  text: string;
  guide: GuideExcerpt[];
  facts: CopilotFactGroup[];
  interpretation: string[];
  generatedBy: GeneratedBy;
  fallbackReason: AIFailureReason | null;
  suggestion: CopilotAnswer["suggestion"];
  // Registro
  status: AIStatus;
  provider: string;
  model: string;
  promptRef: string;
  usage: ReturnType<typeof emptyUsage>;
  rounds: number;
  stopReason: string | null;
  tools: ToolUseLog[];
  retrievalCount: number | null;
  retrievalFailed: boolean;
  violations: Array<{ kind: string; value: string }>;
  error: string | null;
};

function baseOutcome(partial: Partial<Outcome>): Outcome {
  return {
    text: "",
    guide: [],
    facts: [],
    interpretation: [],
    generatedBy: "data",
    fallbackReason: null,
    suggestion: null,
    status: "ok",
    provider: "deterministic",
    model: "none",
    promptRef: promptRef(DETERMINISTIC_REF),
    usage: emptyUsage(),
    rounds: 0,
    stopReason: null,
    tools: [],
    retrievalCount: null,
    retrievalFailed: false,
    violations: [],
    error: null,
    ...partial,
  };
}

function statusFor(reason: AIFailureReason | null): AIStatus {
  switch (reason) {
    case null:
      return "ok";
    case "not_configured":
    case "flag_disabled":
      return "unavailable";
    case "budget_exhausted":
      return "budget_exceeded";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "invalid_output":
      return "invalid_output";
    case "guard_blocked":
      return "fallback";
    case "governance_blocked":
      return "blocked";
    case "circuit_open":
    case "provider_error":
      return "error";
  }
}

type TurnCtx = { db: Database; actor: StaffActor; screen: ScreenContext | null; registry: ToolRegistry; flags: EnabledFlags; deps: CopilotDeps; now: Date; conversationId: string; t0: number };

async function assistantTurn(ctx: TurnCtx, question: string): Promise<Outcome> {
  const { db, actor, screen, registry, deps } = ctx;
  const quick = registry.matchQuick(actor, question, screen, ctx.flags);
  const suggestion = quick ? { mode: "analyst" as const, label: `Esto parece una consulta de datos: probá «${quick.quick!.label}» en el modo Analista.`, quickQueryId: quick.quick!.id } : null;

  let hits: KnowledgeHit[] = [];
  let retrievalFailed = false;
  try {
    hits = await searchKnowledge(db, actor, question, { limit: 5, module: screen?.module });
  } catch (e) {
    retrievalFailed = true;
    log.error("ai.retrieval_failed", { requestId: actor.requestId, ...errorFields(e) });
  }
  const guide = guideExcerpts(hits, screen);
  const noEvidence = (): Outcome =>
    baseOutcome({
      text: retrievalFailed
        ? "No pude consultar la guía del CRM en este momento. Probá de nuevo en unos minutos."
        : "No encontré nada en la guía del CRM sobre eso. Probá con otras palabras (por ejemplo, el nombre de la pantalla o del botón) o consultalo con un administrador.",
      generatedBy: "guide",
      suggestion,
      retrievalCount: 0,
      retrievalFailed,
      status: retrievalFailed ? "error" : "ok",
      error: retrievalFailed ? "retrieval falló" : null,
    });
  const deterministic = (reason: AIFailureReason | null, extra: Partial<Outcome> = {}): Outcome =>
    hits.length
      ? baseOutcome({ text: "Esto es lo que dice la guía del CRM:", guide, generatedBy: "guide", fallbackReason: reason, suggestion, retrievalCount: hits.length, status: statusFor(reason), ...extra })
      : { ...noEvidence(), fallbackReason: reason, status: retrievalFailed ? "error" : statusFor(reason), ...extra };

  const { provider, reason } = await resolveProvider(db, deps);
  // Sin evidencia no se llama al modelo: no hay nada sobre qué anclar la respuesta (y no se gasta).
  if (!hits.length) return provider ? noEvidence() : deterministic(reason);
  if (!provider) return deterministic(reason);

  const prompt = PROMPTS["copilot.assistant"];
  const model = await modelFor(db, prompt.task);
  const facts = emptyFacts();
  addCustomerText(facts, question);
  const fragments = hits.map((h, i) => {
    addGroundedText(facts, h.body);
    addGroundedRoutes(facts, h.body);
    if (h.route) facts.routes.add(h.route);
    return `<fragmento id="F${i + 1}" guia="${h.documentTitle}" seccion="${h.heading}"${h.route ? ` ruta="${h.route}"` : ""}>\n${h.body}\n</fragmento>`;
  });
  const history = await recentTurns(db, ctx.conversationId, 5);
  const previous = history.slice(0, -1).filter((t) => t.role === "user").map((t) => t.content).slice(-2);
  const system = [prompt.system, contextBlock(actor, screen, ctx.now)];
  const userContent = [
    "Fragmentos de la guía del CRM recuperados para esta pregunta:",
    ...fragments,
    previous.length ? untrustedData("preguntas_previas_de_la_sesion", previous.join("\n"), 600) : "",
    `Pregunta del usuario:\n${redactForModel(question)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await provider.extract({
      task: prompt.task,
      model,
      system,
      messages: [{ role: "user", content: userContent }],
      schema: assistantOutputSchema,
      schemaName: "responder_con_la_guia",
      schemaDescription: "Respuesta final basada solo en los fragmentos de la guía de este turno.",
      maxTokens: 900,
      timeoutMs: deps.callTimeoutMs ?? CALL_TIMEOUT_MS,
      attempts: 2,
      deadline: ctx.t0 + TURN_BUDGET_MS,
      entityType: "ai_conversation",
      entityId: ctx.conversationId,
      sleep: deps.sleep,
    });
    const out = res.value;
    const used = [...new Set(out.source_ids)].map((id) => Number(id.slice(1)) - 1);
    const invalidSource = used.some((i) => !hits[i]);
    const violations = findViolations(out.answer, facts);
    const common = { provider: provider.name, model: res.model, promptRef: promptRef(prompt), usage: res.usage, rounds: 1, stopReason: res.stopReason, retrievalCount: hits.length };
    if (invalidSource || violations.length) {
      log.warn("ai.copilot_guard_blocked", { requestId: actor.requestId, mode: "assistant", violations: violations.map((v) => v.kind), invalidSource });
      return deterministic("guard_blocked", { ...common, status: "fallback", violations: invalidSource ? [...violations, { kind: "source_id", value: "" }] : violations });
    }
    const cited = used.length ? used.map((i) => hits[i]!) : hits.slice(0, out.found ? 2 : 0);
    return baseOutcome({
      ...common,
      text: out.answer,
      guide: out.found ? guideExcerpts(cited, screen, 3) : guide,
      generatedBy: "ai",
      suggestion,
    });
  } catch (e) {
    const r = classifyAIError(e);
    log.warn("ai.copilot_call_failed", { requestId: actor.requestId, mode: "assistant", reason: r, ...errorFields(e) });
    return deterministic(r, { provider: provider.name, model, promptRef: promptRef(prompt), error: (e as Error).message ?? String(e) });
  }
}

async function runQuick(ctx: TurnCtx, toolName: string, input: unknown = {}): Promise<{ result: ToolResult | null; log: ToolUseLog; message: string | null }> {
  const inv = await ctx.registry.invoke({ db: ctx.db, actor: ctx.actor, now: ctx.now, screen: ctx.screen }, toolName, input, ["read"]);
  if (inv.ok) return { result: inv.result, log: { name: inv.name, ok: true, ms: inv.ms }, message: null };
  return { result: null, log: { name: inv.name, ok: false, code: inv.code, ms: inv.ms }, message: inv.message };
}

function quickOutcome(r: Awaited<ReturnType<typeof runQuick>>, extra: Partial<Outcome> = {}): Outcome {
  if (!r.result) {
    return baseOutcome({ text: "No pude consultar esos datos en este momento. Probá de nuevo en unos minutos.", tools: [r.log], status: "error", error: r.message, ...extra });
  }
  return baseOutcome({ text: r.result.summary, facts: [factGroup(r.result)], tools: [r.log], generatedBy: "data", ...extra });
}

async function analystTurn(ctx: TurnCtx, input: { question?: string; quickQueryId?: string }): Promise<Outcome> {
  const { db, actor, screen, registry, deps } = ctx;

  // Consulta rápida (chip): determinista, nunca usa el modelo.
  if (input.quickQueryId) {
    const def = registry.byQuickId(input.quickQueryId);
    if (!def || !registry.quickQueries(actor, screen, ctx.flags).some((q) => q.id === input.quickQueryId)) throw forbidden("Esa consulta no está disponible para tu rol en esta pantalla");
    return quickOutcome(await runQuick(ctx, def.name));
  }

  const question = input.question!;
  const quick = registry.matchQuick(actor, question, screen, ctx.flags);
  const fallback = async (reason: AIFailureReason | null, extra: Partial<Outcome> = {}): Promise<Outcome> => {
    if (quick) return quickOutcome(await runQuick(ctx, quick.name), { status: statusFor(reason), ...extra, fallbackReason: reason });
    return baseOutcome({
      text: reason
        ? "Sin la IA no puedo interpretar esa pregunta. Probá con una de las consultas rápidas: son datos directos del CRM, con tu mismo alcance."
        : "No tengo una consulta que responda eso. Probá con una de las consultas rápidas.",
      fallbackReason: reason,
      status: statusFor(reason),
      ...extra,
    });
  };
  const mergeTools = (o: Outcome, before: ToolUseLog[]): Outcome => ({ ...o, tools: [...before, ...o.tools] });

  const { provider, reason } = await resolveProvider(db, deps);
  if (!provider) return fallback(reason);

  const prompt = PROMPTS["copilot.analyst"];
  const model = await modelFor(db, prompt.task);
  const tools = registry.available(actor, ["read"]);
  const facts = emptyFacts();
  addCustomerText(facts, question);
  const results: ToolResult[] = [];
  const toolLogs: ToolUseLog[] = [];
  const usage = emptyUsage();
  const system = [prompt.system, contextBlock(actor, screen, ctx.now)];
  const messages: AIMessage[] = [{ role: "user", content: `Pregunta del usuario:\n${redactForModel(question)}` }];
  let rounds = 0;
  let stopReason: string | null = null;
  let finalText = "";
  const common = () => ({ provider: provider.name, model, promptRef: promptRef(prompt), usage, rounds, stopReason });

  try {
    for (;;) {
      if (rounds >= MAX_ANALYST_ROUNDS) throw new AIOutputError(`sin respuesta final tras ${rounds} rondas de herramientas`);
      if (rounds > 0 && (await budgetStatus(db)).exhausted) return mergeTools(await fallback("budget_exhausted", common()), toolLogs);
      const res = await provider.chat({
        task: prompt.task,
        model,
        system,
        messages,
        tools: registry.specs(tools),
        responseSchema: responseJsonSchema(analystOutputSchema),
        maxTokens: 900,
        timeoutMs: deps.callTimeoutMs ?? CALL_TIMEOUT_MS,
        attempts: 2,
        deadline: ctx.t0 + TURN_BUDGET_MS,
        entityType: "ai_conversation",
        entityId: ctx.conversationId,
        sleep: deps.sleep,
      });
      rounds++;
      addUsage(usage, res.usage);
      stopReason = res.stopReason;
      const calls = res.content.filter((b): b is AIToolUseBlock => b.type === "tool_use");
      if (res.stopReason !== "tool_use" || !calls.length) {
        finalText = textOf(res.content);
        break;
      }
      messages.push({ role: "assistant", content: res.content });
      const toolResults: AIContentBlock[] = [];
      for (const call of calls) {
        // Re-verificación completa en el servidor: herramienta registrada, capability read, permiso del actor, zod.
        const inv = await registry.invoke({ db, actor, now: ctx.now, screen }, call.name, call.input, ["read"]);
        if (inv.ok) {
          toolLogs.push({ name: inv.name, ok: true, ms: inv.ms });
          results.push(inv.result);
          groundToolResult(facts, inv.result);
          toolResults.push({ type: "tool_result", toolUseId: call.id, content: toolResultForModel(inv.result) });
        } else {
          toolLogs.push({ name: inv.name.slice(0, 60), ok: false, code: inv.code, ms: inv.ms });
          if (inv.code !== "failed" && inv.code !== "not_found") log.warn("ai.copilot_tool_rejected", { requestId: actor.requestId, tool: inv.name.slice(0, 60), code: inv.code });
          toolResults.push({ type: "tool_result", toolUseId: call.id, content: JSON.stringify({ error: inv.message }), isError: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    const r = classifyAIError(e);
    log.warn("ai.copilot_call_failed", { requestId: actor.requestId, mode: "analyst", reason: r, ...errorFields(e) });
    return mergeTools(await fallback(r, { ...common(), error: (e as Error).message ?? String(e) }), toolLogs);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(finalText);
  } catch {
    return mergeTools(await fallback("invalid_output", { ...common(), error: "la salida no es JSON válido" }), toolLogs);
  }
  const parsed = analystOutputSchema.safeParse(parsedJson);
  if (!parsed.success) return mergeTools(await fallback("invalid_output", { ...common(), error: "la salida no cumple el esquema" }), toolLogs);

  const out = parsed.data;
  const violations = [out.answer, ...out.interpretation].flatMap((t) => findViolations(t, facts));
  if (violations.length) {
    log.warn("ai.copilot_guard_blocked", { requestId: actor.requestId, mode: "analyst", violations: violations.map((v) => v.kind) });
    // Los hechos ya consultados son verificables: se muestran sin el texto del modelo.
    if (results.length) {
      return baseOutcome({ ...common(), text: "Estos son los datos directos del CRM:", facts: results.map(factGroup), tools: toolLogs, generatedBy: "data", fallbackReason: "guard_blocked", status: "fallback", violations });
    }
    return mergeTools(await fallback("guard_blocked", { ...common(), status: "fallback", violations }), toolLogs);
  }
  return baseOutcome({
    ...common(),
    text: out.answer,
    facts: results.map(factGroup),
    interpretation: out.interpretation,
    tools: toolLogs,
    generatedBy: "ai",
  });
}

export async function askCopilot(db: Database, rawActor: Actor, raw: unknown, deps: CopilotDeps = {}): Promise<CopilotAnswer> {
  const actor = await authorize(db, rawActor);
  const input = parseInput(copilotAskSchema, raw);
  const now = deps.now?.() ?? new Date();
  const t0 = Date.now();

  const limit = await requestsPerHour(db);
  const rl = await rateLimit(db, `ai:copilot:user:${actor.userId}`, limit, 3600);
  if (!rl.allowed) {
    await recordUsage(db, {
      actor,
      purpose: input.mode === "assistant" ? "copilot_assistant" : "copilot_analyst",
      feature: `copilot.${input.mode}`,
      task: input.mode === "assistant" ? "answer" : "analyze",
      provider: "deterministic",
      model: "none",
      promptRef: promptRef(DETERMINISTIC_REF),
      status: "rate_limited",
      fallbackReason: "rate_limited",
      usage: emptyUsage(),
      latencyMs: Date.now() - t0,
      rounds: 0,
      tools: [],
    });
    throw new AppError("rate_limited", "Hiciste muchas consultas al asistente en la última hora. Probá de nuevo en un rato; el resto del CRM funciona normalmente.");
  }

  const registry = deps.registry ?? defaultRegistry();
  const screen = await resolveScreenContext(db, actor, input.path);
  const conversationId = await openConversation(db, actor, { conversationId: input.conversationId, mode: input.mode, module: screen?.module ?? null });
  const questionText = input.question ?? `[Consulta rápida] ${registry.byQuickId(input.quickQueryId ?? "")?.quick?.label ?? input.quickQueryId}`;
  await appendMessage(db, { conversationId, role: "user", content: questionText, payload: { mode: input.mode, quickQueryId: input.quickQueryId ?? null } });

  const ctx: TurnCtx = { db, actor, screen, registry, flags: await enabledFlags(db, registry), deps, now, conversationId, t0 };
  const outcome = input.mode === "assistant" ? await assistantTurn(ctx, input.question ?? "") : await analystTurn(ctx, { question: input.question, quickQueryId: input.quickQueryId });
  const notice = noticeFor(outcome.fallbackReason);
  const latencyMs = Date.now() - t0;

  const messageId = await db.transaction().execute(async (trx) => {
    const interactionId = await recordUsage(trx, {
      actor,
      purpose: input.mode === "assistant" ? "copilot_assistant" : "copilot_analyst",
      feature: `copilot.${input.mode}`,
      task: input.mode === "assistant" ? "answer" : "analyze",
      provider: outcome.provider,
      model: outcome.model,
      promptRef: outcome.promptRef,
      status: outcome.status,
      fallbackReason: outcome.fallbackReason,
      usage: outcome.usage,
      latencyMs,
      rounds: outcome.rounds,
      stopReason: outcome.stopReason,
      tools: outcome.tools,
      retrievalCount: outcome.retrievalCount,
      retrievalFailed: outcome.retrievalFailed,
      guardViolations: outcome.violations,
      error: outcome.error,
      conversationId,
    });
    const id = await appendMessage(trx, {
      conversationId,
      role: "assistant",
      content: outcome.text,
      interactionId,
      promptRef: outcome.promptRef,
      payload: { generatedBy: outcome.generatedBy, notice, guide: outcome.guide, facts: outcome.facts, interpretation: outcome.interpretation, suggestion: outcome.suggestion, feature: `copilot.${input.mode}` },
    });
    await emitEvent(trx, actor, {
      type: "ai.answer.generated",
      aggregateType: "ai_conversation",
      aggregateId: conversationId,
      payload: { interactionId, messageId: id, mode: input.mode, generatedBy: outcome.generatedBy, status: outcome.status, fallbackReason: outcome.fallbackReason },
    });
    return id;
  });

  log.info("ai.copilot_answer", { requestId: actor.requestId, mode: input.mode, generatedBy: outcome.generatedBy, status: outcome.status, fallbackReason: outcome.fallbackReason, latencyMs, tools: outcome.tools.map((t) => t.name) });
  return {
    conversationId,
    messageId,
    mode: input.mode,
    text: outcome.text,
    guide: outcome.guide,
    facts: outcome.facts,
    interpretation: outcome.interpretation,
    generatedBy: outcome.generatedBy,
    notice,
    suggestion: outcome.suggestion,
  };
}

// ───────────────────────────── Feedback ─────────────────────────────

export async function recordCopilotFeedback(db: Database, rawActor: Actor, raw: unknown): Promise<{ saved: true }> {
  const actor = await authorize(db, rawActor);
  const input = parseInput(copilotFeedbackSchema, raw);
  await db.transaction().execute(async (trx) => {
    const msg = await trx
      .selectFrom("ai_messages as m")
      .innerJoin("ai_conversations as c", "c.id", "m.conversation_id")
      .select(["m.id", "m.interaction_id", "m.prompt_ref", "m.payload"])
      .where("m.id", "=", input.messageId)
      .where("m.role", "=", "assistant")
      .where("c.user_id", "=", actor.userId)
      .where("c.organization_id", "=", actor.organizationId)
      .executeTakeFirst();
    if (!msg) throw new AppError("not_found", "Respuesta no encontrada");
    const feature = (msg.payload as { feature?: unknown } | null)?.feature;
    const comment = input.comment ? redactForModel(input.comment).slice(0, 1000) : null;
    const row = await trx
      .insertInto("ai_feedback")
      .values({
        organization_id: actor.organizationId,
        message_id: msg.id,
        user_id: actor.userId,
        rating: input.rating,
        comment,
        feature: typeof feature === "string" && /^[a-z0-9_.]{2,60}$/.test(feature) ? feature : null,
        prompt_ref: msg.prompt_ref,
        interaction_id: msg.interaction_id,
      })
      .onConflict((oc) => oc.columns(["message_id", "user_id"]).doUpdateSet({ rating: input.rating, comment: sql`coalesce(${comment}, ai_feedback.comment)` }))
      .returning("id")
      .executeTakeFirstOrThrow();
    await emitEvent(trx, actor, { type: "ai.feedback.recorded", aggregateType: "ai_feedback", aggregateId: row.id, payload: { messageId: msg.id, rating: input.rating, hasComment: Boolean(comment) } });
  });
  return { saved: true };
}
