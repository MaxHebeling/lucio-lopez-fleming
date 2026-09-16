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
 * Tras OPEN_AFTER_FAILURES fallas consecutivas se abre 5 min; al superar el umbral configurado se emite
 * integration.failed (una vez por apertura) para que la automatización alerte.
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
    const updated = await sql<{ consecutive_failures: number; opened: boolean }>`
      update integrations set
        consecutive_failures = consecutive_failures + 1,
        last_error_at = now(), last_error = ${message}, updated_at = now(),
        status = case when status = 'active' then 'degraded' else status end,
        circuit_open_until = case when consecutive_failures + 1 >= ${OPEN_AFTER_FAILURES}
          then now() + make_interval(secs => ${OPEN_FOR_MS / 1000}) else circuit_open_until end
      where key = ${key}
      returning consecutive_failures, (consecutive_failures = ${OPEN_AFTER_FAILURES}) as opened`.execute(db);
    await db
      .insertInto("integration_logs")
      .values({ integration_key: key, operation, status: "error", http_status: status, error: message, duration_ms: Date.now() - t0, entity_type: meta.entityType ?? null, entity_id: meta.entityId ?? null, request_id: meta.requestId ?? null })
      .execute();
    const failures = updated.rows[0]?.consecutive_failures ?? 0;
    const threshold = await integrationAlertThreshold(db);
    if (failures === threshold) {
      await db
        .insertInto("domain_events")
        .values({
          event_type: "integration.failed",
          aggregate_type: "integration",
          aggregate_id: key,
          payload: JSON.stringify({ key, operation, failures, error: message }),
          dedupe_key: `integration.failed:${key}:${new Date().toISOString().slice(0, 13)}`,
        })
        .onConflict((oc) => oc.column("dedupe_key").doNothing())
        .execute();
    }
    log.warn("integration.call_failed", { integration: key, operation, failures, error: message, status });
    throw e;
  }
}

async function integrationAlertThreshold(db: Database): Promise<number> {
  const s = await db.selectFrom("settings").select("value").where("key", "=", "integrations.failure_alert_threshold").executeTakeFirst();
  const n = Number(s?.value);
  return Number.isInteger(n) && n > 0 ? n : 3;
}
