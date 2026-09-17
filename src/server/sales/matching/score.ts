/**
 * Motor de coincidencias cliente ↔ propiedad (puro, explicable, versionado). Ver docs/ai/SALES.md › Coincidencias.
 *
 * 1. Filtros OBLIGATORIOS (si falla uno, no es candidata): publicada y disponible, operación, tipo y presupuesto con
 *    tolerancia (`ai.matching.budget_tolerance_pct`, 10 % por defecto).
 * 2. Preferencias PONDERADAS (solo las que el cliente expresó): presupuesto 25 · zonas 25 · dormitorios 20 ·
 *    superficie 15 · características 15 · baños 10. Puntaje = puntos obtenidos / puntos posibles × 100.
 * 3. Señales de comportamiento: vio la propiedad en el sitio +5 (tope 100).
 * Resultado: «coincidencia estimada», con lo que coincide y lo que conviene considerar. Nunca una certeza.
 */
import type { LocationValue } from "../profile/fields";

export const MATCH_ALGORITHM_VERSION = "match-2026.09.17-1";
export const DEFAULT_BUDGET_TOLERANCE_PCT = 10;
export const DEFAULT_MIN_SCORE = 55;

export const WEIGHTS = { budget: 25, locations: 25, bedrooms: 20, surface: 15, features: 15, bathrooms: 10 } as const;
const VIEWED_BONUS = 5;

export type Eff<T> = { value: T; confirmed: boolean };

export type MatchProfile = {
  transactionType?: Eff<"sale" | "rent" | "temporary_rent">;
  propertyTypes?: Eff<string[]>;
  budget?: Eff<{ min: number | null; max: number | null; currency: "USD" | "ARS" }>;
  locations?: Eff<LocationValue[]>;
  bedroomsMin?: Eff<number>;
  bathroomsMin?: Eff<number>;
  surface?: Eff<{ min: number | null; max: number | null }>;
  features?: Eff<string[]>;
};

export type MatchProperty = {
  id: string;
  code: number;
  published: boolean;
  status: string;
  typeKey: string;
  typeName: string;
  /** Localidad y barrio de la propiedad (slugs), resueltos del árbol de ubicaciones. */
  localitySlug: string | null;
  areaSlug: string | null;
  zoneLabel: string | null;
  operations: Array<{ operation: string; currency: "USD" | "ARS"; amount: number | null; priceHidden: boolean }>;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Superficie de referencia: total, o terreno, o cubierta. */
  surfaceM2: number | null;
  featureKeys: string[];
};

export type MatchSignals = { viewedOnSite?: boolean; inquired?: boolean };

export type MatchResult = {
  eligible: boolean;
  score: number;
  /** Lo que coincide («Presupuesto», «3 dormitorios»…). */
  matched: string[];
  /** Lo que conviene considerar («Superficie menor a la preferida»…). */
  consider: string[];
  /** Por qué NO es candidata (filtros obligatorios). */
  blockers: string[];
  /** Usa datos del perfil sin confirmar. */
  unconfirmed: boolean;
};

const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const money = (n: number, c: "USD" | "ARS") => `${c === "USD" ? "USD" : "$"} ${nf.format(n)}`;

/**
 * Un perfil sirve para buscar coincidencias si dice QUÉ (operación o tipo) y DÓNDE o CUÁNTO (zona o presupuesto).
 * Un presupuesto solo se compara con la operación conocida: sin operación, USD 260.000 «alcanzaría» cualquier alquiler.
 */
export function profileIsMatchable(p: MatchProfile): boolean {
  const what = Boolean(p.transactionType || p.propertyTypes);
  const where = Boolean(p.locations || (p.budget && p.transactionType));
  return what && where;
}

export type FeatureNames = Map<string, string>;

