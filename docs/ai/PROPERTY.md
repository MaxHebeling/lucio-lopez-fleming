# AI Property (Fase 3) + IA de visitas (Fase 4b)

Rama `feat/ai-property` (base `main` @ `3cca8d7`). Construye sobre el AI Core de la Fase 1 (docs/ai/AI_CORE.md) sin
crear otro núcleo. IA de visitas: docs/ai/VISITS_AI.md. Staging virtual (solo arquitectura): docs/ai/VIRTUAL_STAGING.md.
Guías del equipo: `knowledge/property-quality.md`, `marketing-director.md`, `tour-guide-and-owners.md`, `visits-ai.md`.

## Línea base (antes de tocar código, 2026-09-17)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos (8,3 s) |
| `pnpm typecheck` | OK (11,2 s) |
| `pnpm test` | **54 archivos, 522 tests OK** (unit + integración contra Postgres local `llf_test_property`, 49 s) |
| `pnpm build` | OK (16,3 s). First Load JS sin comprimir: `/` 539.322 B · `/propiedades/[slug]` 541.542 B · `/crm/propiedades/[id]` 533.830 B · `/crm/mis-visitas/[id]` 539.508 B |
| Lighthouse home `/` (build de producción local, base `llf_dev_property`, Chrome for Testing 1243, 3 corridas) | Mobile: rendimiento 95 / 92 / 92 (LCP 2,95–3,38 s, TBT ≤ 8 ms, CLS 0), accesibilidad 100, buenas prácticas 100, SEO 69 (`APP_ENV=development` ⇒ `noindex`). Desktop: 100 / 100 / 100 (LCP 0,66–0,82 s, TBT 0, CLS 0) |

## Arquitectura

```
 eventos property.* ──automatizaciones ai_quality_*──▶ enqueue_property_quality ──▶ job ai.property_quality ──▶ property_quality_reports
 tarea diaria ai.property_quality_nightly ─────────────────────────────────────────▶      (solo fotos stored: property_media_analysis)
 ficha CRM: «Calidad de la publicación» · Multimedia: «Director de fotos» · «Marketing» · listado: filtro/orden por calidad
 /crm/propiedades/inventario (análisis) · /crm/imprimir/propiedad/[id] (ficha imprimible)
 copiloto: property_quality, low_quality_properties (read)
 sitio: tour 360° «Preguntá» (guide.ts en el chunk diferido del tour; /api/site/tour-guide solo intención con IA)
        home «Quiero vender mi propiedad» paso a paso (mismo submitLeadAction) · /api/site/propietarios/fotos (S3 + flag)
```

Todo lo que usa un modelo pasa por `src/server/ai/run-task.ts`: proveedor del AI Core (`getAnthropicProvider` →
`client.ts` con timeout, reintentos y circuit breaker), ruteo por tarea (`modelFor`), prompt versionado del registro,
salida estructurada (`provider.extract` + zod), presupuesto diario compartido, verificación de negocio (`verify`, que
descarta la salida) y registro en `ai_interactions` sin prompts. Sin clave devuelve `{ ok: false }` y cada función usa su
capa determinista. El proveedor falso existe solo en tests (`setTaskProviderForTests`).

## 1. Property Quality AI

- **Reglas puras**: `src/server/ai/property/quality-rules.ts` (versión `2026-09-17.1`). Amplía el score de la Fase 1
  (`domains/property-completeness.ts` queda igual para `property_completeness`).
- **Pesos** (suman 100; lo que no aplica al tipo cuenta como cumplido): portada 10 · 5+ fotos 8 · fachada/exterior
  etiquetada 5 · plano 6 (no terrenos) · tour 360° publicado 4 (residenciales) · descripción 200+ 12 · precio 12 ·
  ubicación 8 · calle 3 · coordenadas 3 · superficies 8 · dormitorios 5 y baños 3 (residenciales) · orientación 3
  (residenciales y terrenos) · 3+ características 4 · agente responsable 6.
- **Penalizaciones** con tope: inconsistencia 5 (máx. 15) · foto repetida 3 (máx. 9) · foto oscura o borrosa 2 (máx. 10).
- **Detecciones**: faltantes (error si está publicada y falta precio/ubicación/portada), dormitorios ≥ ambientes,
  cubierta > total, terreno < cubierta en casas (no si `floors ≥ 2`; lenguaje «puede ser correcto…»), precio por m²
  < 0,5× o > 2× la mediana **solo con ≥ 8 comparables** (mismo tipo, operación, moneda y localidad, disponibles o
  reservadas; «No es una tasación»), descripción en mayúsculas o sin datos que sí están cargados, fotos repetidas,
  oscuras, borrosas y externas no analizadas. Settings: `ai.property_quality.price_min_sample`, `price_low_factor`,
  `price_high_factor`, `max_media_per_run`.
