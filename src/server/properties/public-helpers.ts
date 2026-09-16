/**
 * Helpers puros del sitio público (sin base ni Next): filtros de búsqueda en la URL, privacidad de la dirección,
 * titulares y enlaces de WhatsApp. Se testean en tests/unit/public-helpers.test.ts.
 */
import { z } from "zod";

import { OPERATION_NOUN, OPERATION_SLUGS, SORTS, type PublicOperation } from "./public-constants";

export * from "./public-constants";

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const text = (max: number) =>
  z.preprocess((v) => {
    const s = first(v);
    return typeof s === "string" && s.trim() !== "" ? s.trim().slice(0, max) : undefined;
  }, z.string().optional());
const slug = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && /^[a-z0-9_-]{1,140}$/.test(s) ? s : undefined;
}, z.string().optional());
const num = (max: number) =>
  z.preprocess((v) => {
    const s = first(v);
    if (typeof s !== "string" || s.trim() === "") return undefined;
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
  }, z.number().optional());
const int = (max: number) =>
  z.preprocess((v) => {
    const s = first(v);
    const n = typeof s === "string" ? Number.parseInt(s, 10) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
  }, z.number().int().optional());

/**
 * Filtros aceptados en la URL. Todo valor inválido se descarta en silencio (una URL vieja o editada a mano
 * nunca rompe la página: muestra resultados sin ese filtro).
 */
