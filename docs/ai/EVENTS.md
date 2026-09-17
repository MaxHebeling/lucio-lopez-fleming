# Catálogo de eventos de negocio (Fase 6)

Outbox `domain_events` (misma transacción que el cambio) → `dispatchPendingEvents` → automatizaciones → cola `jobs`.
Lista canónica en código: `EVENT_TYPES` (`src/server/events.ts`). Motor, garantías y loops: [AUTOMATION.md](./AUTOMATION.md).

## Auditoría (2026-09-17, `main` @ dd957ce)

Se relevaron todos los `emitEvent(` del repo y las automatizaciones de la base. Del catálogo conceptual pedido:

| Evento pedido | Estado antes | Qué se hizo |
| --- | --- | --- |
| `lead.created` | emitido (`leads/capture.ts`) | sin cambios |
| `lead.qualified` | emitido (`sales/qualification/service.ts`) | sin cambios |
| `property.created` / `property.published` / `property.price_changed` | emitidos (`properties/service.ts`) | sin cambios |
| `property.viewed` | **no existía** | nuevo, **agregado diario** desde `site_events` (job `ai.site_events_rollup`), nunca por request |
| `tour.started` / `tour.completed` | **no existían** | nuevos, agregados diarios desde `site_events` (mismo job) |
| `appointment.created` / `appointment.assigned` | emitidos (agenda / visitas) | sin cambios |
| `agent.checked_in` | emitido (`visits/service.ts`), nunca con coordenadas | sin cambios |
| `appointment.started` / `appointment.finished` | emitidos | sin cambios |
| `followup.created` | emitido | sin cambios |
| informe de visita confirmado | **no existía** (solo timeline + auditoría) | nuevo `visit.report_confirmed` |
| `offer.created` | **el concepto de oferta no existe** en el modelo (no hay tabla, estado ni pantalla; «oferta» solo aparece como texto del informe o del bot de WhatsApp) | **no se inventa**. Si se modela la oferta, se agrega el evento con su servicio |

Declarados en `EVENT_TYPES` pero sin emisor directo hoy: `owner_report.due` (reservado por alquileres). `integration.failed`
se inserta desde `resilience.ts` (circuit breaker) sin `emitEvent`.

## Catálogo

Payload: **sin PII** (ni nombres, teléfonos, emails, documentos, texto libre de clientes ni coordenadas). Excepción
preexistente documentada: los eventos de visitas llevan `summary` = título de la cita (puede incluir el nombre de pila del
cliente) porque lo usa la acción `notify`; ver deuda técnica en MANAGEMENT.md.

### Comerciales

| Evento | Productor | Payload | Consumidores (automatizaciones) |
| --- | --- | --- | --- |
| `lead.created` | `leads/capture.ts` (sitio, WhatsApp, portales, manual) | assignedUserId, summary, link | `lead_notify_and_followup`, `lead_internal_email`, `sales_lead_qualify`, **`ai_reaction_lead_created`** |
| `lead.assigned` | `leads/service.ts` | assignedUserId | — |
| `lead.qualified` | job de calificación | contactId, suggested, aiUsed, recommendations | — |
| `opportunity.created` / `.stage_changed` | `opportunities/service.ts` | ids, etapa | — |
| `recommendation.created` / `.accepted` / `.dismissed` | siguiente acción (Fase 2) | rule, contactId, taskId | — |
| `match.candidates_computed` | match inverso | contadores, versión | — |

### Propiedades y sitio