- **Links a la sección exacta**: `#multimedia`, `#precios`, `#agentes`, editor del tour y `/editar#campo` (el
  formulario enfoca el campo al abrir con ancla).
- **Job** `ai.property_quality` idempotente por `input_hash` (datos + comparables + métricas + versiones): sin cambios
  no escribe ni emite. Evento `property.quality_computed` `{ score, previousScore, rulesVersion, findings }`. Dedupe del
  job por evento (`event:<id>`), nocturno por día y reencolado si quedaron fotos sin analizar por el tope de la corrida.
- **Nunca modifica** propiedades, operaciones ni multimedia (test compara filas antes/después).

### Fotos (`image-metrics.ts` con sharp; reglas puras en `image-rules.ts`)

| Métrica | Cómo | Umbral (calibrado) |
| --- | --- | --- |
| Repetidas | dHash 8×8 (64 bits) | Hamming ≤ 5 (re-encodeada/achicada: 0–3; escenas distintas: > 12) |
| Oscura | luminancia media y p95 a 256 px | media < 60 **y** p95 < 110 (normales: media 100–141, p95 184–197; al 25 %: 25–35 / 46–49) |
| Borrosa | varianza del Laplaciano (`sharp.convolve`, 16 bits) ÷ varianza de luminancia, a 512 px | cociente < 0,04 (nítidas reales 0,32–1,88; σ=1: 0,05–0,32 no se marca; σ=2: 0,007–0,037). Imagen casi uniforme (varianza < 25) no se evalúa. No depende de la exposición |

Solo se analizan medios `stored` con archivo en nuestro storage (el optimizado webp). `source_only` / `verified`
(CDN de Adinco) **no se descargan** («no analizada: foto externa»; test con storage espía).

## 2. AI Photo Director

- `property_media_rooms`: etiqueta vigente (`manual` | `ai_accepted` con confianza) y sugerencia pendiente
  (`suggested_*`, `suggestion_status`, `suggestion_checksum` para no volver a pedir visión de la misma imagen).
- **Manual siempre** (selector «Ambiente» por foto, auditado `PROPERTY_MEDIA_ROOM_SET`).
- **Con clave**: job `ai.photo_tags` (a pedido, «Sugerir ambientes con IA»): miniaturas de 512 px desde nuestro storage,
  lotes de 6, hasta `ai.photo_director.vision_batch_size` por corrida, tarea `vision`, prompt `photo.room_tags`; solo
  escribe sugerencias (nunca pisa una etiqueta). Evento `media.tags_suggested`. Aceptar/descartar auditado.
- **Orden y portada sugeridos** (`photo-order.ts`, reglas explicadas en la UI): portada = primera sana por preferencia
  fachada → living → exterior → jardín → piscina → cocina → comedor → dormitorio; luego una por ambiente en orden de
  recorrido; al final planos, oscuras/borrosas y repetidas. «Aplicar orden sugerido» exige confirmación, recalcula en el
  servidor (conflicto si cambió), actualiza orden y portada en una transacción con `PROPERTY_MEDIA_SUGGESTED_ORDER_APPLIED`
  (antes/después + motivos) y `property.updated`. Nunca borra.

## 3. Staging virtual

Solo arquitectura: docs/ai/VIRTUAL_STAGING.md.

## 4. AI Marketing Director

- **Canales**: SEO del sitio, Instagram, Facebook, WhatsApp, email, guion de Reel. Instagram/Facebook → `social_posts`
  (`draft`, `template_key` `ai_director_*`, fotos verificadas) y el flujo de revisión/aprobación/publicación existente
  (publicación automática sigue apagada). El resto → `property_marketing_drafts` (un borrador abierto por canal,
  `source_hash` idempotente, editado por una persona = `human`, nunca se pisa).
- **Plantillas deterministas**: `content_templates` `ai_director_{instagram,facebook,whatsapp,email}` (editables) +
  `marketing-templates.ts` (SEO ≤ 60/155 y Reel con escenas solo de ambientes etiquetados). Solo datos reales; la
  descripción se cita resumida y, si esa cita trae cifras no respaldadas por campos, se quita (`safeTemplateDrafts`).
- **Con clave**: prompt `marketing.director` (tarea `answer`) con datos delimitados y sin dirección oculta; guardas
  `marketing-guards.ts`: cifras/códigos/links contra campos estructurados (precio oculto no se habilita; la descripción no
  cuenta como evidencia) + **atributos no registrados** (pileta, vista, cochera, parrilla, jardín, galería, balcón,
  terraza, seguridad, amenities, ascensor, luminoso, a estrenar, crédito, mascotas, financiación, escritura,
  orientación) y **superlativos** (increíble, espectacular, excelente, única…) salvo que consten. Violación → plantilla
  con aviso, `fallback_reason = guard_blocked`.
