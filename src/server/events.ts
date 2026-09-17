/**
 * Outbox de eventos de dominio: se inserta en la misma transacción que el cambio.
 * El despachador (jobs) los procesa después y dispara automatizaciones de forma idempotente.
 */
import { AsyncLocalStorage } from "node:async_hooks";
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
  // IA Fases 5 y 6 (docs/ai/EVENTS.md). Metadatos sin PII.
  // Informe de visita confirmado por una persona (src/server/visits/service.ts): dispara la reacción que propone
  // datos SUGERIDOS del perfil y el seguimiento.
  "visit.report_confirmed",
  // Agregados diarios desde site_events (job ai.site_events_rollup): nunca uno por request.
  "property.viewed",
  "tour.started",
  "tour.completed",
  // Tareas sugeridas y anomalías. Ninguna automatización del sistema los escucha (y el motor corta loops por causalidad).
  "ai.recommendation.created",
  "ai.recommendation.accepted",
  "ai.recommendation.dismissed",
  "ai.recommendation.snoozed",
  "ai.anomaly.detected",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Causa del trabajo en curso (protección contra loops, docs/ai/AUTOMATION.md). El motor la fija al correr una
 * automatización y el runner al correr un job encolado por ella: todo evento emitido adentro queda marcado como
 * derivado (causation_id, correlation_id, depth + 1, caused_by_automation).
 */
export type EventCause = { eventId: string; correlationId: string; depth: number; automationKey: string | null };

const causeStorage = new AsyncLocalStorage<EventCause>();

export function currentEventCause(): EventCause | undefined {
  return causeStorage.getStore();
}

export function withEventCause<T>(cause: EventCause | null | undefined, fn: () => Promise<T>): Promise<T> {
  return cause ? causeStorage.run(cause, fn) : fn();
}

export async function emitEvent(
  db: Executor,
  actor: Actor,
  e: { type: EventType; aggregateType: string; aggregateId: string; payload?: Record<string, unknown>; dedupeKey?: string },
): Promise<string | null> {
  const cause = causeStorage.getStore();
  const row = await db
    .insertInto("domain_events")
    .values({
      event_type: e.type,
      aggregate_type: e.aggregateType,
      aggregate_id: e.aggregateId,
      payload: JSON.stringify(e.payload ?? {}),
      actor_user_id: actorUserId(actor),
      dedupe_key: e.dedupeKey ?? null,
      ...(cause ? { causation_id: cause.eventId, correlation_id: cause.correlationId, depth: Math.min(50, cause.depth + 1), caused_by_automation: cause.automationKey } : {}),
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}
