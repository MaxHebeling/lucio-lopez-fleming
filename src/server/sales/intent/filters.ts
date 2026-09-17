/**
 * Intención → filtros REALES del buscador público (SearchFilters) + chips que explican qué se entendió.
 * Puro y sin dependencias de servidor: lo usan el servicio, la UI del sitio y los tests.
 *
 * El buscador filtra una operación, un tipo y una zona por vez: si la persona pidió varias, se muestran como chips
 * informativos (con link a cada opción) y no se elige una por ella.
 */
import { filtersToQuery, OPERATION_TO_SLUG, type SearchFilters } from "../../properties/public-helpers";
import type { SalesCatalog, SearchIntent, SoftPreference } from "./schema";

export type IntentChip = {
  key: string;
  label: string;
  /** true = se aplicó como filtro del buscador. false = informativo (no filtra). */
  filters: boolean;
  origin: "text" | "inferred" | "ai";
  confidence: number;
};

const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const money = (n: number, currency: "USD" | "ARS") => `${currency === "USD" ? "USD" : "$"} ${nf.format(n)}`;

export const SOFT_LABEL: Record<SoftPreference, string> = {
  quiet: "tranquilo",
  bright: "luminoso",
  near_city: "cerca de la ciudad",
  brand_new: "a estrenar",
  view: "con vista",
  gated_community: "barrio cerrado",
  spacious: "amplio",
  investment: "para invertir",
  pets: "con mascotas",
};

export const TIMEFRAME_LABEL = { immediate: "lo antes posible", within_3_months: "en los próximos 3 meses", within_6_months: "en los próximos 6 meses", later: "más adelante" } as const;

/** Filtros del buscador a partir de la intención (solo lo que el buscador puede filtrar de verdad). */
export function intentToFilters(i: SearchIntent): Partial<SearchFilters> & { caracteristicas: string[] } {
  const f: Partial<SearchFilters> & { caracteristicas: string[] } = { caracteristicas: [] };
  if (i.transactionType) f.operacion = OPERATION_TO_SLUG[i.transactionType.value];
  if (i.propertyTypes?.value.length === 1) f.tipo = i.propertyTypes.value[0];
  const locs = i.locations?.value ?? [];
  if (locs.length === 1) {
    const l = locs[0]!;
    if (l.kind === "locality") f.zona = l.slug;
    else {
      f.barrio = l.slug;
      if (l.localitySlug) f.zona = l.localitySlug;
    }
  }
  if (i.currency && (i.budgetMin || i.budgetMax)) {
    f.moneda = i.currency.value;
    if (i.budgetMin) f.precio_min = i.budgetMin.value;
    if (i.budgetMax) f.precio_max = i.budgetMax.value;
  }
  if (i.bedrooms && i.bedrooms.value > 0) f.dormitorios = i.bedrooms.value;
  if (i.bathrooms) f.banos = i.bathrooms.value;
  if (i.garages) f.cocheras = i.garages.value;
  if (i.surface?.value.min) f.superficie_min = i.surface.value.min;
  if (i.surface?.value.max) f.superficie_max = i.surface.value.max;
  if (i.financing?.value === "credit") f.credito = true;
  if (i.features) f.caracteristicas = [...i.features.value];
  return f;
}

/** URL del listado real con esos filtros (misma forma que las URLs canónicas: /propiedades/venta?…). */
export function listingHref(f: Partial<SearchFilters>): string {
  const base = f.operacion === "venta" || f.operacion === "alquiler" ? `/propiedades/${f.operacion}` : "/propiedades";
  const omit: Array<keyof SearchFilters> = f.operacion === "venta" || f.operacion === "alquiler" ? ["operacion"] : [];
  return `${base}${filtersToQuery({ caracteristicas: [], ...f }, omit)}`;
}

/** Chips legibles («Casa · 3+ dormitorios · hasta USD 180.000 · con jardín»). */
export function intentChips(i: SearchIntent, catalog: SalesCatalog): IntentChip[] {
  const chips: IntentChip[] = [];
  const push = (key: string, label: string, filters: boolean, s: { origin: IntentChip["origin"]; confidence: number }) => chips.push({ key, label, filters, origin: s.origin, confidence: s.confidence });
  const typeName = (k: string) => catalog.types.find((t) => t.key === k)?.name ?? k;
  const featureName = (k: string) => catalog.features.find((x) => x.key === k)?.name.toLowerCase() ?? k.replace(/_/g, " ");

  if (i.propertyTypes) {
    const names = i.propertyTypes.value.map(typeName);
    push("tipo", names.length === 1 ? names[0]! : `${names.join(" o ")} (elegí uno para filtrar)`, names.length === 1, i.propertyTypes);
  }
  if (i.transactionType) push("operacion", { sale: "Compra", rent: "Alquiler", temporary_rent: "Alquiler temporario" }[i.transactionType.value], true, i.transactionType);
  if (i.locations) {
    const names = i.locations.value.map((l) => l.name);
    push("zona", names.length === 1 ? names[0]! : `${names.join(" o ")} (el buscador filtra una zona por vez)`, names.length === 1, i.locations);
  }
  if (i.bedrooms && i.bedrooms.value > 0) push("dormitorios", `${i.bedrooms.value}+ ${i.bedrooms.value === 1 ? "dormitorio" : "dormitorios"}${i.bedrooms.origin === "inferred" ? " (por ambientes)" : ""}`, true, i.bedrooms);
  if (i.bathrooms) push("banos", `${i.bathrooms.value}+ ${i.bathrooms.value === 1 ? "baño" : "baños"}`, true, i.bathrooms);
  if (i.currency && (i.budgetMin || i.budgetMax)) {
    const cur = i.currency.value;
    const conf = { origin: (i.budgetMax ?? i.budgetMin)!.origin, confidence: Math.min(i.budgetMax?.confidence ?? 1, i.budgetMin?.confidence ?? 1) };
    const label = i.budgetMin && i.budgetMax ? `${money(i.budgetMin.value, cur)} a ${money(i.budgetMax.value, cur)}` : i.budgetMax ? `hasta ${money(i.budgetMax.value, cur)}` : `desde ${money(i.budgetMin!.value, cur)}`;
    push("precio", label, true, conf);
  }
  if (i.surface) {
    const { min, max } = i.surface.value;
    push("superficie", min && max ? `${nf.format(min)} a ${nf.format(max)} m²` : min ? `desde ${nf.format(min)} m²` : `hasta ${nf.format(max!)} m²`, true, i.surface);
  }
  if (i.garages) push("cocheras", i.garages.value === 1 ? "con cochera" : `${i.garages.value}+ cocheras`, true, i.garages);
  for (const k of i.features?.value ?? []) push(`caracteristica:${k}`, `con ${featureName(k)}`, true, i.features!);
  if (i.financing) push("financiacion", i.financing.value === "credit" ? "Apto crédito" : "Pago de contado (no filtra)", i.financing.value === "credit", i.financing);
  if (i.moveTimeframe) push("plazo", `Mudanza ${TIMEFRAME_LABEL[i.moveTimeframe.value]} (no filtra)`, false, i.moveTimeframe);
  for (const p of i.preferences) push(`preferencia:${p}`, `${SOFT_LABEL[p]} (no filtra)`, false, { origin: "text", confidence: 1 });
  return chips;
}
