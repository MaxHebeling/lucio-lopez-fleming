/**
 * AI Photo Director — orden y portada sugeridos por REGLAS explicables (puras, sin IA). Nunca borra fotos: las
 * repetidas y las de baja calidad van al final. La sugerencia se aplica solo si una persona la confirma (servicio
 * `applySuggestedOrder`, auditado).
 *
 * Reglas (docs/ai/PROPERTY.md › Orden sugerido):
 * 1. Portada: la primera foto sin problemas según preferencia fachada → living → exterior → jardín → piscina → cocina →
 *    comedor → dormitorio. Sin fotos etiquetadas se mantiene la portada actual (no hay base para sugerir otra).
 * 2. Después, variedad: una foto por ambiente en el orden de recorrido (living, comedor, cocina, dormitorios, baños,
 *    jardín, piscina, exterior, otro, sin etiquetar), y luego el resto en ese mismo orden.
 * 3. Al final: planos etiquetados, fotos posiblemente oscuras/borrosas y repetidas (se mantiene la primera de cada grupo).
 * 4. Los archivos que no son fotos (planos, videos) quedan después, en su orden actual.
 */
import type { RoomKey } from "./quality-rules";

export type OrderMedia = {
  id: string;
  kind: string;
  isCover: boolean;
  sortOrder: number;
  room: RoomKey | null;
  /** Solo se conoce en fotos almacenadas y analizadas. */
  dark: boolean;
  blurry: boolean;
  /** No es la primera de su grupo de repetidas. */
  duplicateOf: string | null;
};

export type OrderReason = { mediaId: string; reason: string };

export type SuggestedOrder = {
  order: string[];
  heroId: string | null;
  currentHeroId: string | null;
  changed: boolean;
  reasons: OrderReason[];
  /** Sin etiquetas no se sugiere: la UI lo explica en lugar de un botón sin efecto. */
  basis: "tags" | "none";
};

export const HERO_PREFERENCE: RoomKey[] = ["fachada", "living", "exterior", "jardin", "piscina", "cocina", "comedor", "dormitorio"];
export const TOUR_ORDER: Array<RoomKey | null> = ["fachada", "living", "comedor", "cocina", "dormitorio", "bano", "jardin", "piscina", "exterior", "otro", null];

const ROOM_TEXT: Record<RoomKey, string> = {
  fachada: "fachada",
  living: "living",
  cocina: "cocina",
  comedor: "comedor",
  dormitorio: "dormitorio",
  bano: "baño",
  jardin: "jardín",
  piscina: "piscina",
  exterior: "exterior",
  plano: "plano",
  otro: "otro ambiente",
};

export function suggestPhotoOrder(media: OrderMedia[]): SuggestedOrder {
  const current = [...media].sort((a, b) => a.sortOrder - b.sortOrder);
  const currentOrder = current.map((m) => m.id);
  const images = current.filter((m) => m.kind === "image");
  const others = current.filter((m) => m.kind !== "image");
  const currentHero = images.find((m) => m.isCover) ?? null;
  const tagged = images.some((m) => m.room !== null);
  if (!tagged) return { order: currentOrder, heroId: currentHero?.id ?? null, currentHeroId: currentHero?.id ?? null, changed: false, reasons: [], basis: "none" };

  const reasons: OrderReason[] = [];
  const problem = (m: OrderMedia) => m.dark || m.blurry || m.duplicateOf !== null;
  const healthy = images.filter((m) => !problem(m) && m.room !== "plano");

  let hero: OrderMedia | null = null;
  for (const room of HERO_PREFERENCE) {
    hero = healthy.find((m) => m.room === room) ?? null;
    if (hero) {
      reasons.push({ mediaId: hero.id, reason: `Portada sugerida: ${ROOM_TEXT[room]} sin problemas de luz, nitidez ni repetición` });
      break;
    }
  }
  if (!hero && currentHero && !problem(currentHero)) hero = currentHero;

  const rest = healthy.filter((m) => m.id !== hero?.id);
  const buckets = new Map<RoomKey | null, OrderMedia[]>();
  for (const m of rest) buckets.set(m.room, [...(buckets.get(m.room) ?? []), m]);
  const firstPass: OrderMedia[] = [];
  const secondPass: OrderMedia[] = [];
  for (const room of TOUR_ORDER) {
    const list = buckets.get(room) ?? [];
    if (list[0]) firstPass.push(list[0]);
    secondPass.push(...list.slice(1));
  }
  const plans = images.filter((m) => m.room === "plano" && !problem(m) && m.id !== hero?.id);
  const lowQuality = images.filter((m) => (m.dark || m.blurry) && m.duplicateOf === null);
  const duplicates = images.filter((m) => m.duplicateOf !== null);
  for (const m of plans) reasons.push({ mediaId: m.id, reason: "Plano: después de las fotos de ambientes" });
  for (const m of lowQuality) reasons.push({ mediaId: m.id, reason: `${m.dark ? "Posiblemente oscura" : "Posiblemente borrosa"}: al final (no se borra)` });
  for (const m of duplicates) reasons.push({ mediaId: m.id, reason: "Repetida de otra foto: al final (no se borra)" });
  if (firstPass.length > 1) reasons.push({ mediaId: firstPass[0]!.id, reason: "Luego, una foto por ambiente en orden de recorrido para dar variedad" });

  const order = [...(hero ? [hero] : []), ...firstPass, ...secondPass, ...plans, ...lowQuality, ...duplicates, ...others].map((m) => m.id);
  const heroId = hero?.id ?? currentHero?.id ?? null;
  return { order, heroId, currentHeroId: currentHero?.id ?? null, changed: order.join(",") !== currentOrder.join(",") || heroId !== (currentHero?.id ?? null), reasons, basis: "tags" };
}
