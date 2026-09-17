# IA Fase 2 · Ventas («AI Sales»)

Concierge del sitio, preguntas sobre una propiedad, comparador, perfil del comprador, coincidencias cliente ↔ propiedad,
señales de interés, calificación de leads, siguiente acción recomendada y «Ponme al día» en el copiloto. Todo reutiliza
el AI Core de la Fase 1 ([AI_CORE.md](./AI_CORE.md), [GOVERNANCE.md](./GOVERNANCE.md)): mismo proveedor, ruteo, registro de
herramientas, prompts versionados, `ai_interactions`, presupuesto y guardas. **Hoy no hay `ANTHROPIC_API_KEY`: cada
función tiene una capa determinista completa y testeada**; la capa con modelo se activa sola al cargar la clave.

## Línea base (antes de tocar código, `main` @ 3cca8d7)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos (8 s) |
| `pnpm typecheck` | OK |
| `pnpm test` | 54 archivos, **522 tests OK** (52 s) |
| `pnpm build` | OK |
| Lighthouse mobile `/` (3 corridas, `next start`, APP_ENV=development) | Performance 92 / 96 / 96 · a11y 100 · BP 100 · SEO 69 (noindex del entorno) · LCP 3,37 / 2,71 / 2,71 s · TBT ≤ 5 ms · CLS 0 · JS 165 KB transferidos |
| Lighthouse mobile ficha `/propiedades/casa-venta-salta-2605` | Performance 94 / 94 / 96 · a11y 100 · BP 100 · LCP 3,06 / 3,14 / 2,71 s · TBT 4 ms · CLS 0 · JS 178 KB |

## Arquitectura

```
Sitio (anónimo)                                   CRM (equipo, RBAC + alcance comercial)
 ConciergeSearch ──POST /api/site/concierge──┐     Ficha contacto: Perfil · Compatibles · Señales · Siguiente acción
 PropertyQA ──POST /api/site/property-qa──┐  │     Lead: Resumen · Siguiente acción     Oportunidad: Siguiente acción
 Comparador /propiedades/comparar (+resumen) │  │     Propiedad: Clientes compatibles      Copiloto: «Ponme al día»
 LeadForm (sessionKey + filtros + 2 opcionales) │  │          │ Server Actions (_sales/actions.ts, runAction)
 trackSite → /api/site/events (allowlist)      │  │          ▼
                                   src/server/sales/
   intent/{schema,parse,filters}  concierge  property-qa/{answer,service}  compare/{build,service}  public-ai
   profile/{fields,service,memory}  matching/{score,properties,service}  signals/{rules,service}
   nba/{rules,service}  qualification/{summary,service}  site-context  scope  crm-panels  catalog  jobs
                                             │
       AI Core: core/provider (extract) · routing (tarea extract → Haiku) · governance (untrustedData, redactForModel)
       guards (grounding) · prompts/sales-*.ts (versionados) · domains/sales-briefing.ts (herramienta read)
```

Módulos puros (sin base ni red, con tests unitarios): `intent/parse.ts`, `intent/filters.ts`, `profile/fields.ts`,
`matching/score.ts`, `signals/rules.ts`, `nba/rules.ts`, `property-qa/answer.ts`, `compare/build.ts`,
`qualification/summary.ts`.

## 1. Concierge «Contanos qué buscás»

- **Dónde**: portada (sobre la barra de búsqueda) y arriba de los listados. Sin JS el formulario hace POST y el servidor
  redirige (303) al listado filtrado. Con JS interpreta, navega y el listado explica «Entendimos: …» (chips que filtran y
  chips que no), «No pude interpretar: …», monto sin moneda («¿dólares o pesos?») y pista para propietarios («¿Querés
  vender o tasar?»). La edición manual son los filtros y chips existentes del listado.
