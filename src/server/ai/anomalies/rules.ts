/**
 * Detección de anomalías: reglas PURAS y prudentes (docs/ai/MANAGEMENT.md › Anomalías). Principios:
 * - Solo hechos contables con umbral documentado; cada anomalía trae su evidencia.
 * - Comparaciones «contra su propia base» solo con ventana y muestra suficientes: con n chico NO se afirma nada.
 * - Nunca se afirma una causa ni se usa la ubicación de agentes.
 */
export type AnomalySeverity = "info" | "warning" | "critical";
export type AnomalyKind = "lead_uncontacted" | "visit_without_followup" | "property_inquiry_drop" | "data_contradiction" | "job_failure_spike" | "ai_failure_spike";
export type Evidence = { label: string; value: string };

export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  lead_uncontacted: "Lead sin contactar",
  visit_without_followup: "Visita finalizada sin seguimiento",
  property_inquiry_drop: "Caída de consultas de una propiedad",
  data_contradiction: "Datos contradictorios en una ficha",
  job_failure_spike: "Pico de tareas automáticas fallidas",
  ai_failure_spike: "Pico de fallas de la IA",
};

export type AnomalySettings = {
  leadUncontactedHours: number;
  leadUncontactedCriticalHours: number;
  visitFollowupHours: number;
  inquiryBaselineWeeks: number;
  inquiryRecentDays: number;
  inquiryMinBaseline: number;
  inquiryMinExpected: number;
  inquiryMaxRatio: number;
  inquiryPValue: number;
  jobDeadMin: number;
  aiMinRequests: number;
  aiErrorRate: number;
  maxNotificationsPerUserPerDay: number;
};

export const DEFAULT_ANOMALY_SETTINGS: AnomalySettings = {
  leadUncontactedHours: 24,
  leadUncontactedCriticalHours: 72,
  visitFollowupHours: 48,
  inquiryBaselineWeeks: 8,
  inquiryRecentDays: 14,
  inquiryMinBaseline: 8,
  inquiryMinExpected: 4,
  inquiryMaxRatio: 0.25,
  inquiryPValue: 0.05,
  jobDeadMin: 5,
  aiMinRequests: 20,
  aiErrorRate: 0.3,
  maxNotificationsPerUserPerDay: 5,
};

const fmt = (n: number, d = 1) => n.toLocaleString("es-AR", { maximumFractionDigits: d });

/** P(X ≤ k) con X ~ Poisson(λ). Suma directa (k chico: son conteos de consultas). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

export type Verdict = { severity: AnomalySeverity; title: string; evidence: Evidence[] } | null;

export function evaluateLeadUncontacted(i: { hoursWithoutContact: number; sourceName: string | null; propertyCode: number | null }, s: AnomalySettings): Verdict {
  if (i.hoursWithoutContact < s.leadUncontactedHours) return null;
  const critical = i.hoursWithoutContact >= s.leadUncontactedCriticalHours;
  return {
    severity: critical ? "critical" : "warning",
    title: `Lead sin primer contacto hace ${i.hoursWithoutContact} h`,
    evidence: [
      { label: "Horas desde la consulta sin primer contacto", value: String(i.hoursWithoutContact) },
      { label: "Umbral", value: `${s.leadUncontactedHours} h (crítico desde ${s.leadUncontactedCriticalHours} h)` },
      ...(i.sourceName ? [{ label: "Origen", value: i.sourceName }] : []),
      ...(i.propertyCode ? [{ label: "Propiedad consultada", value: `#${i.propertyCode}` }] : []),
    ],
  };
}

export function evaluateVisitWithoutFollowUp(i: { hoursSinceFinished: number; reportConfirmed: boolean; propertyCode: number | null }, s: AnomalySettings): Verdict {
  if (i.hoursSinceFinished < s.visitFollowupHours) return null;
  return {
    severity: "warning",
    title: `Visita finalizada hace ${i.hoursSinceFinished} h sin seguimiento`,
    evidence: [
      { label: "Horas desde que finalizó", value: String(i.hoursSinceFinished) },
      { label: "Informe", value: i.reportConfirmed ? "confirmado" : "sin confirmar" },
      { label: "Tarea de seguimiento", value: "no hay" },
      ...(i.propertyCode ? [{ label: "Propiedad", value: `#${i.propertyCode}` }] : []),
    ],
  };
}

export type InquiryDropInput = {
  /** Días desde que se publicó (la ventana completa tiene que caber). */
  publishedDays: number;
  /** Consultas (leads) en las `inquiryBaselineWeeks` semanas previas a la ventana reciente. */
  baselineCount: number;
  /** Consultas en los últimos `inquiryRecentDays` días. */
  recentCount: number;
  propertyCode: number;
};

export type InquiryDropCheck =
  | { status: "insufficient"; reason: "window" | "sample" | "expected" }
  | { status: "normal"; expected: number; pValue: number }
  | { status: "drop"; expected: number; pValue: number; verdict: NonNullable<Verdict> };

