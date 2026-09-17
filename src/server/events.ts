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
  // Núcleo operativo de visitas (src/server/visits): ciclo de vida, link del cliente y seguimiento.
  "appointment.created",
  "appointment.assigned",
  "appointment.en_route",
  "agent.checked_in",
  "appointment.started",
  "appointment.finished",
  "appointment.cancelled",
  "appointment.no_show",
  "client_link.created",
  "client_link.expired",
  "followup.created",
  "contract.created",
  "contract.expiring",
  "rent.due",
  "rent_adjustment.due",
  "payment.registered",
  "settlement.generated",
  "owner_report.due",
  "integration.failed",
  "conversation.handoff",
  // AI Core (Fase 1). Solo metadatos (ids, modo, resultado): nunca preguntas ni respuestas. Ninguna automatización
  // del sistema los escucha y la IA no reacciona a eventos: no hay loops. `ai.recommendation.*` queda para la Fase 5.
  "ai.answer.generated",
  "ai.feedback.recorded",
  // IA Fase 2 · Ventas (src/server/sales). Metadatos sin PII. Ninguna automatización los escucha: no hay loops.
  "lead.qualified",
  "match.candidates_computed",
  "recommendation.created",
  "recommendation.accepted",
  "recommendation.dismissed",
  // AI Property (Fase 3) e IA de visitas (Fase 4b): solo ids, contadores y versiones (sin datos personales). Ninguna
  // automatización los escucha: no hay loops (docs/ai/PROPERTY.md › Eventos).
  "property.quality_computed",
  "media.tags_suggested",
  "marketing.draft_created",
  "visit.brief_prepared",
  "visit.report_structured",
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
