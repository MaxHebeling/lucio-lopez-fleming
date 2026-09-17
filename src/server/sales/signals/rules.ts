/**
 * Señales de interés (puro, explicable). Cada señal sale de un hecho registrado: eventos del sitio de sesiones que la
 * persona vinculó al enviar una consulta, consultas y pedidos de visita. Nivel = suma de pesos con umbrales fijos.
 *
 *   solicitó visita 3 · volvió a la propiedad (≥ 2 días distintos) 2 · hizo el tour 360° 2 · preguntó disponibilidad o
 *   visita 2 · comparó propiedades 1 · preguntó otros datos de la ficha 1
 *   alta ≥ 5 · media ≥ 2 · baja ≥ 1 · sin señales = null (no se inventa un nivel)
 */

export type SignalFacts = {
  /** Vistas de ficha por propiedad y día (YYYY-MM-DD en Salta), de sesiones vinculadas + consultas por esa propiedad. */
  propertyDays: Array<{ propertyId: string; code: number; day: string }>;
  tours: Array<{ propertyId: string; code: number }>;
  qa: Array<{ propertyId: string | null; code: number | null; topic: string }>;
  compared: number;
  visitRequests: Array<{ propertyId: string | null; code: number | null; at: Date }>;
};

export type IntentSignalKey = "visit_requested" | "returned_to_property" | "virtual_tour" | "asked_availability" | "compared" | "asked_details";
export type IntentSignal = { key: IntentSignalKey; label: string; weight: number; propertyCode: number | null };
export type IntentLevel = "high" | "medium" | "low";

export const LEVEL_LABEL: Record<IntentLevel, string> = { high: "Alta", medium: "Media", low: "Baja" };
const WEIGHT: Record<IntentSignalKey, number> = { visit_requested: 3, returned_to_property: 2, virtual_tour: 2, asked_availability: 2, compared: 1, asked_details: 1 };

export function computeIntentSignals(f: SignalFacts): { level: IntentLevel | null; score: number; signals: IntentSignal[] } {
  const signals: IntentSignal[] = [];
  const add = (key: IntentSignalKey, label: string, code: number | null) => {
    if (!signals.some((s) => s.key === key && s.propertyCode === code)) signals.push({ key, label, weight: WEIGHT[key], propertyCode: code });
  };

  for (const v of f.visitRequests) add("visit_requested", v.code ? `Solicitó visitar la propiedad #${v.code}` : "Solicitó una visita", v.code);

  const days = new Map<string, { code: number; days: Set<string> }>();
  for (const v of f.propertyDays) {
    const e = days.get(v.propertyId) ?? { code: v.code, days: new Set<string>() };
    e.days.add(v.day);
    days.set(v.propertyId, e);
  }
  for (const { code, days: d } of days.values()) if (d.size >= 2) add("returned_to_property", `Volvió a la propiedad #${code} (${d.size} días distintos)`, code);

  for (const t of f.tours) add("virtual_tour", `Hizo el tour 360° de la propiedad #${t.code}`, t.code);

  for (const q of f.qa) {
    if (q.topic === "availability" || q.topic === "visit") add("asked_availability", q.code ? `Preguntó por ${q.topic === "visit" ? "visitar" : "la disponibilidad de"} la propiedad #${q.code}` : "Preguntó por disponibilidad", q.code);
  }
  if (f.compared > 0) add("compared", f.compared === 1 ? "Comparó propiedades" : `Comparó propiedades (${f.compared} veces)`, null);
  if (!signals.some((s) => s.key === "asked_availability") && f.qa.some((q) => q.topic !== "unknown")) add("asked_details", "Hizo preguntas sobre datos de una ficha", null);

  // Una misma señal repetida en varias propiedades no se suma más de dos veces (evita inflar el nivel).
  const perKey = new Map<IntentSignalKey, number>();
  let score = 0;
  for (const s of signals) {
    const n = perKey.get(s.key) ?? 0;
    if (n < 2) score += s.weight;
    perKey.set(s.key, n + 1);
  }
  const level: IntentLevel | null = score >= 5 ? "high" : score >= 2 ? "medium" : score >= 1 ? "low" : null;
  signals.sort((a, b) => b.weight - a.weight);
  return { level, score, signals };
}
