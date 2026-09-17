/**
 * Propiedades con dirección oculta cuyo título o descripción igual la menciona con altura (p. ej. el código 1893
 * importado con título "calle Las Heras 1241"). No se corrigen datos importados: se listan para revisión humana
 * en el CRM (listado y ficha de propiedades).
 */
import type { Executor } from "../db";
import { requirePermission, type Actor } from "../auth/actor";
import { publicStreet } from "./public-helpers";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STREET_PREFIX = /^(?:calle|avenida|avda\.?|av\.?|pasaje|pje\.?|psje\.?|boulevard|bv\.?|bvd\.?)\s+/;
// Altura: "1241", "N° 1241", "nro 1241", "al 1200". No cuenta si es una medida ("250 m2", "300 metros", "5 km").
const HEIGHT = String.raw`(?:(?:n[°ºo]?\.?|nro\.?|num\.?|numero|al)\s*)?\d{1,5}\b(?!\s*(?:m\b|m2|m²|mts|metros|km|cuadras|ha\b|hectareas))`;
const GENERIC = new RegExp(String.raw`\b(?:calle|avenida|avda\.?|av\.|pasaje|pje\.?)\s+[a-z][a-z.]*(?: [a-z][a-z.]*){0,3}\s+${HEIGHT}`);

/** Fragmento (normalizado) que revela calle + altura, o null. Puro: se testea en tests/unit/address-leak.test.ts. */
export function addressLeakInText(p: { street: string | null; title: string | null; description: string | null }): string | null {
  const texts = [p.title, p.description].filter((t): t is string => Boolean(t && t.trim())).map(norm);
  if (!texts.length) return null;
  const streetName = norm(publicStreet(p.street, null, true) ?? "").replace(STREET_PREFIX, "").trim();
  const own = streetName.length >= 3 ? new RegExp(String.raw`\b${escapeRe(streetName)}\s+${HEIGHT}`) : null;
  for (const t of texts) {
    const m = (own && own.exec(t)) || GENERIC.exec(t);
    if (m) return m[0].trim();
  }
  return null;
}

export type AddressLeak = { id: string; code: number; title: string; snippet: string };

/** Publicadas, con dirección oculta, cuyo título o descripción menciona la dirección con altura. */
export async function listAddressLeaks(db: Executor, actor: Actor): Promise<AddressLeak[]> {
  requirePermission(actor, "properties.read");
  const rows = await db
    .selectFrom("properties")
    .select(["id", "code", "title", "description", "address_street"])
    .where("is_published", "=", true)
    .where("hide_exact_address", "=", true)
    .where("deleted_at", "is", null)
    .orderBy("code")
    .execute();
  const out: AddressLeak[] = [];
  for (const r of rows) {
    const snippet = addressLeakInText({ street: r.address_street, title: r.title, description: r.description });
    if (snippet) out.push({ id: r.id, code: r.code, title: r.title, snippet });
  }
  return out;
}
