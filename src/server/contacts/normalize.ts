/** Normalización de emails y teléfonos (Argentina primero) para deduplicar contactos. Funciones puras. */

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

export type NormalizedPhone = { e164: string; mobile: boolean } | null;

/**
 * Convierte un teléfono a E.164. Reglas AR:
 * - quita +54 / 54 / 00 / 0 de larga distancia;
 * - "15" después del código de área indica celular (se elimina y se marca mobile);
 * - celulares en E.164 llevan 9 después de 54 (+54 9 387 5775468);
 * - si no hay certeza de celular, `assumeMobile` (p. ej. viene por WhatsApp) decide.
 * Números extranjeros con + se aceptan tal cual si tienen 8–15 dígitos.
 */
export function normalizePhone(
  raw: string | null | undefined,
  opts: { assumeMobile?: boolean; defaultAreaCode?: string } = {},
): NormalizedPhone {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+") && !digits.startsWith("54")) {
    return digits.length >= 8 && digits.length <= 15 ? { e164: `+${digits}`, mobile: false } : null;
  }
  if (digits.startsWith("00")) digits = digits.slice(2);
  let mobile = false;
  if (digits.startsWith("54") && digits.length >= 12) {
    digits = digits.slice(2);
    if (digits.startsWith("9")) {
      mobile = true;
      digits = digits.slice(1);
    }
  }
  if (digits.startsWith("0")) digits = digits.slice(1);

  // Área (2 a 4 dígitos) + "15" + abonado → celular
  const m15 = /^(\d{2,4})15(\d{6,8})$/.exec(digits);
  if (m15 && m15[1]!.length + m15[2]!.length === 10) {
    digits = m15[1]! + m15[2]!;
    mobile = true;
  }
  // Número local de 7 dígitos: se completa con el área por defecto (Salta: 387)
  if (digits.length === 7 && opts.defaultAreaCode) digits = opts.defaultAreaCode + digits;
  if (digits.length !== 10) return null;
  mobile = mobile || Boolean(opts.assumeMobile);
  return { e164: `+54${mobile ? "9" : ""}${digits}`, mobile };
}

/** Clave de comparación: número nacional significativo (sin 9 de celular). */
export function phoneMatchKey(e164: string): string {
  return e164.replace(/\D/g, "").slice(-10);
}

export function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { first: parts[0] || null, last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1)! };
}

const CONTROL_OR_TAGS = /[\p{Cc}<>]/gu;

export function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(CONTROL_OR_TAGS, "").replace(/\s+/g, " ").trim();
  return s.length ? s.slice(0, 200) : null;
}