- **Intención** (`intent/schema.ts`, zod): `transactionType, propertyTypes, budgetMin, budgetMax, currency, locations,
  bedrooms, bathrooms, surface, garages, features, moveTimeframe, financing, preferences, ambiguousAmount, unparsed`.
  Cada campo con `origin` (`text` | `inferred` | `ai`), `confidence` y `evidence`.
- **Capa determinista** (`intent/parse.ts`): texto plegado sin acentos con posiciones intactas; extrae en orden zonas →
  superficie → dormitorios/ambientes/baños/cocheras → montos → operación → tipos → características → financiación →
  plazo → preferencias; lo no consumido son `unparsed`. Números «180.000», «180 mil», «180k», «1,5 millones», «900
  lucas»; USD/dólares/u$s/verdes y $/pesos; «hasta/desde/entre/de…a/alrededor de (±10 %, inferido)». Monto sin moneda
  **no filtra**. «N ambientes» ≈ N−1 dormitorios (`inferred`). Zonas: localidades y barrios **con inventario publicado**
  (mismas facetas del buscador), alias «San Lorenzo», «Salta capital»; «Salta» a secas no filtra; barrios homónimos no
  filtran (se informan). Tipos con sinónimos validados contra el inventario (lote → terreno si no hay lotes).
  Características: sinónimos + catálogo real por nombre, negación («sin pileta»), nombres genéricos ignorados.
- **Filtros reales** (`intent/filters.ts`): solo lo que el buscador filtra (una operación, un tipo y una zona por vez;
  varias → chip informativo). URL canónica `/propiedades/venta?…` (`filtersToQuery`).
- **Capa con IA**: solo si quedó algo sin interpretar o no hubo filtros. `sales.concierge@2026-09-17.1` (tarea `extract`
  → Haiku 4.5), catálogo real como datos, texto como `<datos_no_confiables>` minimizado. Salida zod → normalización
  (claves fuera del catálogo se descartan) → **toda cifra tiene que estar en el texto** (si no: `guard_blocked` y queda la
  determinista) → merge (lo literal manda). Inválida, caída, timeout o presupuesto → determinista. El modelo nunca
  devuelve resultados.

## 2. Perfil del comprador (`client_preferences`)

- **Campos (lista cerrada)**: `transaction_type, goal, property_types, budget, locations, bedrooms_min, bathrooms_min,
  surface, features, move_timeframe, financing, notes`. Valores `strictObject` (una clave extra se rechaza); tipos,
  características y zonas validados contra la base. Sin campos para datos sensibles.
- **Estados**: `suggested` → `confirmed` | `rejected`; `superseded` = historial. Índices únicos: un confirmado y una
  sugerencia pendiente por campo. Un dato sugerido nunca pisa uno confirmado; lo rechazado no se vuelve a proponer.
- **Orígenes**: `form` (preguntas opcionales del formulario y operación de la ficha, confianza 0,9 / 0,6), `concierge`
  (filtros de la pestaña al enviar la consulta, confianza ≤ 0,9 según origen), `lead_message` (parser determinista sobre
  la consulta ×0,8; con clave, Haiku `sales.lead_extract`), `conversation` (`CustomerMemory.proposeUpdate`), `agent`
  (carga del equipo, confirmado).
- **Edición**: ficha del contacto → «Perfil de búsqueda» (Confirmar / Descartar / Editar / Agregar / Quitar / historial).
  Auditoría `CLIENT_PREFERENCE_SET|CONFIRMED|REJECTED|CLEARED` (las notas se auditan como «[texto]»). Cada cambio encola
  `sales.match_contact` (dedupe por contacto).
- **Memoria de cliente del AI Core**: `BuyerProfileMemory` (`profile/memory.ts`) implementa `CustomerMemory`: `getProfile`
  solo con confirmados; `proposeUpdate` crea sugeridos.

## 3. Coincidencias cliente ↔ propiedad (`matching/score.ts`, `match-2026.09.17-1`)

