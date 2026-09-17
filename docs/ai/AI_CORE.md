# AI Core (Fase 1) y copiloto «✦ Asistente IA»

Un único núcleo de IA reutilizable dentro del monolito. Las fases siguientes (ventas, propiedades, operaciones,
dirección, automatización) agregan herramientas y prompts sobre este núcleo; no crean chatbots paralelos.
Reglas de gobierno: [GOVERNANCE.md](./GOVERNANCE.md). Mapa del sistema: [ARCHITECTURE_MAP.md](./ARCHITECTURE_MAP.md).

```
 CRM (layout) ── CopilotLauncher (liviano) ──(clic / Ctrl+I, carga diferida)──▶ CopilotPanel
                                                                                   │ Server Actions (runAction)
                                                                                   ▼
 src/server/ai/copilot/service.ts   autorización → límite → contexto → modo → registro + evento
        │                    │                        │
        │           knowledge/retrieval.ts     core/registry.ts ── domains/{knowledge,sales,property,operations,executive}
        │           (full-text español)         (permiso + capability + zod)
        ▼
 core/provider.ts (AIProvider) ── core/anthropic.ts ── ai/client.ts (callModel → callIntegration: timeout, reintentos, circuito)
 core/routing.ts (tarea → modelo)   core/governance.ts (datos delimitados, PII, JSON Schema)   ai/guards.ts (grounding)
 core/usage.ts (ai_interactions)    core/memory.ts (sesión / cliente / empresa)                 prompts/* (versionados)
```

## Estructura

| Archivo | Responsabilidad |
| --- | --- |
| `core/types.ts` | Tipos neutrales (mensajes, bloques, herramientas, tareas) e interfaz `AIProvider` |
| `core/provider.ts` | `ChatBasedProvider`: `extract` (tool forzada + zod), `summarize` (datos delimitados), `vision` sobre `chat` |
| `core/anthropic.ts` | `AnthropicProvider` (traducción al SDK 0.126.0, prompt caching del bloque estático) y `getAnthropicProvider` |
| `core/routing.ts` | Modelo por tarea desde `settings` con defaults y validación de precio |
| `core/registry.ts` | `ToolRegistry`: registro por dominio, capabilities, verificación de permisos, consultas rápidas |
| `core/context.ts` | Contexto de pantalla re-validado y links a pantallas con `[id]` |
| `core/governance.ts` | `untrustedData`, `redactForModel`, JSON Schema desde zod |
| `core/errors.ts` | `AIUnavailableError`, `AIOutputError`, `AIGovernanceError`, `classifyAIError` |
| `core/usage.ts` | Registro en `ai_interactions` (sin prompts) |
| `core/memory.ts` | Sesión (`ai_conversations`/`ai_messages`), interfaz `CustomerMemory` (Fase 2), purga |
| `domains/*` | Herramientas `read` por dominio + score de completitud |
| `knowledge/*` | Parser, ingesta idempotente y retrieval |
| `prompts/*` | Registro versionado (`copilot.assistant`, `copilot.analyst`) |
| `copilot/*` | Orquestación, DTOs, textos honestos |
| `observability.ts` | Métricas de la página «Uso de IA» |
| `jobs.ts` | `ai.knowledge_ingest` y `ai.housekeeping` (diarios) |

## Proveedor

`AIProvider` expone `chat` (con herramientas, `toolChoice` y `responseSchema`), `extract` (salida estructurada validada
con zod por tool-use forzado), `summarize`, `vision` (declarada; se usa en fases siguientes) y `embed?` (opcional: Anthropic
no ofrece embeddings; no se agregó otro proveedor ni pgvector). La implementación Anthropic reutiliza `client.ts`:
cliente cacheado por clave, `awaiting_credentials` sin `ANTHROPIC_API_KEY`, timeout por intento, reintentos solo ante
408/409/429/5xx/conexión, `deadline` del turno y circuit breaker persistido con `integration_logs`
(`entity_type = ai_conversation`). Para agregar otro proveedor: implementar `ChatBasedProvider.chat` y elegirlo en
`copilot/service.ts` (`resolveProvider`).

## Ruteo de modelos

| Tarea | Default | Uso |
| --- | --- | --- |
| `classify` | `claude-haiku-4-5-20251001` | clasificación rápida (fases siguientes) |
| `extract` | `claude-haiku-4-5-20251001` | extracción estructurada (fases siguientes) |
| `answer` | `claude-sonnet-5` | modo Asistente |
| `analyze` | `claude-sonnet-5` | modo Analista |
| `vision` | `claude-sonnet-5` | fotos/planos (fases siguientes) |

