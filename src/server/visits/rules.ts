/**
 * Reglas deterministas del módulo de visitas (funciones puras, sin IA): plantilla de agradecimiento, sugerencia de
 * seguimiento, expiración del link del cliente y alertas del centro operativo.
 */
import { isActive } from "./state";

// ───────────────────────────── Agradecimiento (plantilla, editable) ─────────────────────────────

export const COMPANY_NAME = "Lucio López Fleming";

/** Nombre de pila para el trato («Ana María Pérez» → «Ana»). Vacío → null (el texto no inventa nombres). */
export function firstName(name: string | null | undefined): string | null {
  const w = (name ?? "").trim().split(/\s+/)[0];
  return w && w.length >= 2 ? w : null;
}

export function thankYouTemplate(p: { clientFirstName: string | null; agentName: string; propertyTitle: string | null }): string {
  const greeting = p.clientFirstName ? `Hola ${p.clientFirstName}, ` : "Hola, ";
  const place = p.propertyTitle ? `conocer ${p.propertyTitle}` : "hacer la visita";
  return (
    `${greeting}muchas gracias por tomarte el tiempo de ${place} con nosotros. ` +
    `Quedo a disposición para cualquier consulta o para coordinar una nueva visita. ` +
    `Un saludo, ${p.agentName} · ${COMPANY_NAME}.`
  ).slice(0, 1000);
}

/** Texto para compartir el link del cliente (lo envía una persona, por WhatsApp o copiado). */
export function clientLinkShareText(p: { clientFirstName: string | null; url: string }): string {
  const greeting = p.clientFirstName ? `Hola ${p.clientFirstName}` : "Hola";
  return `${greeting}, te comparto el enlace para seguir tu visita con ${COMPANY_NAME}: ${p.url}`;
}

// ───────────────────────────── Seguimiento ─────────────────────────────

export type Interest = "low" | "medium" | "high";
export const INTEREST_LABEL: Record<Interest, string> = { low: "Bajo", medium: "Medio", high: "Alto" };

/** Interés alto → 24 h; medio (o sin dato) → 48 h; bajo → 7 días. Siempre editable por el agente. */
export const FOLLOW_UP_DELAY_HOURS: Record<Interest, number> = { high: 24, medium: 48, low: 24 * 7 };

export function suggestFollowUpAt(interest: Interest | null | undefined, from: Date): Date {
  const hours = FOLLOW_UP_DELAY_HOURS[interest ?? "medium"];
  const t = from.getTime() + hours * 3_600_000;
  // Redondeo a los 5 minutos siguientes (inputs datetime-local con step de 5 min).
  return new Date(Math.ceil(t / 300_000) * 300_000);
}

// ───────────────────────────── Link del cliente ─────────────────────────────

/** Tope absoluto de vida de un link (aunque la visita se reprograme lejos). */
export const CLIENT_LINK_MAX_DAYS = 30;

/**
 * Vence: fin de la visita (o fin real si terminó después) + margen configurable, y nunca después del tope absoluto
 * guardado en `expires_at`. Revocado o rotado = inválido.
 */
export function clientLinkExpiresAt(p: { endsAt: Date; finishedAt: Date | null; hardExpiresAt: Date; graceHours: number }): Date {
  const end = Math.max(p.endsAt.getTime(), p.finishedAt?.getTime() ?? 0);
  return new Date(Math.min(end + p.graceHours * 3_600_000, p.hardExpiresAt.getTime()));
}

export function isClientLinkValid(p: { revokedAt: Date | null; endsAt: Date; finishedAt: Date | null; hardExpiresAt: Date; graceHours: number }, now: Date): boolean {
  if (p.revokedAt) return false;
  return now.getTime() < clientLinkExpiresAt(p).getTime();
}

/** Lo que ve el cliente: estado en vivo solo mientras la visita está activa; después, solo el cierre. */
export type ClientPhase = "scheduled" | "en_route" | "checked_in" | "in_progress" | "closed";

export function clientPhase(status: string): ClientPhase {
  switch (status) {
    case "scheduled":
    case "confirmed":
      return "scheduled";
    case "en_route":
    case "checked_in":
    case "in_progress":
      return status;
    default:
      return "closed";
  }
}

// ───────────────────────────── Alertas del centro operativo ─────────────────────────────

export type AlertKind = "unassigned_upcoming" | "no_checkin" | "checkin_needs_review" | "overrun" | "not_finished" | "no_report" | "no_followup";
export type AlertSeverity = "info" | "warning" | "critical";

export const ALERT_LABEL: Record<AlertKind, string> = {
  unassigned_upcoming: "Visita próxima sin agente activo",
  no_checkin: "Sin check-in después del inicio",
  checkin_needs_review: "Check-in para revisar",
  overrun: "Visita en curso demasiado larga",
  not_finished: "Visita pasada sin finalizar",
  no_report: "Finalizada sin informe",
  no_followup: "Informe sin seguimiento",
};

export const ALERT_SEVERITY: Record<AlertKind, AlertSeverity> = {
  unassigned_upcoming: "critical",
  no_checkin: "critical",
  checkin_needs_review: "warning",
  overrun: "warning",
  not_finished: "warning",
  no_report: "info",
  no_followup: "info",
};

/** Solo estas generan notificación (una vez por visita); el resto se ve en el tablero sin molestar. */
export const NOTIFIED_ALERTS: ReadonlySet<AlertKind> = new Set(["unassigned_upcoming", "no_checkin", "checkin_needs_review", "not_finished"]);

export type AlertSettings = {
  upcomingHours: number;
  noCheckinMinutes: number;
  overrunMinutes: number;
  notFinishedMinutes: number;
  reportHours: number;
};

export type VisitSnapshot = {
  status: string;
  startsAt: Date;
  endsAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  agentActive: boolean;
  lastCheckinStatus: string | null;
  reportStatus: "draft" | "confirmed" | null;
  hasFollowUp: boolean;
};

export function evaluateVisitAlerts(v: VisitSnapshot, now: Date, s: AlertSettings): AlertKind[] {
  const t = now.getTime();
  const min = 60_000;
  const out: AlertKind[] = [];
  const active = isActive(v.status);
  if (active && !v.agentActive && v.startsAt.getTime() - t <= s.upcomingHours * 3_600_000 && v.endsAt.getTime() > t) out.push("unassigned_upcoming");
  if ((v.status === "scheduled" || v.status === "confirmed" || v.status === "en_route") && t >= v.startsAt.getTime() + s.noCheckinMinutes * min && t < v.endsAt.getTime() + s.notFinishedMinutes * min) {
    out.push("no_checkin");
  }
  if ((v.status === "checked_in" || v.status === "in_progress") && v.lastCheckinStatus && v.lastCheckinStatus !== "verified") out.push("checkin_needs_review");
  if (v.status === "in_progress") {
    const planned = v.endsAt.getTime() - v.startsAt.getTime();
    const started = (v.startedAt ?? v.startsAt).getTime();
    if (t >= started + planned + s.overrunMinutes * min) out.push("overrun");
  }
  if (active && v.status !== "in_progress" && t >= v.endsAt.getTime() + s.notFinishedMinutes * min) out.push("not_finished");
  if (v.status === "completed" && v.finishedAt) {
    const due = v.finishedAt.getTime() + s.reportHours * 3_600_000;
    if (v.reportStatus !== "confirmed" && t >= due) out.push("no_report");
    if (v.reportStatus === "confirmed" && !v.hasFollowUp && t >= due) out.push("no_followup");
  }
  return out;
}
