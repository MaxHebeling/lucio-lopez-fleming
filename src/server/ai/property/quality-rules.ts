/**
 * Property Quality AI — reglas deterministas y puras (sin base, sin red, sin IA). Amplían el score de completitud de la
 * Fase 1 (`domains/property-completeness.ts`, que sigue igual para el copiloto) con pesos documentados en
 * docs/ai/PROPERTY.md › Calidad, y agregan detecciones: faltantes accionables, inconsistencias, descripción pobre,
 * precio fuera de rango (solo con muestra suficiente) y problemas de fotos almacenadas (duplicadas, oscuras, borrosas).
 *
 * Nada de esto modifica datos: produce un informe. El lenguaje es prudente ("revisá", "puede ser correcto si…").
 */
import { MIN_DESCRIPTION_CHARS, MIN_PHOTOS } from "../domains/property-completeness";
import { duplicateGroups, isBlurry, isDark, type ImageMetrics } from "./image-rules";
import type { RoomKey } from "./rooms";

export const QUALITY_RULES_VERSION = "2026-09-17.1";

export { ROOM_KEYS, ROOM_LABEL, type RoomKey } from "./rooms";

export type QualityMedia = {
  id: string;
  kind: string;
  status: string;
  isCover: boolean;
  sortOrder: number;
  /** Archivo propio en nuestro storage (analizable). Las fotos del sitio anterior no lo son. */
  stored: boolean;
  room: RoomKey | null;
  metrics: Pick<ImageMetrics, "dhash" | "luminanceMean" | "luminanceP95" | "laplacianVariance" | "luminanceVariance"> | null;
};

export type QualityOperation = { operation: "sale" | "rent" | "temporary_rent"; currency: "USD" | "ARS"; amount: number | null; priceHidden: boolean };

export type QualitySnapshot = {
  id: string;
  code: number;
  title: string;
  typeKey: string;
  category: string;
  status: string;
  isPublished: boolean;
  description: string | null;
  locationId: string | null;
  street: string | null;
  hasCoordinates: boolean;
  areas: { totalM2: number | null; coveredM2: number | null; landM2: number | null };
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  orientation: string | null;
  /** Plantas (campo del tipo `casa`), si está cargado. */
  floors: number | null;
  featureCount: number;
  operations: QualityOperation[];
  hasLeadAgent: boolean;
  tourPublished: boolean;
  media: QualityMedia[];
};

export type Severity = "error" | "warning" | "info";

export type Finding = {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Link a la sección exacta del CRM donde se corrige (relativo a la ficha). */
  href: string | null;
  mediaIds?: string[];
};

export type Criterion = { key: CriterionKey; label: string; weight: number; ok: boolean; applies: boolean; href: string };

/** Pesos (suman 100). Un criterio que no aplica al tipo cuenta como cumplido (misma convención que la Fase 1). */
export const QUALITY_CRITERIA = {
  cover: { label: "Foto de portada", weight: 10, section: "multimedia" },
  photos: { label: `Al menos ${MIN_PHOTOS} fotos`, weight: 8, section: "multimedia" },
  exterior: { label: "Foto de fachada o exterior etiquetada", weight: 5, section: "multimedia" },
  floorPlan: { label: "Plano", weight: 6, section: "multimedia" },
  tour: { label: "Tour 360° publicado", weight: 4, section: "tour" },
  description: { label: `Descripción de ${MIN_DESCRIPTION_CHARS}+ caracteres`, weight: 12, section: "edit:description" },
  price: { label: "Precio en una operación activa", weight: 12, section: "precios" },
  location: { label: "Ubicación (barrio o localidad)", weight: 8, section: "edit:ubicacion" },
  street: { label: "Calle (aunque se oculte en el sitio)", weight: 3, section: "edit:addressStreet" },
  coordinates: { label: "Punto en el mapa (coordenadas)", weight: 3, section: "edit:latitude" },
  area: { label: "Superficies", weight: 8, section: "edit:totalAreaM2" },
  bedrooms: { label: "Dormitorios", weight: 5, section: "edit:bedrooms" },
  bathrooms: { label: "Baños", weight: 3, section: "edit:bathrooms" },
  orientation: { label: "Orientación", weight: 3, section: "edit:orientation" },
  features: { label: "Al menos 3 características", weight: 4, section: "edit:caracteristicas" },
  agent: { label: "Agente responsable", weight: 6, section: "agentes" },
} as const;
export type CriterionKey = keyof typeof QUALITY_CRITERIA;

export const MIN_FEATURES = 3;

/** Penalizaciones sobre el score de completitud (topes para que un solo problema no lo domine). */
export const PENALTIES = {
  inconsistency: { each: 5, max: 15 },
  duplicate: { each: 3, max: 9 },
  darkOrBlurry: { each: 2, max: 10 },
} as const;

