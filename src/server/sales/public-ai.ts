/**
 * IA en el sitio público (anónima): concierge, «Preguntale a esta propiedad» y resumen del comparador.
 * Controles propios además de los del AI Core:
 *  - Límite por IP (clave con hash; la IP en claro no se guarda) por función.
 *  - Presupuesto diario PÚBLICO (`ai.public.daily_budget_usd`) dentro del presupuesto general (`ai.daily_budget_usd`):
 *    el sitio nunca puede consumir lo que necesita el equipo.
 *  - Sin PII al modelo (redactForModel) y sin guardar el texto: ai_interactions solo con metadatos.
 */
import "server-only";
import { createHash } from "node:crypto";
import { sql, type Database, type Executor } from "../db";
import { budgetStatus } from "../ai/budget";
import { getAnthropicProvider } from "../ai/core/anthropic";
import type { AIFailureReason } from "../ai/core/errors";
import type { AIProvider, AITask, TokenUsage } from "../ai/core/types";
import { safeError, type AIStatus } from "../ai/core/usage";
import { estimateCostMicros } from "../ai/pricing";
import { organizationId } from "../org";
import { rateLimit } from "../rate-limit";

export type PublicAIDeps = {
  /** Solo tests: proveedor inyectado (null = sin clave). */
  provider?: AIProvider | null;
  env?: NodeJS.ProcessEnv;
  callTimeoutMs?: number;
};

export type PublicFeature = "concierge" | "property_qa" | "compare_summary";

export const DEFAULT_PUBLIC_BUDGET_USD = 1;
export const DEFAULT_PUBLIC_REQUESTS_PER_IP_HOUR = 30;
export const PUBLIC_CALL_TIMEOUT_MS = 8_000;

async function numberSetting(db: Executor, key: string, fallback: number, max: number): Promise<number> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
}

const ipHash = (ip: string) => createHash("sha256").update(`ai-public:${ip}`).digest("hex").slice(0, 32);

/** Límite por IP y función. Sin IP (proxy no confiable) se comparte una clave más permisiva. */
export async function publicRateLimit(db: Executor, feature: PublicFeature, ip: string | null): Promise<boolean> {
  const perHour = await numberSetting(db, "ai.public.requests_per_ip_per_hour", DEFAULT_PUBLIC_REQUESTS_PER_IP_HOUR, 10_000);
  const r = await rateLimit(db, `ai-public:${feature}:${ip ? ipHash(ip) : "unknown"}`, ip ? perHour : perHour * 10, 3600);
  return r.allowed;
}

export async function publicSpentTodayMicros(db: Executor): Promise<number> {
  const r = await sql<{ micros: string | null }>`
    select coalesce(sum(cost_usd_micros), 0)::text as micros from ai_interactions
     where feature like 'public.%'
       and created_at >= (date_trunc('day', now() at time zone 'America/Argentina/Salta') at time zone 'America/Argentina/Salta')`.execute(db);
  return Number(r.rows[0]?.micros ?? 0);
}

export async function publicBudgetExhausted(db: Executor): Promise<boolean> {
  const [general, publicBudget, spent] = await Promise.all([budgetStatus(db), numberSetting(db, "ai.public.daily_budget_usd", DEFAULT_PUBLIC_BUDGET_USD, 10_000), publicSpentTodayMicros(db)]);
  return general.exhausted || spent >= Math.round(publicBudget * 1_000_000);
}

/** Proveedor para uso público o el motivo por el que no se usa el modelo. */
export async function resolvePublicProvider(db: Database, deps: PublicAIDeps): Promise<{ provider: AIProvider | null; reason: AIFailureReason | null }> {
  const provider = deps.provider !== undefined ? deps.provider : await getAnthropicProvider(db, deps.env);
  if (!provider) return { provider: null, reason: "not_configured" };
  if (await publicBudgetExhausted(db)) return { provider: null, reason: "budget_exhausted" };
  return { provider, reason: null };
}

export type PublicUsage = {
  purpose: "concierge" | "property_qa" | "compare_summary";
  feature: `public.${string}`;
  task: AITask;
  provider: string;
  model: string;
  promptRef: string;
  status: AIStatus;
  fallbackReason: AIFailureReason | null;
  usage: TokenUsage | null;
  latencyMs: number;
  guardViolations?: Array<{ kind: string }>;
  error?: string | null;
  requestId?: string | null;
};

/** Registro sin texto: función, modelo, resultado, tokens y costo (sin usuario: el sitio es anónimo). */
export async function recordPublicUsage(db: Executor, r: PublicUsage): Promise<void> {
  const usage = r.usage ?? { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  await db
    .insertInto("ai_interactions")
    .values({
      purpose: r.purpose,
      feature: r.feature,
      task: r.task,
      provider: r.provider,
      organization_id: await organizationId(db),
      user_id: null,
      prompt_version: r.promptRef,
      model: r.model,
      status: r.status,
      fallback_reason: r.fallbackReason,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
      cost_usd_micros: String(r.provider === "deterministic" ? 0 : estimateCostMicros(r.model, usage)),
      latency_ms: Math.max(0, Math.round(r.latencyMs)),
      rounds: r.provider === "deterministic" ? 0 : 1,
      tool_calls: "[]",
      guard_violations: JSON.stringify((r.guardViolations ?? []).map((v) => ({ kind: v.kind }))),
      error: safeError(r.error),
      request_id: r.requestId?.slice(0, 100) ?? null,
    })
    .execute();
}

/** Estado de registro según el motivo de respaldo (mismo criterio que el copiloto). */
export function publicStatusFor(reason: AIFailureReason | null): AIStatus {
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
    default:
      return "error";
  }
}