export function scoreMatch(p: MatchProfile, prop: MatchProperty, opts: { tolerancePct?: number; featureNames?: FeatureNames; signals?: MatchSignals } = {}): MatchResult {
  const tol = (opts.tolerancePct ?? DEFAULT_BUDGET_TOLERANCE_PCT) / 100;
  const matched: string[] = [];
  const consider: string[] = [];
  const blockers: string[] = [];
  let unconfirmed = false;
  const track = <T>(e: Eff<T> | undefined): Eff<T> | undefined => {
    if (e && !e.confirmed) unconfirmed = true;
    return e;
  };

  // ── Filtros obligatorios ──
  if (!prop.published) blockers.push("No está publicada");
  if (prop.status !== "available") blockers.push(prop.status === "reserved" ? "Está reservada" : "No está disponible");

  const op = track(p.transactionType)?.value;
  const ops = op ? prop.operations.filter((o) => o.operation === op) : prop.operations;
  if (op && !ops.length) blockers.push(op === "sale" ? "No está en venta" : "No está en alquiler");
  else if (op) matched.push(op === "sale" ? "En venta" : op === "rent" ? "En alquiler" : "Alquiler temporario");

  const types = track(p.propertyTypes)?.value;
  if (types?.length) {
    if (types.includes(prop.typeKey)) matched.push(prop.typeName);
    else blockers.push(`Es ${prop.typeName.toLowerCase()}, no el tipo buscado`);
  }

  let earned = 0;
  let possible = 0;

  const budget = track(p.budget)?.value;
  if (budget) {
    possible += WEIGHTS.budget;
    const sameCurrency = ops.filter((o) => o.currency === budget.currency);
    const priced = sameCurrency.find((o) => !o.priceHidden && o.amount !== null);
    if (priced && priced.amount !== null) {
      const a = priced.amount;
      if (budget.max !== null && a > budget.max * (1 + tol)) blockers.push(`Supera el presupuesto (${money(a, priced.currency)})`);
      else if (budget.max !== null && a > budget.max) {
        earned += WEIGHTS.budget * 0.6;
        consider.push(`Supera el presupuesto en ${Math.round(((a - budget.max) / budget.max) * 100)} %`);
      } else if (budget.min !== null && a < budget.min * (1 - tol)) {
        earned += WEIGHTS.budget * 0.6;
        consider.push("Por debajo del rango buscado");
      } else {
        earned += WEIGHTS.budget;
        matched.push("Presupuesto");
      }
    } else if (sameCurrency.length) {
      earned += WEIGHTS.budget * 0.4;
      consider.push("Precio a consultar");
    } else if (ops.length) {
      consider.push(`Precio publicado en ${budget.currency === "USD" ? "pesos" : "dólares"}`);
    }
  }

  const locs = track(p.locations)?.value;
  if (locs?.length) {
    possible += WEIGHTS.locations;
    const exact = locs.find((l) => (l.kind === "area" ? l.slug === prop.areaSlug && (!l.localitySlug || l.localitySlug === prop.localitySlug) : l.slug === prop.localitySlug));
    const sameLocality = !exact && locs.find((l) => l.kind === "area" && l.localitySlug && l.localitySlug === prop.localitySlug);
    if (exact) {
      earned += WEIGHTS.locations;
      matched.push(prop.zoneLabel ?? exact.name);
    } else if (sameLocality) {
      earned += WEIGHTS.locations * 0.4;
      consider.push("Misma localidad, otro barrio");
    } else consider.push("Fuera de las zonas preferidas");
  }

  const beds = track(p.bedroomsMin)?.value;
  if (beds !== undefined && beds > 0) {
    possible += WEIGHTS.bedrooms;
    if (prop.bedrooms === null) {
      earned += WEIGHTS.bedrooms * 0.25;
      consider.push("Sin dato de dormitorios");
    } else if (prop.bedrooms >= beds) {
      earned += WEIGHTS.bedrooms;
      matched.push(`${prop.bedrooms} ${prop.bedrooms === 1 ? "dormitorio" : "dormitorios"}`);
    } else if (prop.bedrooms === beds - 1) {
      earned += WEIGHTS.bedrooms * 0.4;
      consider.push(`Un dormitorio menos (${prop.bedrooms})`);
    } else consider.push(`Menos dormitorios (${prop.bedrooms})`);
  }

  const baths = track(p.bathroomsMin)?.value;
  if (baths !== undefined) {
    possible += WEIGHTS.bathrooms;
    if (prop.bathrooms === null) {
      earned += WEIGHTS.bathrooms * 0.25;
      consider.push("Sin dato de baños");
    } else if (prop.bathrooms >= baths) {
      earned += WEIGHTS.bathrooms;
      matched.push(`${prop.bathrooms} ${prop.bathrooms === 1 ? "baño" : "baños"}`);
    } else consider.push(`Menos baños (${prop.bathrooms})`);
  }

  const surface = track(p.surface)?.value;
  if (surface) {
    possible += WEIGHTS.surface;
    const s = prop.surfaceM2;
    if (s === null) {
      earned += WEIGHTS.surface * 0.2;
      consider.push("Sin dato de superficie");
    } else if (surface.min !== null && s < surface.min) {
      if (s >= surface.min * 0.85) earned += WEIGHTS.surface * 0.5;
      consider.push("Superficie menor a la preferida");
    } else if (surface.max !== null && s > surface.max) {
      earned += WEIGHTS.surface * 0.5;
      consider.push("Superficie mayor a la buscada");
    } else {
      earned += WEIGHTS.surface;
      matched.push(`${nf.format(s)} m²`);
    }
  }

  const feats = track(p.features)?.value;
  if (feats?.length) {
    possible += WEIGHTS.features;
    const have = feats.filter((k) => prop.featureKeys.includes(k));
    earned += WEIGHTS.features * (have.length / feats.length);
    const name = (k: string) => opts.featureNames?.get(k) ?? k.replace(/_/g, " ");
    for (const k of have) matched.push(name(k));
    for (const k of feats.filter((x) => !have.includes(x))) consider.push(`Sin ${name(k).toLowerCase()} registrado`);
  }

  if (opts.signals?.viewedOnSite) matched.push("Vio esta propiedad en el sitio");
  if (opts.signals?.inquired) consider.push("Ya consultó por esta propiedad");

  const base = possible > 0 ? (earned / possible) * 100 : 0;
  const score = Math.max(0, Math.min(100, Math.round(base + (opts.signals?.viewedOnSite ? VIEWED_BONUS : 0))));
  const eligible = blockers.length === 0 && profileIsMatchable(p) && possible > 0;
  return { eligible, score: eligible ? score : 0, matched, consider, blockers, unconfirmed };
}

/** Texto corto explicable: «Coincide: ✓ presupuesto ✓ 3 dormitorios · Considerar: superficie menor a la preferida». */
export function explainMatch(r: Pick<MatchResult, "matched" | "consider">): string {
  const parts: string[] = [];
  if (r.matched.length) parts.push(`Coincide: ${r.matched.map((m) => `✓ ${m}`).join(" ")}`);
  if (r.consider.length) parts.push(`Considerar: ${r.consider.join(", ").toLowerCase()}`);
  return parts.join(" · ");
}
