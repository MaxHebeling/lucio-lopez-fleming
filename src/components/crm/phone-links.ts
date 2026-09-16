/** Enlaces de llamada y WhatsApp (funciones puras, usables en servidor y cliente). */
export type PhoneLike = { phone_e164: string | null; phone_raw: string };

export function telHref(p: PhoneLike): string {
  return `tel:${p.phone_e164 ?? p.phone_raw.replace(/[^\d+]/g, "")}`;
}

/** wa.me solo acepta el número internacional sin "+". Sin E.164 no se ofrece WhatsApp. */
export function waHref(p: PhoneLike): string | null {
  return p.phone_e164 ? `https://wa.me/${p.phone_e164.replace(/\D/g, "")}` : null;
}
