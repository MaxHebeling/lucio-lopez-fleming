/**
 * Autenticación de webhooks de Meta. Funciones puras.
 * - Verificación (GET): hub.mode=subscribe y hub.verify_token igual a WHATSAPP_VERIFY_TOKEN → se devuelve hub.challenge.
 * - Firma (POST): X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo crudo, App Secret) en hex.
 * Toda comparación es en tiempo constante.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Compara igual contra sí mismo para no filtrar por tiempo la longitud esperada
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function computeSignature(rawBody: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

export function verifySignature(rawBody: string | Buffer, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const value = header.trim();
  if (!/^sha256=[0-9a-fA-F]{64}$/.test(value)) return false;
  return constantTimeEqual(computeSignature(rawBody, appSecret), `sha256=${value.slice(7).toLowerCase()}`);
}

export type VerificationResult = { ok: true; challenge: string } | { ok: false; reason: "not_configured" | "invalid" };

export function verifySubscription(params: URLSearchParams, expectedToken: string | undefined): VerificationResult {
  if (!expectedToken) return { ok: false, reason: "not_configured" };
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !constantTimeEqual(token, expectedToken)) return { ok: false, reason: "invalid" };
  if (!/^[\w.-]{1,200}$/.test(challenge)) return { ok: false, reason: "invalid" };
  return { ok: true, challenge };
}
