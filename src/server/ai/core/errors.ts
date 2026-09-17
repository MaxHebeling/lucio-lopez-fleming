/**
 * Errores del AI Core. Ninguno se muestra tal cual al usuario: el orquestador los traduce a un estado honesto
 * (fallback) y los registra en ai_interactions con su `fallback_reason`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CircuitOpenError, TimeoutError } from "../../resilience";

export const AI_FAILURE_REASONS = [
  "not_configured",
  "flag_disabled",
  "budget_exhausted",
  "rate_limited",
  "provider_error",
  "timeout",
  "circuit_open",
  "invalid_output",
  "guard_blocked",
  "governance_blocked",
] as const;
export type AIFailureReason = (typeof AI_FAILURE_REASONS)[number];

/** La IA no está disponible por una razón conocida (sin clave, flag apagado, presupuesto, límite). */
export class AIUnavailableError extends Error {
  constructor(
    readonly reason: AIFailureReason,
    message?: string,
  ) {
    super(message ?? `IA no disponible: ${reason}`);
    this.name = "AIUnavailableError";
  }
}

/** La salida del modelo no cumple el esquema (zod). Error controlado: nunca llega a la lógica de negocio. */
export class AIOutputError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "AIOutputError";
  }
}

export type GovernanceCode = "unknown_tool" | "capability_not_allowed" | "permission_denied" | "invalid_input" | "execute_forbidden";

/** Una herramienta pedida por el modelo (o registrada por código) viola la política: no se ejecuta. */
export class AIGovernanceError extends Error {
  constructor(
    readonly code: GovernanceCode,
    message: string,
  ) {
    super(message);
    this.name = "AIGovernanceError";
  }
}

/** Traduce cualquier error de una llamada a IA a un motivo de fallback registrable. */
export function classifyAIError(e: unknown): AIFailureReason {
  if (e instanceof AIUnavailableError) return e.reason;
  if (e instanceof AIOutputError) return "invalid_output";
  if (e instanceof AIGovernanceError) return "governance_blocked";
  if (e instanceof TimeoutError) return "timeout";
  if (e instanceof CircuitOpenError) return "circuit_open";
  if (e instanceof Anthropic.RateLimitError) return "rate_limited";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) return "rate_limited";
  return "provider_error";
}
