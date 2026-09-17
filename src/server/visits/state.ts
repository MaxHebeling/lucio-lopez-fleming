/**
 * Máquina de estados de la visita (función pura, espejo del trigger `appointments_status_transition` de 0180).
 *
 *   PROGRAMADA (scheduled | confirmed) → EN CAMINO (en_route) → CHECK-IN (checked_in) → EN CURSO (in_progress)
 *   → FINALIZADA (completed). Además: CANCELADA (cancelled), NO SE PRESENTÓ (no_show).
 *
 * "Reprogramada" no es un estado: la cita se mueve de franja (vuelve a scheduled) y queda el evento `rescheduled`
 * en el timeline. Así la oportunidad, la tarea de seguimiento y el link del cliente siguen apuntando a la misma visita.
 */

export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "en_route", "checked_in", "in_progress", "completed", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados que ocupan la franja del agente (mismos que la exclusión `appointments_no_overlap`). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ["scheduled", "confirmed", "en_route", "checked_in", "in_progress"];
export const TERMINAL_STATUSES: readonly AppointmentStatus[] = ["completed", "cancelled", "no_show"];
/** Estados propios del portal de visitas (la Agenda clásica solo conocía scheduled/confirmed como activos). */
export const OPERATIONAL_STATUSES: readonly AppointmentStatus[] = ["en_route", "checked_in", "in_progress"];

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["confirmed", "en_route", "checked_in", "completed", "cancelled", "no_show"],
  confirmed: ["scheduled", "en_route", "checked_in", "completed", "cancelled", "no_show"],
  en_route: ["scheduled", "checked_in", "completed", "cancelled", "no_show"],
  checked_in: ["in_progress", "completed", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function isAppointmentStatus(s: string): s is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(s);
}

export function canTransition(from: string, to: string): boolean {
  if (!isAppointmentStatus(from) || !isAppointmentStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Etapa visible en el portal y el centro operativo (confirmed se agrupa con programada). */
export type VisitPhase = "scheduled" | "en_route" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show";

export function visitPhase(status: string): VisitPhase {
  if (status === "confirmed") return "scheduled";
  return isAppointmentStatus(status) ? (status as VisitPhase) : "scheduled";
}

export const VISIT_PHASE_LABEL: Record<VisitPhase, string> = {
  scheduled: "Programada",
  en_route: "En camino",
  checked_in: "Check-in",
  in_progress: "En curso",
  completed: "Finalizada",
  cancelled: "Cancelada",
  no_show: "No se presentó",
};

/** Acciones operativas del agente según el estado (el servidor vuelve a validar cada una). */
export type VisitAction = "en_route" | "check_in" | "start" | "finish";

export function nextVisitActions(status: string): VisitAction[] {
  switch (status) {
    case "scheduled":
    case "confirmed":
      return ["en_route", "check_in"];
    case "en_route":
      return ["check_in"];
    case "checked_in":
      return ["start"];
    case "in_progress":
      return ["finish"];
    default:
      return [];
  }
}