| Evento | Productor | Payload | Consumidores |
| --- | --- | --- | --- |
| `property.created` | `properties/service.ts` | ids | `ai_quality_property_created` |
| `property.updated` / `.status_changed` / `.unpublished` | `properties/service.ts`, `media.ts` | ids, estado | calidad, portales, revalidación |
| `property.published` | `publishProperty` | ids | `property_portal_sync_published`, `property_social_drafts`, `site_revalidate_property_published`, `ai_quality_property_published`, `sales_match_property_published`, **`ai_reaction_property_published`** |
| `property.price_changed` | `changePrice` | ids, precio | calidad, match inverso, revalidación |
| `property.viewed` | job diario `ai.site_events_rollup` | `{ date, views, sessions }` | — |
| `tour.started` | job diario `ai.site_events_rollup` | `{ date, sessions }` (sesiones que abrieron el tour) | — |
| `tour.completed` | job diario `ai.site_events_rollup` | `{ date, sessions }` (recorrieron todas las escenas publicadas, mínimo 2) | — |
| `property.quality_computed`, `media.tags_suggested`, `marketing.draft_created` | Fase 3 | contadores, versiones | — |
| `virtual_tour.*` | `tours/service.ts` | ids | revalidación |

Dedupe de los agregados: `property.viewed:<propiedad>:<fecha>` (idem `tour.*`): re-correr el día no duplica.

### Visitas

| Evento | Productor | Payload | Consumidores |
| --- | --- | --- | --- |
| `appointment.created` / `.assigned` | agenda / visitas | assignedUserId, propertyId, contactId, link, summary | `ai_visit_brief_*` |
| `appointment.en_route` / `.started` / `.cancelled` / `.no_show` | `visits/service.ts` | ídem | — |
| `agent.checked_in` | `visits/service.ts` | verificación, motivo, distancia (nunca coordenadas) | — |
| `appointment.finished` | `finishVisit` | ídem | **`ai_reaction_visit_finished`** |
| `visit.completed` / `visit.scheduled` | agenda (compatibilidad) | — | `visit_followup` |
| `visit.report_confirmed` | `saveVisitReport` (al confirmar, una vez por confirmación) | assignedUserId, propertyId, contactId, interest, hasObjections, hasNextStep, link | **`ai_reaction_report_confirmed`** |
| `followup.created` | `createVisitFollowUp` | taskId, dueAt | — |
| `client_link.created` / `.expired`, `visit.brief_prepared`, `visit.report_structured` | visitas / Fase 4b | ids | — |

### IA (Fases 1, 5 y 6)

| Evento | Productor | Payload | Consumidores |
| --- | --- | --- | --- |
| `ai.answer.generated`, `ai.feedback.recorded` | copiloto | ids, modo, estado | — |
| `ai.recommendation.created` | Tareas sugeridas (alta de una sugerencia) | source, rule, priority, entityType | — |
| `ai.recommendation.accepted` | «Aceptar y crear tarea» | source, rule, taskId, replayed | — |
| `ai.recommendation.dismissed` | «Descartar» | source, rule, withNote (nunca la nota) | — |
| `ai.recommendation.snoozed` | «Posponer» | source, rule, until | — |
| `ai.anomaly.detected` | job `ai.anomalies_detect` | kind, severity, entityType | — |

**Ningún evento `ai.*` tiene consumidores** y, aunque alguien configure uno, el motor corta la cadena (AUTOMATION.md).

### Alquileres, integraciones y conversaciones

`contract.created`, `contract.expiring` (→ `contract_expiring_notice`), `rent.due` (→ `rent_due_reminder`), `rent_adjustment.due`
(→ `rent_adjustment_proposal`), `payment.registered`, `settlement.generated`, `integration.failed`
(→ `integration_failure_alert`), `conversation.handoff`. Sin cambios en esta fase.

## Columnas de causalidad (0530)

| Columna | Qué guarda |
| --- | --- |
| `causation_id` | evento que estaba procesando la automatización (o el job encolado por ella) cuando se emitió este |
| `correlation_id` | evento raíz de la cadena |
| `depth` | 0 = originado por una persona o un job periódico; +1 por cada salto derivado |
| `caused_by_automation` | clave de la automatización que lo causó |

Los eventos emitidos por personas y jobs periódicos quedan con `depth = 0` y sin causa.
