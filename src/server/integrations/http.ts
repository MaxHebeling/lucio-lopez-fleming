/**
 * HTTP para adaptadores externos: timeout, clasificación de errores (reintentable / permanente) y un único
 * punto de inyección de `fetch` para tests. En producción siempre es `globalThis.fetch`: no hay respuestas simuladas.
 */
import { RetryableError, TimeoutError, UncertainOutcomeError, isNotSentNetworkError, isRetryableStatus, retry, withTimeout } from "../resilience";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike | undefined;

/** Solo tests: reemplaza `fetch` (HTTP mockeado). `undefined` restaura el real. */
export function setFetchForTests(f: FetchLike | undefined): void {
  fetchImpl = f;
}

export function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  return (fetchImpl ?? globalThis.fetch)(input, init);
}

/** Configuración incompleta (faltan credenciales o datos de configuración): estado `awaiting_credentials`. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/** Error que no se resuelve reintentando (datos rechazados por el proveedor, 4xx no transitorio). */
export class PermanentIntegrationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PermanentIntegrationError";
  }
}

/** Reintentable sin riesgo de duplicar efectos (nunca un resultado incierto). */
export function isRetryable(e: unknown): boolean {
  return e instanceof RetryableError || e instanceof TimeoutError || (e instanceof TypeError && /fetch|network/i.test(e.message));
}

export type JsonRequest = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Intentos dentro de la misma ejecución (solo errores reintentables). */
  attempts?: number;
  /**
   * Escritura NO idempotente (crear un aviso, publicar un post, consumir un refresh token): nunca se reintenta y un
   * timeout, un corte después de enviar o un 5xx lanzan UncertainOutcomeError (el proveedor pudo haberla aplicado).
   * 408/425/429 siguen siendo RetryableError: el proveedor declara que no la procesó.
   */
  nonIdempotent?: boolean;
  /** Texto para el mensaje de error (nunca incluye secretos). */
  label: string;
};

/**
 * Llama y devuelve JSON. 408/425/429/5xx y errores de red → RetryableError; otros 4xx → PermanentIntegrationError
 * con el mensaje del proveedor recortado (sin headers ni tokens). Con `nonIdempotent`, ver JsonRequest.
 */
export async function requestJson<T>(url: string, req: JsonRequest): Promise<{ status: number; data: T }> {
  const unsafe = Boolean(req.nonIdempotent);
  const timeoutMs = req.timeoutMs ?? 15_000;
  return retry(
    () =>
      withTimeout(timeoutMs, async (signal) => {
        const headers: Record<string, string> = { accept: "application/json", ...(req.headers ?? {}) };
        let body: BodyInit | undefined;
        if (req.form) {
          headers["content-type"] = "application/x-www-form-urlencoded";
          body = new URLSearchParams(req.form).toString();
        } else if (req.body !== undefined) {
          headers["content-type"] = "application/json";
          body = JSON.stringify(req.body);
        }
        let res: Response;
        try {
          res = await httpFetch(url, { method: req.method ?? "GET", headers, body, signal, redirect: "follow" });
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          if (unsafe && !isNotSentNetworkError(e)) throw new UncertainOutcomeError(`${req.label}: conexión cortada después de enviar (${(e as Error).message})`, undefined, { cause: e });
          throw new RetryableError(`${req.label}: error de red (${(e as Error).message})`);
        }
        let text: string;
        try {
          text = await res.text();
        } catch (e) {
          if (unsafe && res.ok) throw new UncertainOutcomeError(`${req.label}: el proveedor respondió OK pero la respuesta se perdió`, res.status, { cause: e });
          throw new RetryableError(`${req.label}: respuesta incompleta (${(e as Error).message})`, res.status);
        }
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text.slice(0, 300) };
        }
        if (!res.ok) {
          const detail = providerMessage(data);
          const msg = `${req.label}: HTTP ${res.status}${detail ? ` · ${detail}` : ""}`;
          if (unsafe && res.status >= 500) throw new UncertainOutcomeError(`${msg} (resultado incierto)`, res.status);
          if (isRetryableStatus(res.status)) throw new RetryableError(msg, res.status);
          throw new PermanentIntegrationError(msg, res.status);
        }
        return { status: res.status, data: data as T };
      }).catch((e: unknown) => {
        if (unsafe && e instanceof TimeoutError) throw new UncertainOutcomeError(`${req.label}: sin respuesta en ${timeoutMs} ms (resultado incierto)`, undefined, { cause: e });
        throw e;
      }),
    { attempts: unsafe ? 1 : (req.attempts ?? 2), baseMs: 400, capMs: 3_000 },
  );
}

/** Extrae un mensaje legible de las formas de error usuales (Resend, Mercado Libre, Graph API). */
export function providerMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const err = d.error;
  const parts: string[] = [];
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") parts.push(e.message);
    if (e.code !== undefined) parts.push(`code ${String(e.code)}`);
    if (typeof e.error_user_msg === "string") parts.push(e.error_user_msg);
  } else if (typeof err === "string") parts.push(err);
  if (typeof d.message === "string") parts.push(d.message);
  if (typeof d.name === "string" && !parts.length) parts.push(d.name);
  if (Array.isArray(d.cause)) {
    for (const c of d.cause.slice(0, 5)) {
      if (c && typeof c === "object" && typeof (c as Record<string, unknown>).message === "string") parts.push(String((c as Record<string, unknown>).message));
    }
  }
  return parts.join(" · ").slice(0, 600);
}