export const searchFiltersSchema = z.object({
  operacion: z.preprocess((v) => (typeof first(v) === "string" && first(v) in OPERATION_SLUGS ? first(v) : undefined), z.enum(["venta", "alquiler", "temporario"]).optional()),
  tipo: slug,
  zona: slug,
  barrio: slug,
  moneda: z.preprocess((v) => (first(v) === "USD" || first(v) === "ARS" ? first(v) : undefined), z.enum(["USD", "ARS"]).optional()),
  precio_min: num(1e12),
  precio_max: num(1e12),
  dormitorios: int(20),
  banos: int(20),
  cocheras: int(20),
  superficie_min: num(1e9),
  superficie_max: num(1e9),
  credito: z.preprocess((v) => first(v) === "1" || first(v) === "on" || first(v) === "true", z.boolean()),
  caracteristicas: z.preprocess((v) => {
    const all = (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === "string" ? x.split(",") : []));
    return [...new Set(all.map((s) => s.trim()).filter((s) => /^[a-z0-9_]{2,80}$/.test(s)))].slice(0, 12);
  }, z.array(z.string())),
  q: text(80),
  orden: z.preprocess((v) => ((SORTS as readonly unknown[]).includes(first(v)) ? first(v) : undefined), z.enum(SORTS).optional()),
  pagina: z.preprocess((v) => {
    const n = Number.parseInt(String(first(v) ?? ""), 10);
    return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 1;
  }, z.number().int()),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export function parseSearchFilters(params: Record<string, string | string[] | undefined>, preset: Partial<SearchFilters> = {}): SearchFilters {
  const parsed = searchFiltersSchema.parse(params);
  return { ...parsed, ...preset };
}

/** Filtros → query string estable (orden fijo, sin vacíos). `omit` saca claves que ya fija la ruta. */
export function filtersToQuery(f: Partial<SearchFilters>, omit: Array<keyof SearchFilters> = []): string {
  const qs = new URLSearchParams();
  const order: Array<keyof SearchFilters> = [
    "q", "operacion", "tipo", "zona", "barrio", "moneda", "precio_min", "precio_max", "dormitorios", "banos", "cocheras",
    "superficie_min", "superficie_max", "credito", "caracteristicas", "orden", "pagina",
  ];
  for (const k of order) {
    if (omit.includes(k)) continue;
    const v = f[k];
    if (v === undefined || v === null || v === false || v === "") continue;
    if (k === "pagina" && v === 1) continue;
    if (k === "orden" && v === "recientes") continue;
    if (Array.isArray(v)) {
      if (v.length) qs.set(k, v.join(","));
    } else qs.set(k, v === true ? "1" : String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function activeFilterCount(f: SearchFilters, omit: Array<keyof SearchFilters> = []): number {
  const keys: Array<keyof SearchFilters> = ["tipo", "zona", "barrio", "moneda", "precio_min", "precio_max", "dormitorios", "banos", "cocheras", "superficie_min", "superficie_max", "credito", "q", "operacion"];
  let n = 0;
  for (const k of keys) {
    if (omit.includes(k)) continue;
    const v = f[k];
    if (v !== undefined && v !== false && v !== "") n++;
  }
  return n + f.caracteristicas.length;
}

// ───────────────────────── Privacidad de la dirección ─────────────────────────

/**
 * Calle pública. Con `hideExact` nunca sale la altura: se quitan números y construcciones como "al 100",
 * "N° 639", "km 5", piso y depto. Si no queda un nombre de calle razonable, devuelve null (se muestra la zona).
 */
export function publicStreet(street: string | null, number: string | null, hideExact: boolean): string | null {
  const clean = (street ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (!hideExact) return [clean, number?.trim()].filter(Boolean).join(" ");
  const noNumber = clean
    .replace(/\b(al|n[°ºo]?\.?|nro\.?|num\.?|km\.?|altura|esq(uina)?\.?)\s*\d.*$/i, "")
    .replace(/\d+/g, "")
    .replace(/[#°º,.\-/\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return noNumber.length >= 3 ? noNumber : null;
}

/**
 * Coordenadas públicas. Con dirección oculta se redondean a 2 decimales (celda de ≈1,1 km): sirven para ubicar
 * la zona, no la casa. Sin dirección oculta, exactas.
 */
export function publicCoordinates(lat: string | number | null, lng: string | number | null, hideExact: boolean): { lat: number; lng: number; approximate: boolean } | null {
  if (lat === null || lng === null || lat === "" || lng === "") return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null;
  if (!hideExact) return { lat: la, lng: ln, approximate: false };
  return { lat: Math.round(la * 100) / 100, lng: Math.round(ln * 100) / 100, approximate: true };
}

// ───────────────────────── Textos ─────────────────────────

const LOWER_WORDS = new Set(["en", "de", "del", "la", "las", "el", "los", "y", "con", "a", "al", "por", "para", "e"]);

/** "CASA EN VENTA CAMPO QUIJANO" → "Casa en venta Campo Quijano" (respeta nombres propios existentes). */
export function tidyTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const letters = t.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const shouting = letters.length > 4 && letters === letters.toUpperCase();
  const base = shouting ? t.toLowerCase() : t;
  const words = base.split(" ").map((w, i) => {
    if (i > 0 && LOWER_WORDS.has(w.toLowerCase())) return w.toLowerCase();
    if (shouting && i > 2) return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  });
  const out = words.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Titular editorial consistente: "Casa en venta en El Tipal". */
export function propertyHeadline(typeName: string, operation: PublicOperation | null, zone: string | null): string {
  const parts = [typeName];
  if (operation) parts.push(`en ${OPERATION_NOUN[operation]}`);
  if (zone) parts.push(`en ${zone}`);
  return parts.join(" ");
}

/** ¿El título cargado agrega algo al titular generado? ("casa en venta" no; "Depto Dean Funes Premium" sí). */
export function titleAddsInfo(title: string, typeName: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const generic = new Set([...norm(typeName).split(" "), "en", "venta", "alquiler", "de", "la", "el", "y", "casa", "departamento", "depto", "terreno", "lote", "local", "oficina", "comercial", "temporario"]);
  return norm(title)
    .split(" ")
    .some((w) => w.length > 2 && !generic.has(w));
}

/** Link de WhatsApp con texto prellenado. Solo acepta E.164 válido. */
export function whatsappHref(e164: string | null | undefined, message: string): string | null {
  if (!e164 || !/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(message)}`;
}

/** Teléfono visible → href tel: ("+54 387 421-4143" → "tel:+543874214143"). */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}

export function formatArea(m2: string | number | null | undefined): string | null {
  if (m2 === null || m2 === undefined || m2 === "") return null;
  const n = Number(m2);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 10_000) return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n / 10_000)} ha`;
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)} m²`;
}

export function formatPrice(amount: string | number | null, currency: string, hidden: boolean): string {
  if (hidden || amount === null || amount === "") return "Consultar";
  const n = Number(amount);
  const s = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);
  return currency === "USD" ? `USD ${s}` : `$ ${s}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${new Intl.NumberFormat("es-AR").format(n)} ${n === 1 ? one : many}`;
}
