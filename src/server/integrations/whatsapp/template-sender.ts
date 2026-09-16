/**
 * Envío de plantillas de WhatsApp para la cola genérica `outbound_messages` (job `messaging.send`, equipo de
 * mensajería). Compatible con el contrato `WhatsAppTemplateSender` de src/server/messaging/whatsapp-bridge.ts:
 * al integrar ramas, registrar con `registerWhatsAppTemplateSender(sendWhatsAppTemplate)`.
 *
 * Fuera de una conversación abierta solo se pueden enviar plantillas APROBADAS por Meta. El nombre de la plantilla
 * es `payload.whatsappTemplate.name` o, si no se indica, la `templateKey`; los parámetros del cuerpo salen de
 * `payload.whatsappTemplate.bodyParameters` (textos, en orden). Nunca se inventa contenido.
 */
import type { Database } from "../../db";
import { RetryableError } from "../../resilience";
import { sendWhatsAppMessage, WhatsAppApiError, WhatsAppNotConfiguredError } from "./client";

export type QueueTemplateMessage = {
  messageId: string;
  to: string;
  templateKey: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

export type QueueTemplateResult = { status: "sent"; providerMessageId: string } | { status: "awaiting_credentials"; reason: string };

type TemplateSpec = { name?: unknown; language?: unknown; bodyParameters?: unknown };

export async function sendWhatsAppTemplate(db: Database, message: QueueTemplateMessage, env: NodeJS.ProcessEnv = process.env): Promise<QueueTemplateResult> {
  const spec = (message.payload.whatsappTemplate ?? {}) as TemplateSpec;
  const name = typeof spec.name === "string" ? spec.name : message.templateKey;
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error(`Nombre de plantilla de WhatsApp inválido: ${name}`);
  const language = typeof spec.language === "string" && /^[a-z]{2}(_[A-Z]{2})?$/.test(spec.language) ? spec.language : env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "es_AR";
  const params = Array.isArray(spec.bodyParameters) ? spec.bodyParameters.map((p) => String(p).slice(0, 1024)) : [];
  const to = message.to.replace(/\D/g, "");
  if (to.length < 8 || to.length > 15) throw new Error("Número de WhatsApp inválido");
  try {
    const r = await sendWhatsAppMessage(
      db,
      {
        type: "template",
        to,
        name,
        language,
        components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : undefined,
      },
      { entityType: "outbound_message", entityId: message.messageId, env },
    );
    return { status: "sent", providerMessageId: r.wamid };
  } catch (e) {
    if (e instanceof WhatsAppNotConfiguredError) return { status: "awaiting_credentials", reason: e.message };
    if (e instanceof WhatsAppApiError && e.retryable) throw new RetryableError(e.message, e.status);
    throw e;
  }
}
