/**
 * Registro de uso de IA (auditabilidad y costos) sobre la tabla existente `ai_interactions`.
 * Guarda: acción (purpose/feature), usuario, organización, modelo, tarea, herramientas usadas (solo nombre,
 * resultado y latencia: SIN parámetros), resultado, error saneado, latencia, tokens, costo estimado y timestamp.
 * NO guarda prompts, respuestas ni datos de negocio.
 */
import type { Executor } from "../../db";
import type { StaffActor } from "../../auth/actor";
import { estimateCostMicros } from "../pricing";
import type { AIFailureReason } from "./errors";
import type { AITask, TokenUsage } from "./types";

export type AIPurpose = "copilot_assistant" | "copilot_analyst";
export type AIStatus = "ok" | "error" | "timeout" | "invalid_output" | "budget_exceeded" | "fallback" | "unavailable" | "rate_limited" | "blocked";

export type ToolUseLog = { name: string; ok: boolean; code?: string; ms: number };

export type UsageRecord = {
  actor: StaffActor;
  purpose: AIPurpose;
  feature: string;
  task: AITask;
  provider: "anthropic" | "deterministic" | string;
  model: string;
  promptRef: string;
  status: AIStatus;
  fallbackReason: AIFailureReason | null;
  usage: TokenUsage;
  latencyMs: number;
  rounds: number;
  stopReason?: string | null;
  tools: ToolUseLog[];
  retrievalCount?: number | null;
  retrievalFailed?: boolean;
  guardViolations?: Array<{ kind: string; value: string }>;
  error?: string | null;
  conversationId?: string | null;
};

/** Error guardable: sin saltos, acotado y sin emails/teléfonos. */
export function safeError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/[\r\n]+/g, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[número]")
    .slice(0, 500);
}

export async function recordUsage(db: Executor, r: UsageRecord): Promise<string> {
  const cost = r.provider === "deterministic" ? 0 : estimateCostMicros(r.model, r.usage);
  const row = await db
    .insertInto("ai_interactions")
    .values({
      purpose: r.purpose,
      feature: r.feature,
      task: r.task,
      provider: r.provider,
      organization_id: r.actor.organizationId,
      user_id: r.actor.userId,
      prompt_version: r.promptRef,
      model: r.model,
      status: r.status,
      fallback_reason: r.fallbackReason,
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_creation_input_tokens: r.usage.cacheCreationInputTokens,
      cache_read_input_tokens: r.usage.cacheReadInputTokens,
      cost_usd_micros: String(cost),
      latency_ms: Math.max(0, Math.round(r.latencyMs)),
      rounds: r.rounds,
      stop_reason: r.stopReason ?? null,
      // Solo metadatos de herramientas: nunca sus parámetros ni resultados.
      tool_calls: JSON.stringify(r.tools.map((t) => ({ name: t.name, ok: t.ok, ...(t.code ? { code: t.code } : {}), ms: t.ms }))),
      tool_failures: r.tools.filter((t) => !t.ok).length,
      retrieval_count: r.retrievalCount ?? null,
      retrieval_failed: r.retrievalFailed ?? false,
      guard_violations: JSON.stringify((r.guardViolations ?? []).map((v) => ({ kind: v.kind }))),
      error: safeError(r.error),
      request_id: r.actor.requestId?.slice(0, 100) ?? null,
      ai_conversation_id: r.conversationId ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
