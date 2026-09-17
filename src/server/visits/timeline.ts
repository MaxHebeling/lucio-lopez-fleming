/**
 * Timeline de la visita (`appointment_events`, append-only). Se escribe en la MISMA transacción que el cambio.
 * Nunca lleva coordenadas (la base lo rechaza): solo estado, distancia, motivos y referencias.
 */
import type { Executor } from "../db";
import { actorUserId, type Actor } from "../auth/actor";

export const VISIT_EVENT_KINDS = [
  "scheduled",
  "assigned",
  "reassigned",
  "rescheduled",
  "confirmed",
  "en_route",
  "checked_in",
  "checkin_retry",
  "location_problem",
  "started",
  "finished",
  "cancelled",
  "no_show",
  "client_link_created",
  "client_link_rotated",
  "client_link_revoked",
  "client_link_opened",
  "client_link_expired",
  "report_saved",
  "report_confirmed",
  "followup_created",
  "thanks_saved",
  "thanks_marked_sent",
] as const;
export type VisitEventKind = (typeof VISIT_EVENT_KINDS)[number];

export const VISIT_EVENT_LABEL: Record<VisitEventKind, string> = {
  scheduled: "Visita programada",
  assigned: "Agente asignado",
  reassigned: "Agente reasignado",
  rescheduled: "Visita reprogramada",
  confirmed: "Visita confirmada",
  en_route: "El agente salió hacia la propiedad",
  checked_in: "Llegada confirmada (check-in)",
  checkin_retry: "Nuevo intento de verificación de llegada",
  location_problem: "Problema de ubicación reportado",
  started: "Visita iniciada",
  finished: "Visita finalizada",
  cancelled: "Visita cancelada",
  no_show: "El cliente no se presentó",
  client_link_created: "Link del cliente generado",
  client_link_rotated: "Link del cliente rotado",
  client_link_revoked: "Link del cliente revocado",
  client_link_opened: "El cliente abrió el link",
  client_link_expired: "Link del cliente vencido",
  report_saved: "Informe guardado",
  report_confirmed: "Informe confirmado",
  followup_created: "Tarea de seguimiento creada",
  thanks_saved: "Agradecimiento preparado",
  thanks_marked_sent: "Agradecimiento marcado como enviado",
};

export async function recordVisitEvent(
  db: Executor,
  actor: Actor | { kind: "client" },
  appointmentId: string,
  kind: VisitEventKind,
  data: Record<string, string | number | boolean | null> = {},
  dedupeKey?: string,
): Promise<boolean> {
  const isClient = actor.kind === "client";
  const row = await db
    .insertInto("appointment_events")
    .values({
      appointment_id: appointmentId,
      kind,
      actor_user_id: isClient ? null : actorUserId(actor),
      actor_kind: isClient ? "client" : actor.kind === "system" ? "system" : "user",
      data: JSON.stringify(data),
      dedupe_key: dedupeKey ?? null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  return Boolean(row);
}
