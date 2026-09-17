# IA de visitas (Fase 4b)

Implementa los puntos de extensión de `src/server/visits/ai-extension.ts` sobre el AI Core (docs/ai/AI_CORE.md) y el
núcleo operativo de visitas (docs/operations/VISITS.md). Guía de uso para el equipo: `knowledge/visits-ai.md`.

```
 appointment.created / appointment.assigned ──automatización ai_visit_brief_*──▶ acción enqueue_visit_brief ──▶ job ai.visit_brief
 tarea horaria ai.visit_brief_refresh (visitas que empiezan en ~2 h) ─────────────────────────────────────────▶ job ai.visit_brief
 /crm/mis-visitas/[id] ── buildVisitBrief(ctx) ── loadVisit (alcance) ── brief guardado si el hash coincide, si no el determinista
                        ── «Actualizar» ── refreshVisitBrief (con IA si hay) 
                        ── «Proponer campos con IA» ── proposeVisitReport ── propuesta (visit_ai_outputs) ── «Revisá y confirmá»
                        ── «Redactar una variante con IA» ── draftThanksWithAi ── texto editable (no se guarda solo)
                        ── Seguimiento ── suggestFollowUp (reglas) ── la tarea se crea solo con «Crear tarea de seguimiento»
```

## Archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/server/visits/ai-extension.ts` | Contrato (ahora recibe `{ db, actor }`), implementación nula y `registerVisitAi` |
| `src/server/ai/visits/rules.ts` | Puro: brief determinista (hechos `H1…`, «NO REGISTRADO»), seguimiento sugerido con motivo |
| `src/server/ai/visits/service.ts` | Lectura de datos, brief (job, refresco, a pedido), propuesta de informe, variante de agradecimiento, seguimiento, centro operativo |
| `src/server/ai/visits/register.ts` | Registra la implementación (import por efecto en la página y los tests) |
| `src/server/ai/prompts/visits.ts` | Prompts versionados `visit.brief`, `visit.report`, `visit.thanks` con zod |
| `src/components/visits/brief-card.tsx` | Tarjeta «Antes de la visita» |
| `src/components/visits/report-form.tsx`, `closing-panels.tsx` | Botones con IA solo si hay modelo; propuesta y sugerencia de seguimiento |
| `src/app/crm/(panel)/mis-visitas/ai-actions.ts` | Server Actions |

## Brief previo (flag `ai_visit_brief`, encendido)

- **Datos** (todo filtrado por la organización del agente asignado): cliente; qué busca (interés del lead, oportunidad
  con etapa y presupuesto, notas de la cita y del contacto; perfil del comprador de la Fase 2: SOLO preferencias
  confirmadas por una persona en `client_preferences`, formateadas con `formatFieldValue`); qué preguntó (mensajes de leads del contacto y mensajes entrantes de conversaciones,
  los 4 más recientes); propiedad (precio aunque esté oculto en el sitio —es interno—, expensas, ambientes, superficies,
  antigüedad, orientación, estado, crédito, características, tour).
- **NO REGISTRADO**: precio, gastos/expensas, escritura (sin documento `deed`), orientación, antigüedad, estado de
  conservación, apta crédito, mascotas (residenciales), superficie, cocheras (no terrenos), servicios (sin
  características de gas/agua/cloacas/luz).
- **Determinista hoy**; con clave, el modelo (`answer`) recibe los hechos numerados como datos no confiables y devuelve
  puntos que **citan ids de hechos** + hasta 3 sugerencias. Guardas: ids inexistentes o cifras que no están en los
  hechos (los mensajes de clientes NO cuentan como evidencia de cifras) → se descarta y queda el determinista. La UI
  muestra SIEMPRE los hechos desde los datos; la IA va en recuadros rotulados («Resumen de la IA», «interpretación, no son
  datos»).
- **Idempotente**: `input_hash` (datos + versión de reglas + versión del prompt). Sin cambios no reescribe ni emite.
- **Evento** `visit.brief_prepared` `{ generatedBy, notRegistered, facts, rulesVersion }` con dedupe por hash.

## Informe estructurado (flag `ai_followup`, con clave)

`proposeVisitReport` (tarea `extract`, Haiku) sobre el comentario del agente (PII enmascarada, datos no confiables).
Devuelve `{ summary, interest, positives, objections, nextStep, followUpAt }` y la guarda en `visit_ai_outputs`
(`report_proposal`, hash del texto: recargar no vuelve a llamar). **Nunca** toca `appointment_reports`: el agente usa
«Usar estos campos» y confirma con `saveVisitReport`. Evento `visit.report_structured` `{ fields, prompt }`.
Sin clave el botón no aparece.

## Agradecimiento (flag `ai_followup`, con clave)

`draftThanksWithAi` con cliente (nombre de pila), asesor, propiedad, empresa y positivos **confirmados**. Guardas de
cifras/links/teléfonos; se carga en el cuadro editable y se guarda con el flujo de siempre. Sin clave: plantilla.

## Seguimiento sugerido (flag `ai_followup`, encendido)

Reglas (`suggestVisitFollowUp`): fecha indicada por el agente (si difiere de la sugerida por interés) o interés alto
24 h / medio 48 h / bajo 7 días; acción por siguiente paso (segunda visita, oferta, documentación, comparables) y motivo
(objeción de precio). Se muestra con título editable; **la tarea se crea solo al confirmar** (`createVisitFollowUp`).

## Permisos y alcance

Todo lo que dispara una persona pasa por `loadVisit` (agente: solo sus visitas; `visits.monitor`/`agenda.read_all`:
todas de su organización) y `assertCanManageVisit` para proponer/redactar. Los jobs escriben por id sin exponer nada.
Tests: `tests/integration/ai-visits.test.ts`, `tests/unit/ai-visits-rules.test.ts`.