/**
 * Caída de consultas contra la PROPIA base de la propiedad. Exige: ventana completa publicada, muestra mínima en la
 * base, un esperado razonable en la ventana reciente, caída relativa fuerte Y poco probable por azar (Poisson). Con
 * muestras chicas devuelve `insufficient` (no se dice nada).
 */
export function evaluateInquiryDrop(i: InquiryDropInput, s: AnomalySettings): InquiryDropCheck {
  const baselineDays = s.inquiryBaselineWeeks * 7;
  if (i.publishedDays < baselineDays + s.inquiryRecentDays) return { status: "insufficient", reason: "window" };
  if (i.baselineCount < s.inquiryMinBaseline) return { status: "insufficient", reason: "sample" };
  const expected = (i.baselineCount / baselineDays) * s.inquiryRecentDays;
  if (expected < s.inquiryMinExpected) return { status: "insufficient", reason: "expected" };
  const pValue = poissonCdf(i.recentCount, expected);
  if (i.recentCount / expected > s.inquiryMaxRatio || pValue > s.inquiryPValue) return { status: "normal", expected, pValue };
  return {
    status: "drop",
    expected,
    pValue,
    verdict: {
      severity: "warning",
      title: `La propiedad #${i.propertyCode} recibe muchas menos consultas que antes`,
      evidence: [
        { label: `Consultas en los últimos ${s.inquiryRecentDays} días`, value: String(i.recentCount) },
        { label: `Consultas en las ${s.inquiryBaselineWeeks} semanas anteriores`, value: `${i.baselineCount} (≈ ${fmt(i.baselineCount / s.inquiryBaselineWeeks)} por semana)` },
        { label: `Esperable con ese ritmo en ${s.inquiryRecentDays} días`, value: `≈ ${fmt(expected)}` },
        { label: "Criterio", value: `≤ ${Math.round(s.inquiryMaxRatio * 100)} % de lo esperable y probabilidad por azar ≤ ${Math.round(s.inquiryPValue * 100)} %` },
        { label: "Aclaración", value: "Compara la propiedad con su propio historial; no indica la causa" },
      ],
    },
  };
}

/** Inconsistencias ya detectadas por el informe de calidad (se reutilizan: no hay reglas nuevas). */
export const CONTRADICTION_CODES = ["bedrooms_vs_rooms", "covered_gt_total", "land_lt_covered"] as const;

export function evaluateContradictions(i: { findings: Array<{ code: string; title: string }>; propertyCode: number }): Verdict {
  const hits = i.findings.filter((f) => (CONTRADICTION_CODES as readonly string[]).includes(f.code));
  if (!hits.length) return null;
  return {
    severity: "info",
    title: `Datos contradictorios en la ficha #${i.propertyCode}`,
    evidence: hits.slice(0, 5).map((h) => ({ label: "Inconsistencia", value: h.title })),
  };
}

export function evaluateJobFailureSpike(i: { dead24h: number; deadPrevious7d: number }, s: AnomalySettings): Verdict {
  const avg = i.deadPrevious7d / 7;
  if (i.dead24h < s.jobDeadMin) return null;
  if (avg > 0 && i.dead24h < 3 * avg) return null;
  return {
    severity: i.dead24h >= s.jobDeadMin * 4 ? "critical" : "warning",
    title: `${i.dead24h} tareas automáticas fallidas en 24 h`,
    evidence: [
      { label: "Jobs muertos en las últimas 24 h", value: String(i.dead24h) },
      { label: "Promedio diario de los 7 días anteriores", value: fmt(avg) },
      { label: "Criterio", value: `≥ ${s.jobDeadMin} y al menos el triple del promedio` },
    ],
  };
}

export function evaluateAiFailureSpike(i: { requests24h: number; failures24h: number }, s: AnomalySettings): Verdict {
  if (i.requests24h < s.aiMinRequests) return null;
  const rate = i.failures24h / i.requests24h;
  if (rate < s.aiErrorRate) return null;
  return {
    severity: "warning",
    title: `La IA falló en ${Math.round(rate * 100)} % de los pedidos (24 h)`,
    evidence: [
      { label: "Pedidos al modelo en 24 h", value: String(i.requests24h) },
      { label: "Con error, tiempo agotado o salida inválida", value: String(i.failures24h) },
      { label: "Criterio", value: `≥ ${s.aiMinRequests} pedidos y ≥ ${Math.round(s.aiErrorRate * 100)} % con falla (las respuestas deterministas no cuentan)` },
    ],
  };
}

export function anomalyDedupeKey(kind: AnomalyKind, entityId: string | null, fingerprint = ""): string {
  return `${kind}:${entityId ?? "org"}${fingerprint ? `:${fingerprint}` : ""}`.slice(0, 200);
}

/** Tope diario de avisos por persona (sin spam): quedan disponibles = tope − enviados hoy. */
export function notificationsAllowed(sentToday: number, cap: number): number {
  return Math.max(0, cap - sentToday);
}