1. **Filtros obligatorios**: publicada, **disponible** (reservada no), operación, tipo y presupuesto con tolerancia
   (`ai.matching.budget_tolerance_pct`, 10 %). Precio oculto no descarta («Precio a consultar»).
2. **Ponderación** (solo lo expresado): presupuesto 25 (dentro del rango 100 %, excede dentro de la tolerancia 60 %,
   oculto 40 %) · zonas 25 (barrio/localidad exacta 100 %, misma localidad otro barrio 40 %) · dormitorios 20 (≥ 100 %,
   uno menos 40 %, sin dato 25 %) · superficie 15 (en rango 100 %, hasta 15 % menor o mayor 50 %) · características 15
   (proporción) · baños 10. Puntaje = obtenido / posible × 100; vio la propiedad en el sitio +5 (tope 100).
3. **Umbral** `ai.matching.min_score` (55). **Perfil apto**: qué (operación o tipo) y dónde/cuánto (zonas, o presupuesto
   **con operación**: un presupuesto de compra no se compara con alquileres).
4. **Explicación**: «Coincide: ✓ Presupuesto ✓ 3 dormitorios ✓ Jardín · Considerar: superficie menor a la preferida» y
   marca «Usa datos del perfil sin confirmar». Etiqueta siempre «Coincidencia estimada».
- **Pantallas**: contacto → «Propiedades compatibles» (con «Descartar» + motivo → `property_matches.status = dismissed`);
  propiedad del CRM → «Clientes compatibles» (alcance del agente).
- **Match inverso**: automatizaciones de sistema `sales_match_property_published` / `sales_match_property_price` →
  acción `sales_match_property` → `computeMatchesForProperty`: upsert por (contacto, propiedad) con puntaje, razones y
  versión; descartadas siguen descartadas; las que dejan de coincidir → `stale`; aviso `sales.match` al agente responsable
  (contacto → lead abierto → oportunidad abierta), dedupe por propiedad + motivo + día; evento `match.candidates_computed`.
  **Nunca** crea mensajes, conversaciones ni envíos (test).

## 4. «✦ Preguntale a esta propiedad»

- Desplegable en la ficha (cerrado por defecto, sin empujar contenido). Preguntas sugeridas solo sobre datos que la ficha
  tiene.
- **Determinista** (`property-qa/answer.ts`): clasifica por palabras clave (la pregunta nunca es instrucción) y responde
  con el DTO público: dormitorios, baños, ambientes, superficies, terreno, cocheras, características y atributos, precio
  o «a consultar», expensas, apto crédito, antigüedad, orientación, estado, mascotas, ubicación pública (con dirección
  oculta: «La dirección exacta se comparte al coordinar la visita»), disponibilidad y visita. Documentación/escritura no
  tienen campo público → «Ese dato no está registrado actualmente.». Un dato ausente nunca se responde como «no».
- **CTA reales**: «Consultar a un asesor» precarga el `LeadForm` de `#consulta` con la pregunta y enfoca el nombre;
  «Pedir una visita» abre el formulario de visita.
- **Con clave** (solo tema no reconocido): `sales.property_qa` con hechos publicados numerados (H1…) + descripción como
  datos no confiables. Guardas: `findViolations` contra los hechos estructurados (la descripción no es evidencia de
  cifras), ids citados existentes, patrón de dirección con altura bloqueado si está oculta. `registered=false` → texto fijo.

## 5. Comparador (`/propiedades/comparar?codigos=…`)

- «Comparar» en tarjetas del listado y en la ficha (hasta 3, `sessionStorage` + evento), barra flotante y URL compartible.
  Página `noindex`, fuera del sitemap, flag `site_compare`.
- Tabla (`compare/build.ts`): precio por operación, expensas, apto crédito, estado, tipo, superficies, ambientes,
  dormitorios, baños, cocheras, antigüedad, ubicación pública, orientación y cada característica (Sí / —). Filas distintas
  resaltadas; «Sin dato» cuando falta. Notas deterministas: diferencias de m² cubiertos y terreno, dormitorios, baños,
  precio (misma operación y moneda), precio a consultar, características exclusivas. No publicadas → aviso.
