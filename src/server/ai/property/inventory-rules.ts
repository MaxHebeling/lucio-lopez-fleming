/**
 * Análisis de inventario — reglas puras. Marca OPORTUNIDADES de revisión (no causas): una publicación con muchos días y
 * pocas consultas se lista con lo que conviene revisar según evidencia real del informe de calidad. El texto nunca
 * afirma causalidad ("no indica la causa").
 *
 * Diseñado para sumar señales después sin romper: `pageViews` (vistas de la ficha, las agrega otra rama) es opcional;
 * si llega, se muestra y habilita la regla «muchas vistas y pocas consultas».
 */
export type InventorySettings = { minDaysPublished: number; lowLeadsThreshold: number; minSample: number };
export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = { minDaysPublished: 30, lowLeadsThreshold: 2, minSample: 10 };

export type InventoryInput = {
  daysPublished: number | null;
  leads: number | null;
  visits: number;
  qualityScore: number | null;
  findingCodes: string[];
  hasCover: boolean;
  coverRoom: string | null;
  priceHidden: boolean;
  pageViews?: number | null;
};

export type Opportunity = { checks: string[]; text: string };

const HERO_ROOMS = new Set(["fachada", "living", "exterior", "jardin", "piscina"]);

export function reviewChecks(i: InventoryInput): string[] {
  const has = (prefix: string) => i.findingCodes.some((c) => c.startsWith(prefix));
  const checks: string[] = [];
  if (!i.hasCover || has("missing_cover") || (i.coverRoom !== null && !HERO_ROOMS.has(i.coverRoom))) checks.push("hero");
  if (i.priceHidden || has("price_") || has("missing_price")) checks.push("precio");
  if (has("missing_description") || has("description_")) checks.push("descripción");
  if (has("photo_duplicate") || has("photo_dark") || has("photo_blurry") || has("missing_photos") || has("missing_exterior")) checks.push("calidad visual");
  return checks;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function inventoryOpportunity(i: InventoryInput, s: InventorySettings = DEFAULT_INVENTORY_SETTINGS): Opportunity | null {
  if (i.daysPublished === null || i.leads === null) return null;
  if (i.daysPublished < s.minDaysPublished) return null;
  const lowLeads = i.leads <= s.lowLeadsThreshold;
  const viewsNoLeads = typeof i.pageViews === "number" && i.pageViews >= 100 && i.leads <= s.lowLeadsThreshold;
  if (!lowLeads) return null;
  const checks = reviewChecks(i);
  const parts = [`${plural(i.daysPublished, "día publicada", "días publicada")}`, i.leads === 0 ? "sin consultas" : `pocas consultas (${i.leads})`];
  if (viewsNoLeads) parts.push(`${i.pageViews} vistas`);
  const review = checks.length ? `revisar: ${checks.join(", ")}` : "revisar: hero, precio, descripción y calidad visual (el informe de calidad no marca problemas concretos)";
  return { checks, text: `${parts.join(" · ")} · ${review}. No indica la causa: es una sugerencia de revisión.` };
}

/** Mediana de consultas del inventario comparable (solo con muestra suficiente; si no, null). */
export function inventoryLeadsMedian(values: number[], s: InventorySettings = DEFAULT_INVENTORY_SETTINGS): number | null {
  if (values.length < s.minSample) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}
