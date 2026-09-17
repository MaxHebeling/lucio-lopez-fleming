/**
 * Score de completitud de una ficha (0–100). Simple, determinista y documentado (docs/ai/AI_CORE.md): la Fase 3
 * (calidad de fichas con IA) lo va a ampliar. Mide si la ficha tiene lo mínimo para publicarse y vender bien;
 * no juzga la calidad del texto ni de las fotos.
 */

export type CompletenessInput = {
  hasCover: boolean;
  photoCount: number;
  descriptionLength: number;
  /** Hay al menos una operación activa con precio cargado (aunque se muestre "Consultar"). */
  hasPrice: boolean;
  hasLocation: boolean;
  hasArea: boolean;
  /** Tipo residencial (casa, departamento, PH): los dormitorios son obligatorios. */
  residential: boolean;
  hasBedrooms: boolean;
  hasLeadAgent: boolean;
  hasStreet: boolean;
};

export type CompletenessCriterion = { key: keyof typeof CRITERIA; label: string; weight: number; ok: boolean };

export const CRITERIA = {
  cover: { label: "foto de portada", weight: 15 },
  photos: { label: "al menos 5 fotos", weight: 10 },
  description: { label: "descripción de 200+ caracteres", weight: 15 },
  price: { label: "precio en una operación activa", weight: 15 },
  location: { label: "ubicación", weight: 10 },
  area: { label: "superficie", weight: 10 },
  bedrooms: { label: "dormitorios", weight: 10 },
  agent: { label: "agente responsable", weight: 10 },
  street: { label: "calle (aunque se oculte en el sitio)", weight: 5 },
} as const;

export const MIN_PHOTOS = 5;
export const MIN_DESCRIPTION_CHARS = 200;

export function completeness(p: CompletenessInput): { score: number; criteria: CompletenessCriterion[]; missing: string[] } {
  const checks: Record<keyof typeof CRITERIA, boolean> = {
    cover: p.hasCover,
    photos: p.photoCount >= MIN_PHOTOS,
    description: p.descriptionLength >= MIN_DESCRIPTION_CHARS,
    price: p.hasPrice,
    location: p.hasLocation,
    area: p.hasArea,
    // Terrenos, locales, cocheras…: los dormitorios no aplican y el criterio cuenta como cumplido.
    bedrooms: !p.residential || p.hasBedrooms,
    agent: p.hasLeadAgent,
    street: p.hasStreet,
  };
  const criteria = (Object.keys(CRITERIA) as Array<keyof typeof CRITERIA>).map((key) => ({ key, label: CRITERIA[key].label, weight: CRITERIA[key].weight, ok: checks[key] }));
  const score = criteria.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  return { score, criteria, missing: criteria.filter((c) => !c.ok).map((c) => c.label) };
}