- Con clave: botón «✦ Resumen redactado» (`sales.compare`) con guardas sobre la tabla; sin clave el botón no existe.

## 6. Calificación de leads

- Acción `sales_qualify_lead` en `lead.created` (automatización de sistema): parser determinista sobre la consulta →
  sugerencias `lead_message`; con clave, Haiku `sales.lead_extract` (consulta minimizada: sin DNI/teléfonos/emails,
  cifras validadas); propuestas de siguiente acción (`sales_recommendations.status = open`, evento
  `recommendation.created`); evento `lead.qualified` (dedupe por lead). Omite tasaciones y captación.
- Tarjeta «Resumen del lead» (determinista): nombre, canales, origen, propiedad, objetivo, para qué, presupuesto, zona,
  tipo, dormitorios, plazo, financiación, necesidades (con estado y origen), % completo y «Para averiguar en la
  conversación» (faltantes, sin interrogatorio).
- **Captura progresiva en el sitio**: el `LeadForm` de consultas ofrece un desplegable opcional «Contanos un poco más»
  con 2 preguntas («¿Para cuándo lo buscás?», «¿Cómo pensás pagar?» — esta última no en alquileres). Nunca obligatorias.

## 7. Señales de interés

- **Eventos nuevos** (allowlist de `site_events`, sin texto ni PII): `property_viewed {from}`,
  `property_gallery_opened`, `property_qa_asked {topic, answered}`, `property_compared {count}`,
  `concierge_searched {filters, unparsed, layer, page}`, `lead_form_opened {kind}`. Propiedad por código público
  (solo publicadas, nunca demo). Flags por evento (`ai_matching`, `ai_property_qa`, `site_compare`, `ai_concierge`).
- **Vínculo sesión ↔ contacto** (`site_session_links`): solo al **enviar una consulta** desde esa pestaña y sin DNT/GPC
  (navegador y servidor). Retención 13 meses (misma purga que `site_events`). Texto de privacidad actualizado.
- **Reglas** (`signals/rules.ts`): solicitó visita 3 · volvió a la propiedad en ≥ 2 días distintos 2 (vistas de
  sesiones vinculadas + consultas por esa propiedad) · tour 360° 2 · preguntó disponibilidad o visita 2 · comparó 1 ·
  otras preguntas 1. Una señal repetida suma como máximo dos veces. Alta ≥ 5 · media ≥ 2 · baja ≥ 1 · sin hechos = sin
  nivel.
- Limitación: la clave es por pestaña (`sessionStorage`), así que «volvió» entre pestañas distintas solo se ve si hubo
  consultas en ambas. Se eligió no usar almacenamiento persistente por privacidad.

## 8. Siguiente acción recomendada (`nba/rules.ts`)

| Regla | Prioridad | Cuándo | Tarea al aceptar |
| --- | --- | --- | --- |
| `contact_today` «Contactar hoy» | alta | lead abierto sin primer contacto + señal fuerte (volvió, tour, pidió visita, preguntó disponibilidad) | llamada, 4 h, urgente |
| `first_response` «Responder la consulta» | alta (≥ 2 h) / media | lead abierto sin primer contacto | WhatsApp, 2 h |
| `schedule_visit` «Coordinar visita» | alta | pedido de visita (≤ 30 días) sin visita próxima | llamada, 24 h |
| `visit_followup` «Hacer el seguimiento de la visita» | media | visita realizada ≤ 7 días sin seguimiento | seguimiento, 24 h |
| `send_new_options` «Enviar nuevas opciones» | media | compatibles publicadas en 14 días no descartadas (motivo explícito si descartó por presupuesto) | WhatsApp, 48 h |
| `confirm_budget` «Pedir confirmación de presupuesto» | media (sin dato) / baja (sugerido) | lead u oportunidad abierta | llamada, 48 h |
| `review_profile` «Revisar datos sugeridos del perfil» | baja | sugerencias pendientes | tarea, 72 h |
| `reactivate` «Retomar el contacto» | baja | oportunidad abierta ≥ 14 días en la etapa y sin actividad 14 días | llamada, 48 h |

