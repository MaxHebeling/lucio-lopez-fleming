/**
 * Adaptador de envío de WhatsApp Business Cloud API.
 * POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages con Authorization: Bearer {token}.
 * - callIntegration: circuit breaker + integration_logs.
 * - withTimeout por intento; reintento solo para errores reintentables (red, timeout, 5xx, límites de throughput).
 * - Sin credenciales: la integración queda `awaiting_credentials` y se lanza WhatsAppNotConfiguredError (nunca se simula un envío).
 * Códigos de error: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
import type { Database } from "../../db";
import { callIntegration, isRetryableStatus, retry, RetryableError, TimeoutError, withTimeout } from "../../resilience";
import { markAwaitingCredentials, markIntegrationActive } from "../credentials";
import { WHATSAPP_INTEGRATION_KEY, whatsappSendConfig } from "./config";

export class WhatsAppNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`WhatsApp sin credenciales (faltan: ${missing.join(", ")})`);
    this.name = "WhatsAppNotConfiguredError";
  }
}

/** Error devuelto por la API de Meta. `message` nunca incluye el token. */
export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
  /** 131047: pasaron más de 24 h desde el último mensaje del cliente → solo plantillas. */
  get windowExpired(): boolean {
    return this.code === 131047;
  }
}

/** Límites transitorios y fallas del lado de Meta: tiene sentido reintentar. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131048, 131049, 131056]);
/** De esos, los que conviene reintentar dentro de la misma llamada (el resto, más tarde por la cola). */
const RETRY_NOW_CODES = new Set([1, 2, 131000, 131016, 130429]);

export type OutgoingMessage =
  | { type: "text"; to: string; body: string; previewUrl?: boolean }
  | { type: "template"; to: string; name: string; language: string; components?: unknown[] };

export type SendResult = { wamid: string; waId: string | null };

export function buildMessageBody(m: OutgoingMessage): Record<string, unknown> {
  const to = m.to.replace(/\D/g, "");
  if (m.type === "text") {
    return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: m.previewUrl ?? true, body: m.body } };
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: m.name, language: { code: m.language }, ...(m.components?.length ? { components: m.components } : {}) },
  };
}

type GraphError = { error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };

export function toApiError(status: number, body: unknown): WhatsAppApiError {
  const err = (body as GraphError | null)?.error;
  const code = typeof err?.code === "number" ? err.code : null;
  const detail = err?.error_data?.details ?? err?.message ?? `HTTP ${status}`;
  const retryable = (code !== null && RETRYABLE_CODES.has(code)) || (code === null && isRetryableStatus(status)) || status >= 500;
  return new WhatsAppApiError(`Meta ${code ?? status}: ${String(detail).slice(0, 300)}`, status, code, retryable);
}

export type SendOptions = {
  entityType?: string;
  entityId?: string;
  requestId?: string;
  timeoutMs?: number;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
};

export async function sendWhatsAppMessage(db: Database, message: OutgoingMessage, opts: SendOptions = {}): Promise<SendResult> {
  const { config, missing } = whatsappSendConfig(opts.env);
  if (!config) {
    await markAwaitingCredentials(db, WHATSAPP_INTEGRATION_KEY, missing);
    throw new WhatsAppNotConfiguredError(missing);
  }
  const url = `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  const payload = JSON.stringify(buildMessageBody(message));

  const result = await callIntegration(
    db,
    WHATSAPP_INTEGRATION_KEY,
    message.type === "text" ? "send_text" : "send_template",
    () =>
      retry(
        () =>
          withTimeout(opts.timeoutMs ?? 15_000, async (signal) => {
            let res: Response;
            try {
              res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
                body: payload,
                signal,
              });
            } catch (e) {
              if (e instanceof TimeoutError) throw e;
              throw new RetryableError(`Error de red con Meta: ${(e as Error).message}`);
            }
            const text = await res.text();
            let body: unknown = null;
            try {
              body = text ? JSON.parse(text) : null;
            } catch {
              body = null; // respuesta no JSON (p. ej. página de error de un proxy): se trata por status
            }
            if (!res.ok) throw toApiError(res.status, body);
            const wamid = (body as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id;
            if (!wamid) throw new WhatsAppApiError("Respuesta de Meta sin id de mensaje", res.status, null, false);
            const waId = (body as { contacts?: Array<{ wa_id?: string }> }).contacts?.[0]?.wa_id ?? null;
            return { wamid, waId };
          }),
        {
          attempts: opts.attempts ?? 3,
          sleep: opts.sleep,
          shouldRetry: (e) =>
            e instanceof RetryableError || e instanceof TimeoutError || (e instanceof WhatsAppApiError && e.retryable && (e.code === null || RETRY_NOW_CODES.has(e.code))),
        },
      ),
    { entityType: opts.entityType, entityId: opts.entityId, requestId: opts.requestId },
  );
  await markIntegrationActive(db, WHATSAPP_INTEGRATION_KEY);
  return result;
}