- **SEO a la ficha**: «Aplicar a la ficha» con confirmación, `marketing.create` + `properties.update`, vía
  `updateProperty` (auditado) + `MARKETING_SEO_APPLIED`.
- **Ficha imprimible**: `/crm/imprimir/propiedad/[id]` (HTML + CSS de impresión A4, marca LLF, datos públicos: dirección
  sin altura si está oculta, «Consultar», sin propietarios/notas/documentos). Sin librería PDF nueva.
- **Evento** `marketing.draft_created` `{ generatedBy, created, updated, channels }`.

### Análisis de inventario (`/crm/propiedades/inventario`)

Publicadas: días publicada, leads y visitas desde la publicación, calidad. Oportunidad con `ai.inventory.min_days_published`
(30) y `ai.inventory.low_leads_threshold` (2): «47 días publicada · pocas consultas (1) · revisar: hero, precio,
descripción, calidad visual. No indica la causa…»; qué revisar sale de evidencia del informe. Mediana solo con ≥ 10.
Leads solo con `leads.read_all`. **Vistas de página**: `registerInventorySignals({ pageViews })` (una línea desde la rama
de analítica); sin fuente la columna no aparece; con fuente se suma «N vistas» (test).

## 5. Guía IA del Tour 360°

- `src/server/tours/guide.ts` (puro, dentro del chunk diferido del tour): sinónimos por concepto con grupos de
  preferencia (jardín → galería/exterior, pileta → piscina, suite → dormitorio principal…), parser de intención
  (navegar / dato / desconocido), BFS sobre hotspots de escenas publicadas, descripción con artículos («Desde el Living
  podés ir a la Galería y luego a la Piscina»), botón «Ir a…» que recorre paso a paso con la transición existente
  (espera a que se muestre cada escena), datos solo de hotspots `info` y datos públicos de la ficha (`buildTourFacts`),
  «No está registrado…» + «Consultar al asesor» (CTA real del tour).
- **Con clave**: solo si la pregunta no se entiende, `POST /api/site/tour-guide` → prompt `tour.intent` (tarea
  `classify`) → intención validada contra escenas publicadas y temas conocidos; nunca redacta la respuesta. Mismo origen,
  cuerpo ≤ 1 KB, rate limit 20/10 min por IP (hash), flag y presupuesto.
- **Accesible**: botón en la barra de herramientas, `Sheet` con foco, `label`, respuesta `role=status aria-live`,
  teclado (Enter pregunta, Escape cierra), reduced motion sin demora entre pasos.
- **Analítica**: sin ampliar la allowlist; la navegación de la guía registra `virtual_tour_scene_viewed` con
  `source: "list"` y el CTA `virtual_tour_cta_clicked` `visit`.
- Flag `ai_tour_guide` (encendido). La caché del sitio usa claves `v2` por el campo nuevo.

## 6. Owner AI — captación paso a paso

`OwnerCaptureSteps` (flag `owner_capture_steps`): ubicación (+ vender/alquilar) → tipo → superficie → dormitorios →
estado → fotos (solo si `owner_capture_photos` y storage S3 configurado) → contacto. Mismo `submitLeadAction` →
`submitPublicLead` → lead `sell_my_property` con honeypot, rate limit, idempotencia y validación en servidor (campos
nuevos opcionales `ownerAreaM2`, `ownerBedrooms`, `ownerCondition`, `photoTokens`). Sin JS se ve el formulario completo.
«No damos valores automáticos: un asesor te va a contactar para una tasación profesional.»

Fotos: `/api/site/propietarios/fotos` (mismo origen, ≤ 4 MB, 12/10 min por IP, firma real, sharp webp ≤ 1600 px sin
EXIF, bucket **privado**, token aleatorio con solo su SHA-256 en base), canje al lead (`lead_attachments`), acceso en
`/api/files` para quien ve todos los leads o el agente asignado, purga horaria de no canjeadas a las 24 h.

## 7. IA de visitas (4b)

Ver docs/ai/VISITS_AI.md.

## Modelo de datos (migraciones 0520–0521)