Máximo 3 por pantalla, ordenadas por prioridad. **Huella** = hash de la evidencia (ids): decisiones en
`sales_recommendations` ancladas al contacto (`entity_type='contact'`), así valen desde lead, contacto u oportunidad.
**Aceptar** → `createTask` del servicio de tareas (clave de idempotencia por recomendación) + fila `accepted` + evento
`recommendation.accepted`; **Posponer 3 días** → `snoozed`; **Descartar** (nota opcional) → `dismissed` + evento
`recommendation.dismissed`. Aceptar una huella que ya no aplica → conflicto, sin tarea.

## 9. «Ponme al día» (copiloto, dominio Ventas)

Herramienta `client_briefing` (`read`, permisos `leads.read_own|leads.read_all`, flag `ai_matching`), chip «Ponme al día
con este cliente» solo con una ficha de contacto o lead en pantalla (el registro amplió `requiresEntity` a una lista).
Hechos con origen: perfil (confirmado/sugerido + origen), nivel y señales, consultas por propiedades (leads visibles),
próxima visita y visitas realizadas con informe confirmado (alcance de Agenda; próximos pasos/objeciones como datos no
confiables), descartes con motivo, tareas pendientes (alcance de Tareas) y 2 siguientes acciones. Sin clave: datos
directos; con clave: el modo Analista redacta separando hechos de interpretación (Fase 1).

## Privacidad

- El texto del concierge y las preguntas **no se guardan** (ni en `ai_interactions`, ni en eventos, ni en logs). En la
  pestaña queda la última interpretación (`sessionStorage`); al enviar una consulta viajan solo los filtros (sin
  `evidence`).
- Eventos sin PII; vínculo solo al enviar consulta; DNT/GPC respetado en navegador y servidor.
- Perfil con campos cerrados; notas solo del equipo con aviso de no registrar datos sensibles.
- Al modelo: `redactForModel` + `<datos_no_confiables>`; nunca teléfonos, emails, documentos ni dirección oculta.

## Flags y settings

| Clave | Default | Qué controla |
| --- | --- | --- |
| `ai_concierge` | encendido | concierge en home y listados; evento `concierge_searched` |
| `ai_property_qa` | encendido | «Preguntale a esta propiedad»; evento `property_qa_asked` |
| `site_compare` | encendido | comparador, botones y barra; evento `property_compared` |
| `ai_matching` | encendido | perfil, compatibles, señales, siguiente acción, resumen del lead, «Ponme al día», jobs de match y calificación, vínculo de sesión y eventos de propiedad |
| `ai.public.daily_budget_usd` | 1 | presupuesto diario de la IA del sitio (dentro de `ai.daily_budget_usd`) |
| `ai.public.requests_per_ip_per_hour` | 30 | límite por IP y función (clave con hash) |
| `ai.matching.budget_tolerance_pct` | 10 | tolerancia del presupuesto |
| `ai.matching.min_score` | 55 | puntaje mínimo listado |
| `ai.matching.notify_agents` | true | avisos del match inverso |

**Apagar**: CRM → Integraciones → Feature flags (auditado, invalida el sitio al instante). Apagados, el sitio y el CRM
quedan como antes de la Fase 2 (las tablas quedan, sin uso).

## Eventos