Se cambian con `update settings set value = '"claude-opus-5"' where key = 'ai.model.answer';`. Solo se aceptan modelos
con precio en `ai/pricing.ts` (precios públicos verificados el 2026-09-16 en platform.claude.com/docs/en/about-claude/pricing;
Haiku 4.5 = USD 1 entrada / 5 salida por MTok, Sonnet 5 = USD 2 / 10); si no, se usa el default y queda un aviso en logs
y en la página de uso. El asistente de WhatsApp sigue usando `AI_MODEL` (sin cambios).

## Herramientas (Fase 1: todas `read`)

| Dominio | Herramienta | Permisos (uno alcanza) | Consulta rápida | Alcance |
| --- | --- | --- | --- | --- |
| knowledge | `search_crm_guide` | `ai.copilot` | — | secciones filtradas por permisos |
| sales | `uncontacted_leads` | `leads.read_own`, `leads.read_all` | «Leads sin contacto (+24 h)» | propio/todos + organización |
| sales | `stale_opportunities` | `opportunities.read_own`, `opportunities.read_all` | «Oportunidades estancadas» | propio/todos + organización |
| property | `incomplete_properties` | `properties.read` | «Fichas incompletas» | organización, sin demo |
| property | `property_completeness` | `properties.read` | «¿Qué le falta a esta ficha?» (solo en una ficha) | registro re-validado |
| operations | `visits_today` | `visits.operate`, `visits.monitor`, `agenda.manage`, `agenda.read_all` | «Visitas de hoy» | con `visits_operations` y `visits.*`: consulta y alcance de «Mis visitas» (`listMyVisits`: etapas en camino/check-in/en curso, resultado del check-in, link al portal); si no, Agenda propio/equipo |
| operations | `visit_incidents` | `visits.monitor` | «Incidencias de visitas» (solo con `visits_operations`) | alertas abiertas del centro operativo (`getOpsBoard`), organización |
| operations | `overdue_tasks` | `tasks.manage`, `tasks.read_all` | «Tareas vencidas» | propio/equipo + organización |
| executive | `week_summary` | `dashboard.read` | «Números de la semana» | cada conteo con su permiso y alcance |

Cada resultado (`ToolResult`) trae título, resumen determinista, ítems con link, total, truncado, **origen** (pantalla del
CRM) y alcance aplicado; el texto libre va aparte (`untrusted`) para enviarse delimitado.

### Herramientas de la Fase 3 (AI Property)

| Dominio | Herramienta | Permisos | Consulta rápida | Alcance |
| --- | --- | --- | --- | --- |
| property | `property_quality` | `properties.read` | «Calidad de esta publicación» (en una ficha, flag `ai_property_qa`) | informe determinista de la organización, sin demo |
| property | `low_quality_properties` | `properties.read` | «Publicaciones con peor calidad» (flag `ai_property_qa`) | organización, activas |

Registradas en `domains/property-quality.ts` (una línea en `domains/index.ts`). `property_completeness` sigue igual.

### Tareas de IA fuera del copiloto (`src/server/ai/run-task.ts`, Fases 3 y 4b)

Orquestador mínimo para funciones puntuales sobre el mismo núcleo: resuelve proveedor (Anthropic o, solo en tests,
`setTaskProviderForTests`), presupuesto, modelo por tarea, `provider.extract` con el prompt versionado, `verify` de
negocio (una violación descarta la salida con `fallback_reason = guard_blocked`) y registro en `ai_interactions` con
`purpose` `photo_tags` | `marketing_draft` | `tour_intent` | `visit_brief` | `visit_report` | `visit_thanks` (sin clave no
se registra cada intento; presupuesto agotado sí). Nunca lanza por la IA.

| Prompt | Tarea | Uso |
| --- | --- | --- |
| `photo.room_tags@2026-09-17.1` | `vision` | ambiente por foto (sugerencia a aceptar) |
| `marketing.director@2026-09-17.1` | `answer` | borradores por canal con guardas de grounding y atributos |
| `tour.intent@2026-09-17.1` | `classify` | intención de la pregunta del tour (escena/dato) |
| `visit.brief@2026-09-17.1` | `answer` | resumen del brief citando hechos + interpretación |
| `visit.report@2026-09-17.1` | `extract` | propuesta de campos del informe |
| `visit.thanks@2026-09-17.1` | `extract` | variante del agradecimiento |

Detalle: docs/ai/PROPERTY.md y docs/ai/VISITS_AI.md.

### Score de completitud (base para la Fase 3)

`domains/property-completeness.ts`, 0–100: portada 15 · 5+ fotos 10 · descripción de 200+ caracteres 15 · precio en una
operación activa 15 · ubicación 10 · superficie 10 · dormitorios 10 (solo tipos residenciales; en el resto cuenta como
cumplido) · agente responsable activo 10 · calle 5. No evalúa calidad del texto ni de las fotos.

### Cómo agregar una herramienta

