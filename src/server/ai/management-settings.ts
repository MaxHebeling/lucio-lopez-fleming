/** Configuración de la IA de gestión (Fases 5 y 6) desde `settings` (0531), con defaults y rangos seguros. */
import type { Executor } from "../db";
import { DEFAULT_ANOMALY_SETTINGS, type AnomalySettings } from "./anomalies/rules";

export type ManagementSettings = AnomalySettings & {
  briefCacheMinutes: number;
  briefMaxAiPerDay: number;
  maxContactsPerRun: number;
  maxSnoozeDays: number;
  lowQualityScore: number;
};

type Spec = { key: string; def: number; min: number; max: number };

const SPEC: Record<keyof ManagementSettings, Spec> = {
  briefCacheMinutes: { key: "ai.daily_brief.cache_minutes", def: 10, min: 1, max: 24 * 60 },
  briefMaxAiPerDay: { key: "ai.daily_brief.max_ai_per_day", def: 6, min: 0, max: 50 },
  maxContactsPerRun: { key: "ai.task_center.max_contacts_per_run", def: 300, min: 10, max: 5000 },
  maxSnoozeDays: { key: "ai.task_center.max_snooze_days", def: 90, min: 1, max: 365 },
  lowQualityScore: { key: "ai.task_center.low_quality_score", def: 55, min: 1, max: 100 },
  leadUncontactedHours: { key: "ai.anomalies.lead_uncontacted_hours", def: DEFAULT_ANOMALY_SETTINGS.leadUncontactedHours, min: 1, max: 24 * 30 },
  leadUncontactedCriticalHours: { key: "ai.anomalies.lead_uncontacted_critical_hours", def: DEFAULT_ANOMALY_SETTINGS.leadUncontactedCriticalHours, min: 1, max: 24 * 60 },
  visitFollowupHours: { key: "ai.anomalies.visit_followup_hours", def: DEFAULT_ANOMALY_SETTINGS.visitFollowupHours, min: 1, max: 24 * 30 },
  inquiryBaselineWeeks: { key: "ai.anomalies.inquiry_baseline_weeks", def: DEFAULT_ANOMALY_SETTINGS.inquiryBaselineWeeks, min: 4, max: 52 },
  inquiryRecentDays: { key: "ai.anomalies.inquiry_recent_days", def: DEFAULT_ANOMALY_SETTINGS.inquiryRecentDays, min: 7, max: 60 },
  inquiryMinBaseline: { key: "ai.anomalies.inquiry_min_baseline", def: DEFAULT_ANOMALY_SETTINGS.inquiryMinBaseline, min: 5, max: 1000 },
  inquiryMinExpected: { key: "ai.anomalies.inquiry_min_expected", def: DEFAULT_ANOMALY_SETTINGS.inquiryMinExpected, min: 3, max: 1000 },
  inquiryMaxRatio: { key: "ai.anomalies.inquiry_max_ratio", def: DEFAULT_ANOMALY_SETTINGS.inquiryMaxRatio, min: 0.05, max: 0.9 },
  inquiryPValue: { key: "ai.anomalies.inquiry_p_value", def: DEFAULT_ANOMALY_SETTINGS.inquiryPValue, min: 0.001, max: 0.2 },
  jobDeadMin: { key: "ai.anomalies.job_dead_min", def: DEFAULT_ANOMALY_SETTINGS.jobDeadMin, min: 1, max: 10_000 },
  aiMinRequests: { key: "ai.anomalies.ai_min_requests", def: DEFAULT_ANOMALY_SETTINGS.aiMinRequests, min: 5, max: 100_000 },
  aiErrorRate: { key: "ai.anomalies.ai_error_rate", def: DEFAULT_ANOMALY_SETTINGS.aiErrorRate, min: 0.05, max: 1 },
  maxNotificationsPerUserPerDay: { key: "ai.anomalies.max_notifications_per_user_per_day", def: DEFAULT_ANOMALY_SETTINGS.maxNotificationsPerUserPerDay, min: 0, max: 100 },
};

export function parseManagementSettings(values: Map<string, unknown>): ManagementSettings {
  const out = {} as ManagementSettings;
  for (const [field, s] of Object.entries(SPEC) as Array<[keyof ManagementSettings, Spec]>) {
    const raw = values.get(s.key);
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    out[field] = Number.isFinite(n) && n >= s.min && n <= s.max ? n : s.def;
  }
  // El umbral crítico nunca queda por debajo del de aviso.
  out.leadUncontactedCriticalHours = Math.max(out.leadUncontactedCriticalHours, out.leadUncontactedHours);
  return out;
}

export async function getManagementSettings(db: Executor): Promise<ManagementSettings> {
  const rows = await db.selectFrom("settings").select(["key", "value"]).where("key", "in", Object.values(SPEC).map((s) => s.key)).execute();
  return parseManagementSettings(new Map(rows.map((r) => [r.key, r.value])));
}

const saltaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta", year: "numeric", month: "2-digit", day: "2-digit" });

/** Fecha de negocio (YYYY-MM-DD) en Salta. */
export function saltaToday(now = new Date(), offsetDays = 0): string {
  return saltaDay.format(new Date(now.getTime() + offsetDays * 86_400_000));
}

/** Inicio del día de Salta (UTC−3, sin horario de verano) como Date. */
export function saltaDayStart(date: string): Date {
  return new Date(`${date}T00:00:00-03:00`);
}
