# IA Fase 6 · Automatización («AI Automation»)

Reacciones de IA sobre el bus existente (outbox `domain_events` + cola `jobs` + motor `src/server/automation/*`). No hay
bus nuevo. Catálogo de eventos: [EVENTS.md](./EVENTS.md). Gestión (Fase 5): [MANAGEMENT.md](./MANAGEMENT.md).

```
 evento de negocio ──outbox──▶ dispatchPendingEvents ──(depth < máx.)──▶ job automation.run (dedupe automatización+evento)
                                                                           │ loop guard (misma cadena / profundidad)
                                                                           │ acción desconocida → run «omitida», sin dead
                                                                           ▼ withEventCause(evento)
                                               acción ai_react_* ──▶ upserts idempotentes (sugerencias, borradores, perfil sugerido)
                                                    │ emitEvent/enqueue heredan la causa (causation_id, depth+1, automatización)
                                                    ▼
                                         falla → reintento con backoff (5) → dead + aviso a administración
```

## Reacciones

| Automatización (0531) | Evento | Acción | Qué hace | Qué NO hace |
| --- | --- | --- | --- | --- |
| `ai_reaction_visit_finished` | `appointment.finished` | `ai_react_visit_finished` | sugerencias «Cargar el informe» y «Preparar el agradecimiento» al agente; recalcula la siguiente acción del cliente (señales + NBA); invalida su Resumen de hoy | no crea el informe ni la tarea; no envía el agradecimiento |
| `ai_reaction_property_published` | `property.published` | `ai_react_property_published` | borradores de marketing por plantilla (SEO, WhatsApp, email, Reel) con `generateMarketingDrafts(scope: own)`; sugerencia «Revisar los borradores» al agente responsable | **no** hace el match inverso (ya lo hace `sales_match_property_published`, verificado por test: una sola automatización de match); **no** duplica los borradores de Instagram/Facebook (los arma `property_social_drafts`); no publica ni usa IA paga |
| `ai_reaction_lead_created` | `lead.created` | `ai_react_lead_created` | siguiente acción del contacto en la bandeja del agente asignado (Contactar hoy = alta intención) | **no** califica (lo hace `sales_lead_qualify`, la misma fila no se duplica); no contacta |
| `ai_reaction_report_confirmed` | `visit.report_confirmed` | `ai_react_report_confirmed` | datos del perfil **sugeridos** (`client_preferences.source = visit_report`, confianza × 0,7) por parser determinista y, con clave, extracción Haiku validada; sugerencia «Crear el seguimiento» (prioridad por interés); recalcula la siguiente acción | nunca confirma preferencias; nunca crea la tarea sola |

Todas: flag `ai_automations`, organización del evento, alcance del sistema. **Nada se envía a clientes ni se publica.**

## Despliegue seguro (migración antes que el código)

Riesgo: en Vercel la migración puede aplicarse minutos antes de que el código nuevo reciba tráfico y el cron. El motor
anterior lanzaba `PermanentJobError("Acción desconocida")` → job `dead` + aviso.

Estrategia (doble, testeada en `tests/integration/ai-automation.test.ts › despliegue seguro`):

1. **Definiciones desactivadas en la migración.** 0531 inserta las cuatro `ai_reaction_*` con `is_enabled = false`. El motor
   viejo solo despacha automatizaciones habilitadas: no encola nada para ellas.
2. **Activación desde el código nuevo.** `syncAiReactions` (`src/server/ai/automation/sync.ts`) las habilita solo si el flag
   `ai_automations` está encendido **y** todas sus acciones están registradas en ese proceso; si no, las desactiva. Corre
   cada 5 min (`ai.reactions_sync`) y al cambiar el flag en Integraciones. Cada cambio queda auditado
   (`AUTOMATION_ENABLED/DISABLED` con motivo). El botón de la pantalla Automatizaciones no las controla (conflicto
   explicado).
3. **Motor tolerante (defensa en profundidad).** Con código nuevo, una acción desconocida (p. ej. rollback del código con
   definiciones ya activas) deja la ejecución `skipped` con «acción no disponible en esta versión: …», sin job muerto ni
   aviso. Tras un rollback, `ai.reactions_sync` de la versión nueva ya no corre, pero tampoco el motor viejo daña nada:
   ver Rollback.