/** `edit:campo` → /crm/propiedades/[id]/editar#campo · `seccion` → /crm/propiedades/[id]#seccion · `tour` → editor. */
export function sectionHref(propertyId: string, section: string): string {
  if (section === "tour") return `/crm/propiedades/${propertyId}/tour`;
  if (section.startsWith("edit:")) return `/crm/propiedades/${propertyId}/editar#${section.slice(5)}`;
  return `/crm/propiedades/${propertyId}#${section}`;
}

const positive = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0;

export function evaluateCriteria(p: QualitySnapshot): Criterion[] {
  const images = p.media.filter((m) => m.kind === "image" && m.status !== "failed");
  const residential = p.category === "residential";
  const land = p.category === "land";
  const checks: Record<CriterionKey, { ok: boolean; applies: boolean }> = {
    cover: { ok: images.some((m) => m.isCover), applies: true },
    photos: { ok: images.length >= MIN_PHOTOS, applies: true },
    exterior: { ok: p.media.some((m) => m.room === "fachada" || m.room === "exterior" || (land && m.room === "jardin")), applies: true },
    floorPlan: { ok: p.media.some((m) => (m.kind === "floor_plan" || m.room === "plano") && m.status !== "failed"), applies: !land },
    tour: { ok: p.tourPublished, applies: residential },
    description: { ok: (p.description?.trim().length ?? 0) >= MIN_DESCRIPTION_CHARS, applies: true },
    price: { ok: p.operations.some((o) => o.amount !== null && o.amount > 0), applies: true },
    location: { ok: Boolean(p.locationId), applies: true },
    street: { ok: Boolean(p.street?.trim()), applies: true },
    coordinates: { ok: p.hasCoordinates, applies: true },
    area: { ok: land ? positive(p.areas.landM2) || positive(p.areas.totalM2) : positive(p.areas.coveredM2) || positive(p.areas.totalM2), applies: true },
    bedrooms: { ok: p.bedrooms !== null, applies: residential },
    bathrooms: { ok: p.bathrooms !== null, applies: residential },
    orientation: { ok: Boolean(p.orientation?.trim()), applies: residential || land },
    features: { ok: p.featureCount >= MIN_FEATURES, applies: true },
    agent: { ok: p.hasLeadAgent, applies: true },
  };
  return (Object.keys(QUALITY_CRITERIA) as CriterionKey[]).map((key) => ({
    key,
    label: QUALITY_CRITERIA[key].label,
    weight: QUALITY_CRITERIA[key].weight,
    ok: !checks[key].applies || checks[key].ok,
    applies: checks[key].applies,
    href: sectionHref(p.id, QUALITY_CRITERIA[key].section),
  }));
}

// ───────────────────────────── Inconsistencias ─────────────────────────────

const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export function inconsistencies(p: QualitySnapshot): Finding[] {
  const out: Finding[] = [];
  const edit = (field: string) => sectionHref(p.id, `edit:${field}`);
  if (positive(p.rooms) && positive(p.bedrooms) && p.bedrooms! >= p.rooms!) {
    out.push({
      code: "bedrooms_vs_rooms",
      severity: "warning",
      title: "Dormitorios y ambientes no cierran",
      detail: `Tiene ${p.bedrooms} dormitorios y ${p.rooms} ambientes: los ambientes incluyen los dormitorios y el living, así que deberían ser más. Revisá ambos valores.`,
      href: edit("rooms"),
    });
  }
  if (positive(p.areas.coveredM2) && positive(p.areas.totalM2) && p.areas.coveredM2! > p.areas.totalM2! + 0.5) {
    out.push({
      code: "covered_gt_total",
      severity: "warning",
      title: "Superficie cubierta mayor que la total",
      detail: `Cubierta ${intFmt.format(p.areas.coveredM2!)} m² y total ${intFmt.format(p.areas.totalM2!)} m²: la total incluye la cubierta. Revisá los valores.`,
      href: edit("coveredAreaM2"),
    });
  }
  const house = p.category === "residential" && p.typeKey !== "departamento";
  if (house && positive(p.areas.landM2) && positive(p.areas.coveredM2) && p.areas.landM2! < p.areas.coveredM2! && !(p.floors !== null && p.floors >= 2)) {
    out.push({
      code: "land_lt_covered",
      severity: "info",
      title: "Terreno menor que la superficie cubierta",
      detail: `Terreno ${intFmt.format(p.areas.landM2!)} m² y cubierta ${intFmt.format(p.areas.coveredM2!)} m². Puede ser correcto si tiene más de una planta (no está cargado); si no, revisá los valores.`,
      href: edit("landAreaM2"),
    });
  }
  return out;
}

// ───────────────────────────── Precio fuera de rango (con muestra) ─────────────────────────────