1. Elegí el dominio en `src/server/ai/domains/<dominio>.ts` y llamá `registry.register({...})` con `name` (snake_case),
   `description` (qué devuelve, para el modelo), `capability` (`read`/`suggest`/`draft`; `execute` está prohibido),
   `permissions` (claves reales), `input` (zod) y `run(ctx, input)`.
2. En `run`: aplicá el alcance (`crm/access.ts`) y `organization_id`; seleccioná columnas explícitas; nada de teléfonos,
   emails, documentos, coordenadas ni direcciones ocultas; devolvé un `ToolResult` con `source` y `scope`.
3. Si sirve sin modelo, agregá `quick` (id, etiqueta, palabras clave normalizadas sin acentos).
4. Tests: permiso (rol sin permiso no la ve ni la ejecuta), alcance propio/todos, otra organización, y el caso vacío.
5. Si la herramienta sugiere o prepara algo, la persistencia la hace un servicio normal tras confirmación humana.

### Núcleo operativo de visitas (PR #9)

El copiloto no reinventa visitas: usa `src/server/visits` (alcance `visitScope`, `listMyVisits`, `getOpsBoard`, etiquetas
`VISIT_PHASE_LABEL` y `ALERT_LABEL`) y su flag. El contexto de pantalla reconoce `/crm/mis-visitas/[id]` con `loadVisit`.
Los puntos de extensión `src/server/visits/ai-extension.ts` (brief previo, informe estructurado, borrador de
agradecimiento) **siguen con la implementación nula** en esta fase; se conectan en la Fase 4 con
`registerVisitAi(...)` sobre `AIProvider.extract` (tarea `extract`) y flags `ai_visit_brief` / `ai_followup`, siempre como
propuesta que el agente revisa y confirma.

## Prompts

Registro en `src/server/ai/prompts/registry.ts`: `id`, `version` (`AAAA-MM-DD.n`), `task`, `system` (bloque estático
cacheable), `output` (zod) y `notes`. Cambiar reglas, herramientas o formato → nueva versión. Cada respuesta registra
`id@version` en `ai_interactions.prompt_version` y `ai_messages.prompt_ref`; las respuestas sin modelo usan
`copilot.deterministic@…`. Ningún prompt vive en componentes React.

## Retrieval (RAG sin embeddings)

- **Fuente**: `knowledge/*.md` (13 guías, incluida `visits.md` del núcleo operativo de visitas) escritas desde las rutas, formularios, acciones y permisos
  reales. Formato en `knowledge/README.md` (frontmatter + una sección `##` por fragmento con `ruta` y `permisos`).
- **Ingesta**: `pnpm ai:knowledge:ingest` (en cada deploy que cambie `knowledge/`) y job diario `ai.knowledge_ingest`.
  Una transacción con lock; hash por documento y por sección; solo inserta/actualiza/borra lo cambiado; falla sin
  escribir ante errores de formato o permisos inexistentes.
- **Índice**: `ai_knowledge_chunks.search` = `tsvector` generado con `to_tsvector('spanish', …)` sobre texto sin acentos
  ni signos (título peso A, cuerpo peso C) + GIN; trigram sobre el título.
- **Consulta**: tokens saneados (`[a-z0-9]`, sin ruido como «cómo hago») unidos con OR; filtro por organización y
  permisos del actor; ranking = cobertura de términos en el título ×4 + cobertura total ×2 + afinidad con el módulo de
  la pantalla + `ts_rank`. Evidencia mínima: algún término en el título (y 2 si hay 3+ términos). Sin evidencia → `[]`.

## Memoria

| Nivel | Implementación |
| --- | --- |
| Empresa | Base de conocimiento (compartida, filtrada por permisos) |
| Cliente | Interfaz `CustomerMemory` en `core/memory.ts` (Fase 2; sin implementación) |
| Sesión | `ai_conversations` / `ai_messages` por usuario, retención `ai.copilot.session_retention_days` (30), pregunta minimizada |

## Copiloto

- **Entrada única** «✦ Asistente IA» en el encabezado del CRM (si hay permiso `ai.copilot` y flag `ai_copilot`).
  Atajo **Ctrl + I** (⌘ + I), Esc cierra. `<dialog>` modal a la derecha (pantalla completa en celular), pestañas con
  `role="tab"`, región viva para anunciar respuestas. El panel y las acciones se cargan bajo demanda.
- **Asistente** («¿cómo hago…?»): pregunta → autorización → intención determinista (si parece una consulta de datos,
  sugiere el Analista) → retrieval → modelo (`copilot.assistant`, salida estructurada) → validación (zod, fuentes,
  guardas) → respuesta con fuentes y link a la pantalla (con el id del registro abierto si corresponde). Sin clave: «Esto
  es lo que dice la guía del CRM:» + secciones.