| Tabla | Clave | Notas |
| --- | --- | --- |
| `property_quality_reports` | `property_id` | score, completitud, criterios/hallazgos jsonb con límites de tamaño, `input_hash`, `rules_version` |
| `property_media_analysis` | `media_id` | `file_id`, checksum, versión del algoritmo, dHash, luminancia (media, p95, ratio oscuro), varianzas |
| `property_media_rooms` | `media_id` | etiqueta + sugerencia con checks de coherencia |
| `property_marketing_drafts` | `id` | un borrador abierto por (propiedad, canal); applied/discarded con marcas |
| `visit_ai_outputs` | (`appointment_id`, `kind`) | brief, report_proposal, thanks_draft con hash |
| `owner_capture_uploads`, `lead_attachments` | `id` | subidas anónimas con token hash y vencimiento; vínculo a lead |

`ai_interactions.purpose` pasa de lista a formato (`^[a-z][a-z_]{1,39}$`) para que las fases no se pisen al mergear.

## Flags

| Flag | Estado | Qué |
| --- | --- | --- |
| `ai_property_quality` | encendido (nuevo en 0521; `ai_property_qa` es de la Fase 2) | calidad, filtro, copiloto, inventario |
| `ai_photo_director` | encendido | etiquetas, sugerencias (con clave), orden sugerido |
| `ai_marketing_director` | encendido | borradores y ficha imprimible |
| `ai_tour_guide` | encendido | «Preguntá» en el tour |
| `owner_capture_steps` | encendido | captación paso a paso |
| `owner_capture_photos` | **apagado** | paso de fotos (requiere S3) |
| `ai_visit_brief` | encendido (0521, una vez) | brief |
| `ai_followup` | encendido (0521, una vez) | seguimiento sugerido; con clave, informe y agradecimiento |

Los flags de 0501 se encienden solo si su descripción sigue siendo «no construido todavía»: un administrador puede
apagarlos después sin que una migración los vuelva a prender.

## Eventos

`property.quality_computed`, `media.tags_suggested`, `marketing.draft_created`, `visit.brief_prepared`,
`visit.report_structured`: solo ids, contadores y versiones; dedupe por hash; ninguna automatización los escucha.

## Tests

Unit: `ai-property-images` (sintéticas), `ai-property-quality-rules`, `ai-property-marketing` (plantillas + guardas +
inventario), `tours-guide`, `ai-visits-rules`. Integración: `ai-property-quality` (jobs, eventos, source_only, RBAC,
orden auditado, visión falsa), `ai-property-marketing`, `ai-property-site` (captación, fotos, guía con IA), `ai-visits`.
E2E: `ai-property.spec.ts` (1440), `ai-property.mobile.spec.ts` (390), `site.spec.ts` (captación paso a paso).

## Verificación final (tras mergear `origin/main` @622cc98, IA Fase 2)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos |
| `pnpm typecheck` | OK |
| `pnpm db:codegen:verify` | OK (tipos al día con 0510–0511 + 0520–0521) |
| `pnpm test` | **68 archivos, 676 tests OK** (línea base: 54 / 522; incluye los de la Fase 2) |
| `pnpm build` | OK |
| E2E completo (`E2E_PORT=3117 E2E_DB=llf_e2e_property E2E_TEMPLATE_DB=llf_dev_property bash scripts/e2e.sh`) | **47/47 OK**, dos corridas consecutivas |

Estabilización previa al verde: la captación paso a paso enfocaba el título del paso (o el primer campo inválido) en el
frame siguiente aunque la persona ya hubiera pasado a otro campo; ahora `focusLater` solo enfoca si nadie movió el foco
(el texto tipeado rápido ya no cae en «Teléfono»). El axe de la prueba 390 se acota a `#vender` (la portada completa la
revisa `mobile.spec.ts` en reposo; al hacer scroll las animaciones de entrada daban contraste falso a mitad del fundido).

**Rendimiento, antes/después con el mismo método** (build de producción local, base `llf_dev_property`,
Chrome for Testing 151, Lighthouse 13, mediana de 3 corridas; «antes» = `origin/main` @622cc98, «después» = esta rama):

| Página | Mobile antes → después | Desktop antes → después | JS de carga inicial (gzip) |
| --- | --- | --- | --- |
| `/` | 90 → 92 (LCP 3,64 → 3,37 s; TBT 5 ms; CLS 0) | 100 → 100 | 195,1 → 196,0 KiB (+0,9: captación paso a paso) |
| `/propiedades` | 90 → 91 | 100 → 100 | 191,4 → 191,4 KiB |
| `/propiedades/[slug]` | 93 → 93 | 100 → 100 | 196,2 → 196,3 KiB (la guía del tour vive en el chunk diferido del tour) |

Accesibilidad y buenas prácticas 100 en todas; SEO 69 en ambas por `APP_ENV=development` (`noindex`). Las diferencias
mobile de ±2 puntos están dentro del ruido de LCP entre corridas.