export type PriceComparable = { pricePerM2: number };
export type PriceSettings = { minSample: number; lowFactor: number; highFactor: number };
export const DEFAULT_PRICE_SETTINGS: PriceSettings = { minSample: 8, lowFactor: 0.5, highFactor: 2 };

export type PriceCheck =
  | { status: "not_applicable"; reason: string }
  | { status: "insufficient_sample"; sample: number; minSample: number }
  | { status: "in_range" | "low" | "high"; sample: number; median: number; value: number; ratio: number };

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Superficie de referencia para precio por m²: terreno en lotes; cubierta (o total) en el resto. */
export function referenceArea(category: string, areas: QualitySnapshot["areas"]): number | null {
  if (category === "land") return positive(areas.landM2) ? areas.landM2 : positive(areas.totalM2) ? areas.totalM2 : null;
  return positive(areas.coveredM2) ? areas.coveredM2 : positive(areas.totalM2) ? areas.totalM2 : null;
}

export function priceCheck(value: number | null, comparables: PriceComparable[], s: PriceSettings = DEFAULT_PRICE_SETTINGS): PriceCheck {
  if (value === null || !(value > 0)) return { status: "not_applicable", reason: "sin precio o superficie" };
  const sample = comparables.map((c) => c.pricePerM2).filter((v) => Number.isFinite(v) && v > 0);
  if (sample.length < s.minSample) return { status: "insufficient_sample", sample: sample.length, minSample: s.minSample };
  const m = median(sample);
  const ratio = Math.round((value / m) * 100) / 100;
  return { status: ratio < s.lowFactor ? "low" : ratio > s.highFactor ? "high" : "in_range", sample: sample.length, median: m, value, ratio };
}

export function priceFinding(p: QualitySnapshot, check: PriceCheck, label: { operation: string; currency: string }): Finding | null {
  if (check.status !== "low" && check.status !== "high") return null;
  const money = (n: number) => `${label.currency === "USD" ? "USD" : "$"} ${intFmt.format(Math.round(n))}`;
  const direction = check.status === "low" ? "muy por debajo" : "muy por encima";
  return {
    code: `price_${check.status}`,
    severity: "info",
    title: `Precio por m² ${direction} de comparables`,
    detail:
      `${money(check.value)}/m² contra una mediana de ${money(check.median)}/m² en ${check.sample} propiedades del mismo tipo, operación (${label.operation}), moneda y zona. ` +
      "No es una tasación: puede haber motivos (estado, amenities, ubicación exacta). Revisá que el precio y la superficie estén bien cargados.",
    href: sectionHref(p.id, "precios"),
  };
}

// ───────────────────────────── Descripción ─────────────────────────────

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function descriptionFindings(p: QualitySnapshot): Finding[] {
  const text = p.description?.trim() ?? "";
  const href = sectionHref(p.id, "edit:description");
  if (!text) return [{ code: "description_missing", severity: "warning", title: "Sin descripción", detail: "La ficha no tiene descripción: es lo primero que leen quienes llegan desde el sitio y los portales.", href }];
  const out: Finding[] = [];
  const t = norm(text);
  if (text.length < MIN_DESCRIPTION_CHARS) {
    out.push({ code: "description_short", severity: "warning", title: "Descripción breve", detail: `Tiene ${text.length} caracteres; se recomiendan al menos ${MIN_DESCRIPTION_CHARS}.`, href });
  }
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 40 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.6) {
    out.push({ code: "description_uppercase", severity: "info", title: "Descripción en mayúsculas", detail: "La mayor parte del texto está en mayúsculas: cuesta leerlo y en portales se ve como un grito.", href });
  }
  // Datos cargados en campos que el texto no menciona (el texto no inventa: esto solo sugiere completar con lo que ya consta).
  const missing: string[] = [];
  if (positive(p.bedrooms) && !/dormitori|habitaci|cuarto|suite/.test(t)) missing.push(`${p.bedrooms} dormitorios`);
  const area = referenceArea(p.category, p.areas);
  if (area && !/m2|m²|mts|metros/.test(t)) missing.push(`${intFmt.format(area)} m²`);
  if (positive(p.bathrooms) && !/bano/.test(t)) missing.push(`${p.bathrooms} baños`);
  if (positive(p.garages) && !/cochera|garage|garaje/.test(t)) missing.push(`${p.garages} cocheras`);
  if (missing.length >= 2) {
    out.push({
      code: "description_missing_facts",
      severity: "info",
      title: "La descripción no menciona datos que sí están cargados",
      detail: `Datos de la ficha que no aparecen en el texto: ${missing.join(", ")}.`,
      href,
    });
  }
  return out;
}

// ───────────────────────────── Fotos ─────────────────────────────

export type MediaSummary = { images: number; stored: number; analyzed: number; external: number; duplicates: number; dark: number; blurry: number };

