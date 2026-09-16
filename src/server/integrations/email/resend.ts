/**
 * Adaptador Resend (email transaccional). API: POST https://api.resend.com/emails
 * - Authorization: Bearer RESEND_API_KEY · Idempotency-Key (≤256 caracteres, válido 24 h) = dedupe_key del mensaje:
 *   si el worker reintenta tras un corte, Resend no manda el email dos veces.
 * - Respuesta 200: { id }. 429/5xx reintentables; otros 4xx permanentes.
 * Sin RESEND_API_KEY / EMAIL_FROM → NotConfiguredError (el mensaje queda en awaiting_credentials).
 */
import { createHash } from "node:crypto";
import type { Database } from "../../db";
import { callIntegration } from "../../resilience";
import { NotConfiguredError, PermanentIntegrationError, requestJson } from "../http";

export const RESEND_INTEGRATION_KEY = "resend";
const ENDPOINT = "https://api.resend.com/emails";

export type ResendConfig = { apiKey: string; from: string; replyTo?: string };

export function resendConfig(): { ok: true; config: ResendConfig } | { ok: false; reason: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const missing = [!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM"].filter(Boolean);
  if (missing.length) return { ok: false, reason: `Faltan variables de entorno: ${missing.join(", ")}` };
  return { ok: true, config: { apiKey: apiKey!, from: from!, replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined } };
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  tags?: Record<string, string>;
  entityType?: string;
  entityId?: string;
};

const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

export async function sendEmailViaResend(db: Database, input: SendEmailInput): Promise<{ providerMessageId: string }> {
  const cfg = resendConfig();
  if (!cfg.ok) throw new NotConfiguredError(cfg.reason);
  if (!EMAIL_RE.test(input.to)) throw new PermanentIntegrationError("Dirección de email inválida");
  // Resend acepta hasta 256 caracteres; los dedupe_key largos se acortan de forma estable.
  const idem = input.idempotencyKey.length <= 256 ? input.idempotencyKey : `${input.idempotencyKey.slice(0, 180)}:${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 64)}`;
  const tags = Object.entries(input.tags ?? {})
    .map(([name, value]) => ({ name: name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256), value: value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) }))
    .filter((t) => t.name && t.value);

  return callIntegration(
    db,
    RESEND_INTEGRATION_KEY,
    "emails.send",
    async () => {
      const { data } = await requestJson<{ id?: string }>(ENDPOINT, {
        method: "POST",
        label: "Resend",
        timeoutMs: 15_000,
        attempts: 2,
        headers: { authorization: `Bearer ${cfg.config.apiKey}`, "idempotency-key": idem },
        body: {
          from: cfg.config.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(cfg.config.replyTo ? { reply_to: cfg.config.replyTo } : {}),
          ...(tags.length ? { tags } : {}),
        },
      });
      if (!data?.id) throw new PermanentIntegrationError("Resend respondió sin id de mensaje");
      return { providerMessageId: data.id };
    },
    { entityType: input.entityType, entityId: input.entityId },
  );
}

