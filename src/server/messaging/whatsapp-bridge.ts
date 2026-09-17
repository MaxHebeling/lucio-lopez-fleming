/**
 * Puente hacia el envío de plantillas de WhatsApp (lo implementa el equipo de WhatsApp en
 * src/server/integrations/whatsapp/). Ese módulo debe registrarse al importarse:
 *
 *   registerWhatsAppTemplateSender(sendWhatsAppTemplate)
 *
 * e importarse en src/server/jobs/handlers.ts. Mientras no haya un sender registrado, la cola de mensajes deja
 * los WhatsApp en `awaiting_credentials` con un error explícito: nunca se simula un envío.
 */
import type { Database } from "../db";

export type WhatsAppTemplateMessage = {
  messageId: string;
  to: string;
  templateKey: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

export type WhatsAppTemplateResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "awaiting_credentials"; reason: string };

/**
 * Contrato de errores: transitorias → RetryableError; rechazos definitivos → PermanentIntegrationError;
 * resultado incierto (timeout/corte tras enviar) → subclase de PermanentIntegrationError: nunca se reintenta solo.
 */
export type WhatsAppTemplateSender = (db: Database, message: WhatsAppTemplateMessage) => Promise<WhatsAppTemplateResult>;

let sender: WhatsAppTemplateSender | undefined;

export function registerWhatsAppTemplateSender(fn: WhatsAppTemplateSender | undefined): void {
  sender = fn;
}

export function getWhatsAppTemplateSender(): WhatsAppTemplateSender | undefined {
  return sender;
}
