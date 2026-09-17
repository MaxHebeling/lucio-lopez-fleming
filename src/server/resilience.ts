/**
 * Primitivas de resiliencia para servicios externos: timeout, reintentos con backoff exponencial + jitter
 * y circuit breaker persistido por integración (sobrevive entre invocaciones serverless).
 */
import { sql, type Database } from "./db";
import { log } from "./log";

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Tiempo de espera agotado (${ms} ms)`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ctrl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(new TimeoutError(ms));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Backoff exponencial con "full jitter" (AWS): aleatorio en [0, min(cap, base·2^attempt)]. */
export function backoffMs(attempt: number, baseMs = 1000, capMs = 15 * 60_000, random = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export class RetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

/** Errores HTTP que tiene sentido reintentar. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseMs?: number; capMs?: number; shouldRetry?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const shouldRetry = opts.shouldRetry ?? ((e) => e instanceof RetryableError || e instanceof TimeoutError);
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      if (i === attempts - 1 || !shouldRetry(e)) break;
      await sleep(backoffMs(i, opts.baseMs ?? 300, opts.capMs ?? 5_000));
    }
  }
  throw lastError;
}

/**
 * La llamada pudo haber tenido efecto en el proveedor pero no sabemos (timeout o respuesta perdida después de
 * enviar una escritura no idempotente: enviar un mensaje, crear un aviso, publicar un post).
 * NUNCA se reintenta automáticamente: queda para verificación humana.
 */
export class UncertainOutcomeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "UncertainOutcomeError";
  }
}

/** Errores de red en los que la petición seguro NO llegó al proveedor (no hubo conexión). */
const NOT_SENT_NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "ERR_INVALID_URL"]);

export function isNotSentNetworkError(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && NOT_SENT_NETWORK_CODES.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * ¿Cuenta como falla de la integración (circuit breaker + alertas)?
 * Sí: credenciales (401/403), 408/425/429/5xx, timeouts, red y errores sin estado HTTP.
 * No: rechazos de datos (400/404/409/422 y demás 4xx): el proveedor respondió, el problema es el dato.
 */
export function countsAsIntegrationFailure(e: unknown): boolean {
  if (e instanceof TimeoutError || e instanceof UncertainOutcomeError) return true;
  const err = e as { status?: unknown; retryable?: unknown; code?: unknown } | null;
  if (err && err.retryable === true) return true;
  // Graph API (Meta): OAuthException 190/102 llega a veces con HTTP 400.
  if (err && (err.code === 190 || err.code === 102)) return true;
  const status = typeof err?.status === "number" ? err.status : null;
  if (status === null) return true;
  if (status === 401 || status === 403) return true;
  if (isRetryableStatus(status)) return true;
  return !(status >= 400 && status < 500);
}

export class CircuitOpenError extends Error {
  constructor(readonly integrationKey: string, readonly until: Date) {
    super(`Integración ${integrationKey} en pausa hasta ${until.toISOString()} por fallas repetidas`);
    this.name = "CircuitOpenError";
  }
}

const OPEN_AFTER_FAILURES = 5;
const OPEN_FOR_MS = 5 * 60_000;

/**
 * Ejecuta una llamada a una integración registrando resultado en integration_logs y manejando el circuito.
 * Tras OPEN_AFTER_FAILURES fallas consecutivas se abre 5 min; desde el umbral configurado se emite
 * integration.failed (como máximo una vez por hora mientras siga fallando) para que la automatización alerte.
 * Los rechazos de datos (4xx salvo 401/403/408/425/429) no cuentan como falla: ver countsAsIntegrationFailure.
 */
export async function callIntegration<T>(
  db: Database,
  key: string,
  operation: string,
  fn: () => Promise<T>,
  meta: { entityType?: string; entityId?: string; requestId?: string } = {},
): Promise<T> {
  const state = await db
    .selectFrom("integrations")
    .select(["circuit_open_until", "status"])
    .where("key", "=", key)
    .executeTakeFirst();
  if (state?.circuit_open_until && state.circuit_open_until > new Date()) {
    throw new CircuitOpenError(key, state.circuit_open_until);
  }
  const t0 = Date.now();
  try {
    const result = await fn();
    await db
      .updateTable("integrations")
      .set({ consecutive_failures: 0, circuit_open_until: null, last_ok_at: new Date(), status: sql`case when status in ('degraded','error','awaiting_credentials') then 'active' else status end`, updated_at: new Date() })
      .where("key", "=", key)
      .execute();
    await db
      .insertInto("integration_logs")
      .values({ integration_key: key, operation, status: "ok", duration_ms: Date.now() - t0, entity_type: meta.entityType ?? null, entity_id: meta.entityId ?? null, request_id: meta.requestId ?? null })
      .execute();
    return result;
  } catch (e) {
    const message = (e as Error).message?.slice(0, 1000) ?? String(e);
    const status = (e as { status?: number }).status ?? null;
    if (!countsAsIntegrationFailure(e)) {
      // Rechazo de datos: el proveedor está funcionando. Se registra, pero no abre el circuito ni alerta.
      await db
        .insertInto("integration_logs")
        .values({ integration_key: key, operation, status: "error", http_status: status, error: message, duration_ms: Date.now() - t0, entity_type: meta.entityType ?? null, entity_id: meta.entityId ?? null, request_id: meta.requestId ?? null, metadata: JSON.stringify({ counted: false }) })
        .execute();
      log.info("integration.call_rejected", { integration: key, operation, error: message, status });
      throw e;
    }
    const updated = await sql<{ consecutive_failures: number }>`
      update integrations set
        consecutive_failures = consecutive_failures + 1,
        last_error_at = now(), last_error = ${message}, updated_at = now(),
        status = case when status = 'active' then 'degraded' else status end,
        circuit_open_until = case when consecutive_failures + 1 >= ${OPEN_AFTER_FAILURES}
          then now() + make_interval(secs => ${OPEN_FOR_MS / 1000}) else circuit_open_until end
      where key = ${key}
      returning consecutive_failures`.execute(db);
    await db
      .insertInto("integration_logs")
      .values({ integration_key: key, operation, status: "error", http_status: status, error: message, duration_ms: Date.now() - t0, entity_type: meta.entityType ?? null, entity_id: meta.entityId ?? null, request_id: meta.requestId ?? null })
      .execute();
    const failures = updated.rows[0]?.consecutive_failures ?? 0;
    const threshold = await integrationAlertThreshold(db);
    if (failures >= threshold) {
      // Mientras siga caída se re-alerta como máximo una vez por hora (dedupe por hora UTC).
      await db
        .insertInto("domain_events")
        .values({
          event_type: "integration.failed",
          aggregate_type: "integration",
          aggregate_id: key,
          payload: JSON.stringify({ key, operation, failures, error: message }),
          dedupe_key: integrationFailedDedupeKey(key, new Date()),
        })
        .onConflict((oc) => oc.column("dedupe_key").doNothing())
        .execute();
    }
    log.warn("integration.call_failed", { integration: key, operation, failures, error: message, status });
    throw e;
  }
}

export function integrationFailedDedupeKey(key: string, now: Date): string {
  return `integration.failed:${key}:${now.toISOString().slice(0, 13)}`;
}

async function integrationAlertThreshold(db: Database): Promise<number> {
  const s = await db.selectFrom("settings").select("value").where("key", "=", "integrations.failure_alert_threshold").executeTakeFirst();
  const n = Number(s?.value);
  return Number.isInteger(n) && n > 0 ? n : 3;
}
