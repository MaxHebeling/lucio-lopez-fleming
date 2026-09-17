/**
 * Outbox de eventos de dominio: se inserta en la misma transacción que el cambio.
 * El despachador (jobs) los procesa después y dispara automatizaciones de forma idempotente.
 */
import type { Executor } from "./db";
import { actorUserId, type Actor } from "./auth/actor";

export const EVENT_TYPES = [
  "lead.created",
  "lead.assigned",
  "opportunity.created",
  "opportunity.stage_changed",
  "property.created",
  "property.updated",
  "property.price_changed",
  "property.status_changed",
  "property.published",
  "property.unpublished",
  "virtual_tour.updated",
  "virtual_tour.published",
  "virtual_tour.unpublished",
  "visit.scheduled",
  "visit.completed",
  "contract.created",
  "contract.expiring",
  "rent.due",
  "rent_adjustment.due",
  "payment.registered",
  "settlement.generated",
  "owner_report.due",
  "integration.failed",
  "conversation.handoff",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export async function emitEvent(
  db: Executor,
  actor: Actor,
  e: { type: EventType; aggregateType: string; aggregateId: string; payload?: Record<string, unknown>; dedupeKey?: string },
): Promise<string | null> {
  const row = await db
    .insertInto("domain_events")
    .values({
      event_type: e.type,
      aggregate_type: e.aggregateType,
      aggregate_id: e.aggregateId,
      payload: JSON.stringify(e.payload ?? {}),
      actor_user_id: actorUserId(actor),
      dedupe_key: e.dedupeKey ?? null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}