Consecuencia aceptada: mientras el flag está apagado (o antes del primer `ai.reactions_sync`), los eventos no se
reprocesan después (igual que cualquier automatización desactivada). La bandeja se recompone con los refrescos
periódicos de Tareas sugeridas.

### Rollback

Si se vuelve a un deploy anterior con las reacciones activas, el motor viejo marcaría `dead` las ejecuciones de acciones
`ai_react_*`. Antes del rollback: apagar `ai_automations` en Integraciones (desactiva las cuatro en el acto) o
`update automation_definitions set is_enabled = false where key like 'ai\_reaction\_%';`.

## Garantías

| Garantía | Cómo | Test |
| --- | --- | --- |
| Idempotencia | `automation_runs unique(automation_id, trigger_event_id)` + dedupe del job `automation:<id>:<evento>`; las acciones solo hacen upserts por clave natural | › visita finalizada (reproceso del mismo evento: 1 run, mismas sugerencias) |
| Reintentos limitados | `automation.run` con `maxAttempts 5`, backoff exponencial con jitter (runner existente) | › reintentos y dead-letter |
| Dead-letter + aviso | job `dead` → `notifyRole("administrador")` `job_dead` (existente) | › reintentos y dead-letter |
| Sin loops | ver abajo | › protección contra loops |
| Auditoría | activación/desactivación auditada; decisiones humanas auditadas en Tareas sugeridas; `automation_runs` con resultado | › activación |
| Métricas | runs, fallas, omitidas (loop guard), p50/p95 por automatización en Automatizaciones (7 días) y en Uso de IA (período) | observabilidad (integración) |

## Protección contra loops

- `withEventCause` (AsyncLocalStorage en `events.ts`): el motor corre las acciones con la causa del evento. Todo
  `emitEvent` adentro guarda `causation_id`, `correlation_id`, `depth + 1` y `caused_by_automation`. `enqueue` guarda la causa
  en el job (`jobs.causation_*`) y el runner la restaura: la cadena no se pierde al pasar por un job.
- **Profundidad máxima** (`ai.events.max_depth`, 3, rango 1–10): `dispatchPendingEvents` no encola automatizaciones para
  eventos con `depth ≥ máx.` (queda `last_error` con el motivo).
- **Misma cadena**: `automation.run` recorre la cadena causal (CTE recursiva) y omite la ejecución si la automatización
  ya causó el evento o un ancestro (`loopGuard: same_chain`).
- Reglas puras en `src/server/automation/loop-guard.ts` (tests unitarios) y tests con A→A, A→(job)→A y A→B→C→A.
- Además, ninguna automatización del sistema escucha eventos `ai.*`, `recommendation.*`, `lead.qualified`, etc.

## Jobs de las Fases 5 y 6

| Job | Frecuencia | Qué hace |
| --- | --- | --- |
| `ai.reactions_sync` | cada 5 min | activación segura de reacciones |
| `ai.task_center_refresh_fast` | cada 5 min | Tareas sugeridas: visitas, alertas, asignaciones, anomalías, marketing |
| `ai.task_center_refresh` | horaria | Tareas sugeridas: siguiente acción de ventas (tope `ai.task_center.max_contacts_per_run`) y calidad |
| `ai.anomalies_detect` | horaria | anomalías; invalida resúmenes si abrió alguna |
| `ai.site_events_rollup` | diaria (06:00 Salta) | `property.viewed`, `tour.started`, `tour.completed` del día anterior |

## Observabilidad

- CRM → Automatizaciones: por automatización ejecuciones, con error, omitidas y duración p50/p95 (7 días); las reacciones de
  IA muestran que se controlan con el flag.
- CRM → Integraciones → Uso de IA → **Automatizaciones de IA** (`ai_*` y `sales_*`): estado, ejecuciones, errores, omitidas
  (por loop guard), p50/p95 y jobs muertos de IA del período; feature `ai.visit_report_profile` en «Por función».
- Logs: `automation.loop_guard`, `automation.unknown_action`, `ai.reaction_failed`, `ai.reactions_synced`,
  `ai.task_center_source_failed`, `ai.anomalies_detected`.
