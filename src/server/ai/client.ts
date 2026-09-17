/**
 * Cliente de Claude (Anthropic) con timeout, reintentos acotados y circuit breaker persistido.
 * El SDK se crea con maxRetries=0: los reintentos los controla `retry` (solo errores reintentables).
 * Sin ANTHROPIC_API_KEY no hay cliente: la integración queda `awaiting_credentials` y la conversación va a humano.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "../db";
import { callIntegration, retry, RetryableError, TimeoutError, withTimeout } from "../resilience";
import { markAwaitingCredentials, markIntegrationActive, missingEnv } from "../integrations/credentials";

export const ANTHROPIC_INTEGRATION_KEY = "anthropic";
export const DEFAULT_AI_MODEL = "claude-sonnet-5";

export function aiModel(env: NodeJS.ProcessEnv = process.env): string {
  const m = env.AI_MODEL?.trim();
  return m && /^[a-z0-9][a-z0-9.-]{2,80}$/.test(m) ? m : DEFAULT_AI_MODEL;
}

/** Subconjunto del SDK que usa la app (permite inyectar un doble en tests; en runtime siempre es el SDK real). */
export type MessagesClient = {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal; timeout?: number }): PromiseLike<Anthropic.Message> };
};

let cached: { key: string; client: MessagesClient } | undefined;

export async function getAnthropicClient(db: Database, env: NodeJS.ProcessEnv = process.env): Promise<MessagesClient | null> {
  const missing = missingEnv(["ANTHROPIC_API_KEY"], env);
  if (missing.length) {
    await markAwaitingCredentials(db, ANTHROPIC_INTEGRATION_KEY, missing);
    return null;
  }
  const key = env.ANTHROPIC_API_KEY!.trim();
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 0, timeout: 60_000 }) };
  return cached.client;
}

function isRetryableAnthropicError(e: unknown): boolean {
  if (e instanceof TimeoutError || e instanceof RetryableError) return true;
  if (e instanceof Anthropic.APIConnectionError) return true; // incluye APIConnectionTimeoutError
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return true;
  if (e instanceof Anthropic.APIError && typeof e.status === "number") return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  return false;
}

export type CallModelOptions = {
  timeoutMs?: number;
  attempts?: number;
  entityId?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Hora límite (epoch ms) del turno: ningún intento se extiende más allá, y no se reintenta si no queda tiempo. */
  deadline?: number;
  /** Cancelación externa (p. ej. el job superó su tiempo). */
  signal?: AbortSignal;
};

const MIN_ATTEMPT_MS = 2_000;

export async function callModel(db: Database, client: MessagesClient, body: Anthropic.MessageCreateParamsNonStreaming, opts: CallModelOptions = {}): Promise<Anthropic.Message> {
  const perCall = opts.timeoutMs ?? 30_000;
  const minAttempt = Math.min(MIN_ATTEMPT_MS, perCall);
  const left = () => (opts.deadline === undefined ? Number.POSITIVE_INFINITY : opts.deadline - Date.now());
  const message = await callIntegration(
    db,
    ANTHROPIC_INTEGRATION_KEY,
    "messages.create",
    () =>
      retry(
        () => {
          if (opts.signal?.aborted) throw new Error("Llamada a la IA cancelada");
          const ms = Math.min(perCall, left());
          if (ms < minAttempt) throw new TimeoutError(Math.max(0, Math.round(ms)));
          return withTimeout(ms, (signal) => Promise.resolve(client.messages.create(body, { signal: opts.signal ? AbortSignal.any([signal, opts.signal]) : signal })));
        },
        {
          attempts: opts.attempts ?? 2,
          sleep: opts.sleep,
          shouldRetry: (e) => isRetryableAnthropicError(e) && !opts.signal?.aborted && left() > minAttempt * 2,
        },
      ),
    { entityType: "conversation", entityId: opts.entityId },
  );
  await markIntegrationActive(db, ANTHROPIC_INTEGRATION_KEY);
  return message;
}

export { isRetryableAnthropicError };