- **Analista** («¿qué está pasando?»): chips deterministas siempre disponibles (datos reales con alcance). Con clave, el
  modelo elige herramientas `read` (hasta 3 rondas) y redacta; los HECHOS se muestran desde los resultados y la
  interpretación aparte. Sin clave, el texto libre se resuelve por palabras clave o se ofrecen los chips.
- **Streaming**: no se hace streaming de tokens a propósito: la respuesta se valida completa (zod + guardas) antes de
  mostrarse; mostrar texto parcial expondría datos que luego se descartan. La UI muestra estado de carga.
- **Feedback** 👍/👎 con comentario opcional (`ai_feedback`, upsert por usuario y respuesta).

## APIs internas

Server Actions en `src/app/crm/(panel)/_copilot/actions.ts` (todas por `runAction`):

| Acción | Servicio | Devuelve |
| --- | --- | --- |
| `copilotStatusAction({ path })` | `getCopilotStatus` | estado honesto, contexto, consultas rápidas del rol |
| `askCopilotAction({ mode, question?, quickQueryId?, path?, conversationId? })` | `askCopilot` | `CopilotAnswer` |
| `copilotFeedbackAction({ messageId, rating, comment? })` | `recordCopilotFeedback` | `{ saved: true }` |

## Eventos

| Evento | Cuándo | Payload |
| --- | --- | --- |
| `ai.answer.generated` | cada respuesta del copiloto | ids de interacción/mensaje, modo, origen (ai/guide/data), estado, motivo de respaldo |
| `ai.feedback.recorded` | cada 👍/👎 | id del mensaje, rating, si hay comentario |
| `property.quality_computed`, `media.tags_suggested`, `marketing.draft_created`, `visit.brief_prepared`, `visit.report_structured` | Fases 3 y 4b (docs/ai/PROPERTY.md) | ids, contadores y versiones; dedupe por hash |
| `ai.recommendation.*` | **reservado para la Fase 5** (recomendaciones dentro de automatizaciones): `ai.recommendation.proposed`, `.accepted`, `.dismissed` | — |

Ninguna automatización del sistema escucha estos eventos y la IA no reacciona a eventos: no hay loops.

## Costos y observabilidad

- CRM → Integraciones → **Uso de IA** (`/crm/integraciones/ia`, permiso `ai.read_usage`): pedidos, errores, tasa de
  respaldo, latencia p50/p95 por función, fallas de herramientas y de búsqueda, motivos de respaldo, uso por
  herramienta, costo de hoy y del mes contra el presupuesto diario, serie diaria, modelos por tarea, prompts, estado del
  proveedor, guía cargada, flags y comentarios de feedback.
- Logs estructurados: `ai.copilot_answer`, `ai.copilot_call_failed`, `ai.copilot_guard_blocked`, `ai.copilot_tool_rejected`,
  `ai.tool_failed`, `ai.retrieval_failed`, `ai.model_setting_rejected`, `ai.knowledge_ingested`.

## Settings y flags

| Clave | Default | Qué controla |
| --- | --- | --- |
| `ai.model.<tarea>` | ver ruteo | modelo por tarea |
| `ai.daily_budget_usd` | 5 | presupuesto diario compartido con WhatsApp |
| `ai.copilot.requests_per_hour` | 60 | límite por usuario |
| `ai.copilot.session_retention_days` | 30 | retención de sesiones |
| `ai.analyst.stale_opportunity_days` | 14 | umbral de oportunidades estancadas |
| flag `ai_copilot` | encendido | muestra el copiloto |
| flags `ai_concierge`, `ai_matching`, `ai_executive`, `ai_automations` | apagados | fases 2 y 5 |
| flags `ai_property_qa`, `ai_visit_brief`, `ai_followup`, `ai_photo_director`, `ai_marketing_director`, `ai_tour_guide`, `owner_capture_steps` | encendidos (capa determinista completa) | fases 3 y 4b, ver docs/ai/PROPERTY.md |
| flag `owner_capture_photos` | apagado | requiere storage S3 |

## Activar con la clave del proveedor

1. Crear la API key en la consola de Anthropic (organización de la inmobiliaria) con límite de gasto.
2. Vercel → Settings → Environment Variables → `ANTHROPIC_API_KEY` en Production (y Preview/Staging con otra clave):
   `printf "%s" "$KEY" | vercel env add ANTHROPIC_API_KEY production`. Redeploy.
3. Revisar `ai.daily_budget_usd` (5 USD por defecto) y el límite por usuario.
4. Abrir el copiloto: el aviso «todavía no está configurado» desaparece; la primera respuesta real pasa la integración
   `anthropic` de «Esperando credenciales» a «Activa». Verificar en **Uso de IA** costo, latencia y respaldos.
5. Si algo sale mal: apagar `ai_copilot` en Integraciones (sin redeploy) o quitar la variable; el CRM sigue igual.
