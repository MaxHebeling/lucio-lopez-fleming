/**
 * Configuración de WhatsApp Business Cloud API (oficial de Meta). Todo sale de variables de entorno.
 * Referencia: https://developers.facebook.com/documentation/business-messaging/whatsapp
 */
import { missingEnv } from "../credentials";

export const WHATSAPP_INTEGRATION_KEY = "whatsapp_cloud";
export const WHATSAPP_PROVIDER = "whatsapp_cloud";

/** Versión de Graph API vigente al 2026-09 (v26.0, publicada 2026-07-29). Se puede fijar por entorno. */
export const DEFAULT_GRAPH_VERSION = "v26.0";

/** Ventana de atención al cliente: fuera de ella solo se permiten plantillas aprobadas. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const SEND_VARS = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];

export type WhatsAppSendConfig = { accessToken: string; phoneNumberId: string; graphVersion: string };

export function whatsappSendConfig(env: NodeJS.ProcessEnv = process.env): { config: WhatsAppSendConfig | null; missing: string[] } {
  const missing = missingEnv(SEND_VARS, env);
  if (missing.length) return { config: null, missing };
  const version = env.WHATSAPP_GRAPH_VERSION?.trim();
  return {
    config: {
      accessToken: env.WHATSAPP_ACCESS_TOKEN!.trim(),
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!.trim(),
      graphVersion: version && /^v\d{2,3}\.\d$/.test(version) ? version : DEFAULT_GRAPH_VERSION,
    },
    missing: [],
  };
}

/** Plantilla aprobada para retomar contacto fuera de la ventana de 24 h (opcional). */
export function reengagementTemplate(env: NodeJS.ProcessEnv = process.env): { name: string; language: string } | null {
  const name = env.WHATSAPP_REENGAGEMENT_TEMPLATE?.trim();
  if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) return null;
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "es_AR";
  return { name, language };
}

export function isWindowOpen(lastInboundAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  return now - new Date(lastInboundAt).getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}
