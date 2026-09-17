/**
 * «Tareas sugeridas» (Task Center): reglas PURAS de prioridad, orden, deduplicación y validación. Sin base ni red.
 * La IA recomienda, la persona decide: cada sugerencia trae prioridad, motivo, evidencia y origen; aceptar crea la
 * tarea real (servicio de tareas), descartar y posponer quedan registrados.
 */
import { createHash } from "node:crypto";

export const SUGGESTION_SOURCES = ["sales_nba", "visit", "property_quality", "marketing", "ops_alert", "assignment", "anomaly"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
export type SuggestionPriority = "high" | "medium" | "low";
export type SuggestionEntity = "contact" | "lead" | "opportunity" | "property" | "appointment" | "organization";
export type TaskKind = "task" | "call" | "meeting" | "follow_up" | "email" | "whatsapp";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type TaskTemplate = { kind: TaskKind; title: string; dueInHours: number; priority: TaskPriority };

/** Sugerencia candidata que produce un colector (se guarda en `sales_recommendations`). */
export type SuggestionCandidate = {
  source: SuggestionSource;
  ruleKey: string;
  entityType: SuggestionEntity;
  /** null solo para `organization` (se guarda el id de la organización). */
  entityId: string | null;
  contactId?: string | null;
  assignedUserId: string | null;
  priority: SuggestionPriority;
  title: string;
  reason: string;
  evidence: string[];
  link: string;
  fingerprint: string;
  task: TaskTemplate;
};

export const SOURCE_LABEL: Record<SuggestionSource, string> = {
  sales_nba: "Ventas · siguiente acción",
  visit: "Visitas · cierre",
  property_quality: "Calidad de la publicación",
  marketing: "Marketing · borradores",
  ops_alert: "Centro operativo · alerta",
  assignment: "Asignaciones pendientes",
  anomaly: "Anomalía detectada",
};

/** Parámetro de URL (`?origen=`) ↔ origen. */
export const SOURCE_PARAM: Record<string, SuggestionSource> = {
  ventas: "sales_nba",
  visitas: "visit",
  calidad: "property_quality",
  marketing: "marketing",
  alertas: "ops_alert",
  asignaciones: "assignment",
  anomalias: "anomaly",
};
export const PARAM_FOR_SOURCE = Object.fromEntries(Object.entries(SOURCE_PARAM).map(([k, v]) => [v, k])) as Record<SuggestionSource, string>;

export const PRIORITY_LABEL: Record<SuggestionPriority, string> = { high: "Alta", medium: "Media", low: "Baja" };

const PRIORITY_WEIGHT: Record<SuggestionPriority, number> = { high: 3000, medium: 2000, low: 1000 };
/** Dentro de la misma prioridad: lo que no puede esperar (alertas del día, clientes) antes que la calidad de fichas. */
const SOURCE_WEIGHT: Record<SuggestionSource, number> = { ops_alert: 500, sales_nba: 400, anomaly: 350, visit: 300, assignment: 250, marketing: 150, property_quality: 100 };
const HOUR = 3_600_000;

export type RankInput = { priority: SuggestionPriority; source: SuggestionSource; createdAt: Date };

/**
 * Puntaje de orden: prioridad (manda siempre) + urgencia del origen + antigüedad (1 punto por hora, tope 7 días).
 * Una sugerencia baja nunca supera a una media: la antigüedad suma como máximo 168 y el origen 500.
 */
export function suggestionScore(s: RankInput, now: Date): number {
  const ageHours = Math.max(0, Math.min(168, Math.floor((now.getTime() - s.createdAt.getTime()) / HOUR)));
  return PRIORITY_WEIGHT[s.priority] + SOURCE_WEIGHT[s.source] + ageHours;
}

export function rankSuggestions<T extends RankInput>(items: T[], now: Date): T[] {
  return [...items].sort((a, b) => suggestionScore(b, now) - suggestionScore(a, now) || a.createdAt.getTime() - b.createdAt.getTime());
}

export function suggestionFingerprint(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32);
}

/** Clave única de una situación (igual a la unicidad de la tabla). */
export function suggestionKey(c: Pick<SuggestionCandidate, "entityType" | "entityId" | "ruleKey" | "fingerprint">, organizationId: string): string {
  return `${c.entityType}:${c.entityId ?? organizationId}:${c.ruleKey}:${c.fingerprint}`;
}

const PRIORITY_ORDER: Record<SuggestionPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Sin duplicados: una sola sugerencia por (entidad, regla, huella) — gana la de mayor prioridad — y una sola por
 * (entidad, regla) entre orígenes que miran lo mismo (p. ej. «seguimiento de la visita» de Ventas y de Visitas: queda
 * la de Visitas, que conoce el informe).
 */
export function dedupeCandidates(items: SuggestionCandidate[], organizationId: string): SuggestionCandidate[] {
  const byKey = new Map<string, SuggestionCandidate>();
  for (const c of items) {
    const k = suggestionKey(c, organizationId);
    const prev = byKey.get(k);
    if (!prev || PRIORITY_ORDER[c.priority] < PRIORITY_ORDER[prev.priority]) byKey.set(k, c);
  }
  return [...byKey.values()];
}

export type SnoozeCheck = { ok: true; until: Date } | { ok: false; message: string };

/** Posponer hasta una fecha (YYYY-MM-DD, 08:00 de Salta): mañana como mínimo, tope configurable. */
export function snoozeUntil(date: string, now: Date, maxDays: number): SnoozeCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Elegí una fecha válida" };
  const until = new Date(`${date}T08:00:00-03:00`);
  if (Number.isNaN(until.getTime())) return { ok: false, message: "Elegí una fecha válida" };
  if (until.getTime() <= now.getTime()) return { ok: false, message: "La fecha tiene que ser futura" };
  if (until.getTime() - now.getTime() > maxDays * 24 * HOUR) return { ok: false, message: `Se puede posponer hasta ${maxDays} días` };
  return { ok: true, until };
}

/** Texto seguro para guardar: sin saltos, acotado. Nunca se guarda texto libre de clientes en una sugerencia. */
export function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
