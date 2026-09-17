/** Configuración del módulo de visitas desde `settings` (0181), con valores por defecto y rangos seguros. */
import type { Executor } from "../db";
import type { AlertSettings } from "./rules";

export type VisitSettings = AlertSettings & {
  radiusM: number;
  maxAccuracyM: number;
  checkinWindowMinutes: number;
  locationRetentionDays: number;
  clientLinkGraceHours: number;
};

const SPEC: Record<keyof VisitSettings, { key: string; def: number; min: number; max: number }> = {
  radiusM: { key: "visits.geofence_radius_m", def: 150, min: 10, max: 5000 },
  maxAccuracyM: { key: "visits.geofence_max_accuracy_m", def: 200, min: 10, max: 5000 },
  checkinWindowMinutes: { key: "visits.checkin_window_minutes", def: 120, min: 15, max: 24 * 60 },
  locationRetentionDays: { key: "visits.location_retention_days", def: 30, min: 1, max: 365 },
  clientLinkGraceHours: { key: "visits.client_link_grace_hours", def: 48, min: 1, max: 24 * 14 },
  upcomingHours: { key: "visits.alert_upcoming_hours", def: 24, min: 1, max: 24 * 7 },
  noCheckinMinutes: { key: "visits.alert_no_checkin_minutes", def: 15, min: 1, max: 24 * 60 },
  overrunMinutes: { key: "visits.alert_overrun_minutes", def: 60, min: 5, max: 24 * 60 },
  notFinishedMinutes: { key: "visits.alert_not_finished_minutes", def: 120, min: 5, max: 24 * 60 },
  reportHours: { key: "visits.alert_report_hours", def: 12, min: 1, max: 24 * 14 },
};

export const VISIT_SETTING_KEYS = Object.values(SPEC).map((s) => s.key);

export function parseVisitSettings(values: Map<string, unknown>): VisitSettings {
  const out = {} as VisitSettings;
  for (const [field, s] of Object.entries(SPEC) as Array<[keyof VisitSettings, (typeof SPEC)[keyof VisitSettings]]>) {
    const raw = values.get(s.key);
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    out[field] = Number.isFinite(n) && n >= s.min && n <= s.max ? n : s.def;
  }
  return out;
}

export async function getVisitSettings(db: Executor): Promise<VisitSettings> {
  const rows = await db.selectFrom("settings").select(["key", "value"]).where("key", "in", VISIT_SETTING_KEYS).execute();
  return parseVisitSettings(new Map(rows.map((r) => [r.key, r.value])));
}
