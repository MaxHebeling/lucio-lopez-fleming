/**
 * Guardas posteriores a la IA (código, no prompt). Funciones puras.
 * Toda cifra o referencia verificable que la respuesta mencione tiene que haber salido de las herramientas
 * de ESE turno (o del propio cliente, en el caso de montos que él dijo). Si no, la respuesta se descarta
 * y la conversación se deriva a una persona.
 */

export type GroundingFacts = {
  propertyCodes: Set<number>;
  amounts: Set<number>;
  areas: Set<number>;
  urls: Set<string>;
  /** Teléfonos/emails aportados por herramientas o por el cliente */
  contacts: Set<string>;
};

export type ViolationKind = "property_code" | "amount" | "area" | "percentage" | "url" | "phone" | "email";
export type Violation = { kind: ViolationKind; value: string };

export function emptyFacts(): GroundingFacts {
  return { propertyCodes: new Set(), amounts: new Set(), areas: new Set(), urls: new Set(), contacts: new Set() };
}

const MULTIPLIERS: Record<string, number> = { mil: 1_000, k: 1_000, millon: 1_000_000, millón: 1_000_000, millones: 1_000_000 };

/** "120.000" → 120000 · "1.200.000,50" → 1200000.5 · "1,5" → 1.5 · "120,000" → 120000 · "2.5" → 2.5 */
export function parseArgentineNumber(raw: string): number | null {
  const s = raw.trim().replace(/[.,]+$/, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) normalized = s.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(s)) normalized = s.replace(",", ".");
  else if (/^\d+(\.\d+)?$/.test(s)) normalized = s;
  else return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function withMultiplier(num: string, mult: string | undefined): number | null {
  const n = parseArgentineNumber(num);
  if (n === null) return null;
  const m = mult ? MULTIPLIERS[mult.toLowerCase()] : 1;
  return Math.round(n * (m ?? 1) * 100) / 100;
}

const NUM = String.raw`(\d[\d.,]*\d|\d)`;
const MULT = String.raw`(?:\s*(mil|millones|millón|millon|k)(?![\p{L}]))?`;
const CURRENCY_BEFORE = new RegExp(String.raw`(?<![\p{L}])(?:u\$s|us\$|u\$d|usd|ars|\$)\s*${NUM}${MULT}`, "giu");
const CURRENCY_AFTER = new RegExp(String.raw`${NUM}${MULT}\s*(?:de\s+)?(?:d[oó]lares|pesos|usd|ars|u\$s)(?![\p{L}])`, "giu");
const AREA = new RegExp(String.raw`${NUM}\s*(?:m2|m²|mts2|mts²|mt2|metros\s+cuadrados)(?![\p{L}\d])`, "giu");
const PERCENT = /\d+(?:[.,]\d+)?\s*%/g;
const CODE = /(?:c[oó]digo|c[oó]d\.|ref(?:erencia)?\.?|n[°º]|nro\.?|#)\s*:?\s*(\d{1,7})(?!\d)|propiedad(?:es)?\s+(\d{3,7})(?!\d)/giu;
const URL_RE = /https?:\/\/[^\s<>()"'\]]+/gi;
const PATH_RE = /(?<![\w/.])\/propiedades\/[a-z0-9-]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(?<![\w])\+?\d[\d\s-]{6,}\d(?![\w])/g;

export function normalizeUrl(u: string): string {
  return u.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "").toLowerCase();
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Montos mencionados con moneda explícita. */
export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  for (const re of [CURRENCY_BEFORE, CURRENCY_AFTER]) {
    for (const m of text.matchAll(re)) {
      const n = withMultiplier(m[1]!, m[2]);
      if (n !== null) out.push(n);
    }
  }
  return out;
}

/** Todo número que escribió el cliente (presupuesto "100 mil", "150.000"), para permitir que la IA lo repita. */
export function extractAnyNumbers(text: string): number[] {
  const re = new RegExp(`${NUM}${MULT}`, "giu");
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const n = withMultiplier(m[1]!, m[2]);
    if (n !== null) out.push(n);
  }
  return out;
}

export function addCustomerText(facts: GroundingFacts, text: string): void {
  for (const n of extractAnyNumbers(text)) facts.amounts.add(n);
  for (const e of text.match(EMAIL_RE) ?? []) facts.contacts.add(e.toLowerCase());
  for (const p of text.match(PHONE_RE) ?? []) facts.contacts.add(digits(p).slice(-10));
}

/** Texto que viene de la base (p. ej. descripción publicada): sus cifras cuentan como verificadas. */
export function addGroundedText(facts: GroundingFacts, text: string): void {
  for (const n of extractAnyNumbers(text)) {
    facts.amounts.add(n);
    facts.areas.add(n);
  }
}

export function findViolations(reply: string, facts: GroundingFacts): Violation[] {
  const violations: Violation[] = [];
  const add = (kind: ViolationKind, value: string) => {
    if (!violations.some((v) => v.kind === kind && v.value === value)) violations.push({ kind, value });
  };

  // URLs primero: se quitan del texto para no confundir sus números con montos o teléfonos
  let rest = reply;
  for (const m of reply.match(URL_RE) ?? []) {
    if (!facts.urls.has(normalizeUrl(m))) add("url", m);
    rest = rest.replace(m, " ");
  }
  for (const m of rest.match(PATH_RE) ?? []) {
    const known = [...facts.urls].some((u) => u.endsWith(m.toLowerCase()));
    if (!known) add("url", m);
    rest = rest.replace(m, " ");
  }
  for (const m of rest.match(EMAIL_RE) ?? []) {
    if (!facts.contacts.has(m.toLowerCase())) add("email", m);
    rest = rest.replace(m, " ");
  }

  for (const m of rest.matchAll(CODE)) {
    const code = Number(m[1] ?? m[2]);
    if (!facts.propertyCodes.has(code)) add("property_code", String(code));
  }
  for (const n of extractAmounts(rest)) {
    if (!facts.amounts.has(n)) add("amount", String(n));
  }
  for (const m of rest.matchAll(AREA)) {
    const n = parseArgentineNumber(m[1]!);
    if (n === null || !facts.areas.has(Math.round(n * 100) / 100)) add("area", m[0].trim());
  }
  for (const m of rest.match(PERCENT) ?? []) add("percentage", m.trim());

  // Teléfonos: secuencias largas de dígitos que no son montos/códigos ya evaluados
  const withoutMoney = rest.replace(CURRENCY_BEFORE, " ").replace(CURRENCY_AFTER, " ").replace(CODE, " ").replace(AREA, " ");
  // Montos sin moneda con separador de miles ("120.000"): también tienen que estar verificados
  for (const m of withoutMoney.match(/(?<![\d.,])\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)/g) ?? []) {
    const n = parseArgentineNumber(m);
    if (n !== null && !facts.amounts.has(n) && !facts.areas.has(n)) add("amount", String(n));
  }
  for (const m of withoutMoney.match(PHONE_RE) ?? []) {
    const d = digits(m);
    if (d.length < 8) continue;
    if (/^\d{1,3}([.,]\d{3})+$/.test(m.trim())) continue; // número con separador de miles sin moneda
    if (!facts.contacts.has(d.slice(-10))) add("phone", m.trim());
  }
  return violations;
}