| Evento | Emisor | Payload (sin PII) |
| --- | --- | --- |
| `lead.qualified` | job `sales_qualify_lead` | contactId, suggested, aiUsed, recommendations |
| `match.candidates_computed` | job `sales_match_property` | trigger, candidates, newCandidates, stale, algorithmVersion |
| `recommendation.created` | job de calificación | rule, priority, contactId, leadId |
| `recommendation.accepted` | acción del equipo | rule, contactId, entityType, taskId |
| `recommendation.dismissed` | descartar / posponer | rule, contactId, snoozed, until |

Ninguna automatización escucha estos eventos (test): no hay loops. Los jobs reaccionan a eventos de negocio
existentes (`lead.created`, `property.published`, `property.price_changed`).

## Métricas y observabilidad

- `ai_interactions` (página «Uso de IA»): `public.concierge`, `public.property_qa`, `public.compare_summary`,
  `sales.lead_qualification` con capa (`deterministic`/`anthropic`), estado, `fallback_reason`, guardas, latencia y costo.
- `site_events`: uso del concierge (con/sin filtros, capa), preguntas por tema y si estaban registradas (fichas a
  completar), comparaciones, vistas y aperturas de formulario.
- Logs: `sales.concierge_guard_blocked`, `sales.concierge_call_failed`, `sales.property_qa_guard_blocked`,
  `sales.compare_guard_blocked`, `sales.lead_extract_failed`, `site.lead_context_failed`.

## Tests

Unitarios: `sales-intent` (parser con casos reales), `sales-matching`, `sales-nba-signals`. Integración:
`ai-sales-site` (concierge con catálogo real, IA falsa validada, guardas, proveedor caído, presupuesto y límite públicos,
Q&A registrado/no registrado/dirección oculta/inyección, comparador, allowlist sin PII, vínculo solo al enviar, DNT) y
`ai-sales-crm` (perfil y RBAC/otra organización, compatibles, match inverso idempotente sin contacto, automatización sin
loops, siguiente acción aceptar/posponer/descartar, calificación con y sin IA, «Ponme al día», memoria de cliente). E2E:
`sales.spec.ts` (1440) y `sales.mobile.spec.ts` (390) con axe y consola limpia.

## Verificación final (2026-09-17, rama `feat/ai-sales`)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos |
| `pnpm typecheck` | OK |
| `pnpm db:codegen:verify` | OK (tipos al día con 0510–0511) |
| `pnpm test` | **59 archivos, 588 tests OK** (línea base 54 / 522: +5 archivos, +66 tests) |
| `pnpm build` | OK; `/` sigue estática con ISR, fichas ISR, `/propiedades/comparar` dinámica |
| `E2E_PORT=3115 E2E_DB=llf_e2e_sales E2E_TEMPLATE_DB=llf_dev_sales bash scripts/e2e.sh` | **41/41** (3 nuevos: sitio 1440, CRM 1440, sitio 390; axe sin violaciones serias en lo nuevo, consola limpia). En una corrida intermedia falló `tour.spec.ts › demo 1440` por el «Failed to fetch» del beacon del tour ya documentado en la Fase 1; aislado y en la corrida final pasa |
| Lighthouse mobile `/` después (3 corridas) | Performance 92 / 92 / 96 · a11y 100 · BP 100 · LCP 3,37 / 3,37 / 2,78 s (misma distribución bimodal que la línea base: 3,37 / 2,71 / 2,71) · TBT ≤ 5 ms · CLS 0 · JS 168 KB (+3 KB) |
| Lighthouse mobile ficha después | Performance 96 / 92 / 94 · a11y 100 · BP 100 · LCP 2,71 / 3,36 / 3,14 s · TBT 4 ms · CLS 0 (una primera medición dio 0,026 por el botón «Comparar» montado al hidratar: se reservó su lugar) · JS 185 KB (+7 KB) |

Lo nuevo del sitio son islas cliente chicas sin librerías: el formulario del concierge funciona sin JS, «Preguntale a esta
propiedad» monta su contenido recién al hidratar dentro de un `<details>` cerrado y los botones «Comparar» no existen sin
JS (lugar reservado). La analítica usa `sendBeacon`.