export function mediaFindings(p: QualitySnapshot): { findings: Finding[]; summary: MediaSummary; duplicateExtras: number; darkOrBlurry: number } {
  const images = p.media.filter((m) => m.kind === "image" && m.status !== "failed").sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder);
  const analyzed = images.filter((m) => m.stored && m.metrics);
  const external = images.filter((m) => !m.stored);
  const href = sectionHref(p.id, "multimedia");
  const findings: Finding[] = [];
  const groups = duplicateGroups(analyzed.map((m) => ({ id: m.id, dhash: m.metrics!.dhash })));
  const duplicateExtras = groups.reduce((s, g) => s + g.length - 1, 0);
  for (const g of groups) {
    findings.push({ code: "photo_duplicate", severity: "warning", title: "Fotos repetidas", detail: `${g.length} fotos parecen la misma imagen. Dejá una sola: las repetidas no suman y bajan la calidad percibida.`, href, mediaIds: g });
  }
  const dark = analyzed.filter((m) => isDark(m.metrics!)).map((m) => m.id);
  const blurry = analyzed.filter((m) => isBlurry(m.metrics!)).map((m) => m.id);
  if (dark.length) findings.push({ code: "photo_dark", severity: "info", title: dark.length === 1 ? "Foto posiblemente oscura" : `${dark.length} fotos posiblemente oscuras`, detail: "Poca luz general. Si hay otra toma con mejor luz, conviene usarla.", href, mediaIds: dark });
  if (blurry.length) findings.push({ code: "photo_blurry", severity: "info", title: blurry.length === 1 ? "Foto posiblemente borrosa" : `${blurry.length} fotos posiblemente borrosas`, detail: "Poco detalle nítido al tamaño en que se ve en la ficha (movida, desenfocada o muy comprimida).", href, mediaIds: blurry });
  if (external.length) {
    findings.push({
      code: "photo_external_not_analyzed",
      severity: "info",
      title: external.length === 1 ? "1 foto no analizada: foto externa" : `${external.length} fotos no analizadas: fotos externas`,
      detail: "Se muestran desde el sitio anterior y no se descargan para analizarlas. Subilas de nuevo al CRM para revisar duplicadas, luz y nitidez.",
      href,
      mediaIds: external.map((m) => m.id),
    });
  }
  const darkOrBlurry = new Set([...dark, ...blurry]).size;
  return {
    findings,
    duplicateExtras,
    darkOrBlurry,
    summary: { images: images.length, stored: images.filter((m) => m.stored).length, analyzed: analyzed.length, external: external.length, duplicates: duplicateExtras, dark: dark.length, blurry: blurry.length },
  };
}

// ───────────────────────────── Informe ─────────────────────────────

export type QualityReport = {
  score: number;
  completenessScore: number;
  criteria: Criterion[];
  findings: Finding[];
  mediaSummary: MediaSummary;
  missingCount: number;
  warningCount: number;
  priceCheck: PriceCheck;
};

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function buildQualityReport(p: QualitySnapshot, price: { check: PriceCheck; operation: string; currency: string }): QualityReport {
  const criteria = evaluateCriteria(p);
  const completenessScore = criteria.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const missing: Finding[] = criteria
    .filter((c) => !c.ok)
    .map((c) => ({
      code: `missing_${c.key}`,
      // Publicada sin precio, ubicación o portada: es lo que más se nota afuera.
      severity: p.isPublished && (c.key === "price" || c.key === "location" || c.key === "cover") ? ("error" as const) : ("warning" as const),
      title: `Falta: ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}`,
      detail: `Suma ${c.weight} puntos de completitud.`,
      href: c.href,
    }));
  const inc = inconsistencies(p);
  const desc = descriptionFindings(p).filter((f) => f.code !== "description_missing" && f.code !== "description_short"); // ya cubiertas por el criterio
  const media = mediaFindings(p);
  const pf = priceFinding(p, price.check, price);
  const penalty =
    Math.min(PENALTIES.inconsistency.max, inc.filter((f) => f.severity !== "info").length * PENALTIES.inconsistency.each) +
    Math.min(PENALTIES.duplicate.max, media.duplicateExtras * PENALTIES.duplicate.each) +
    Math.min(PENALTIES.darkOrBlurry.max, media.darkOrBlurry * PENALTIES.darkOrBlurry.each);
  const findings = [...missing, ...inc, ...(pf ? [pf] : []), ...desc, ...media.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    score: Math.max(0, Math.min(100, completenessScore - penalty)),
    completenessScore,
    criteria,
    findings,
    mediaSummary: media.summary,
    missingCount: missing.length,
    warningCount: findings.filter((f) => f.severity !== "info").length - missing.length,
    priceCheck: price.check,
  };
}
