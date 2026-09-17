# Tours virtuales 360°

Módulo real de recorridos 360° para fichas de propiedades, con editor en el CRM, analítica propia y una demo pública
sobre una propiedad **ficticia** (`/demo/tour-360`). Guía para quien captura las imágenes: `docs/TOUR_360_CAPTURE_GUIDE.md`.

## 1. Arquitectura

```
public/tours/demo/residencia/          assets estáticos de la demo (manifest.json, 9 panorámicas, previews, miniaturas, plano.svg, cover.jpg)
scripts/seed-demo-tour.ts              pnpm seed:demo-tour → carga/actualiza la demo desde el manifiesto (idempotente)
scripts/tours/demo-placeholders.ts     genera placeholders válidos desde el manifiesto (no pisa archivos sin --force)

src/server/tours/
  model.ts         puro (servidor y navegador): tipos del DTO, ángulos, allowlist de embeds, validación para publicar,
                   recorrido guiado, pestañas de medios
  manifest.ts      Zod del manifiesto (2:1, slugs, destinos, ángulos, guiado)
  media.ts         panorámicas y planos con sharp sobre el storage existente; estado del storage; URLs públicas
  service.ts       mutaciones del CRM (permiso → zod → transacción → auditoría → evento virtual_tour.*)
  queries.ts       DTO público (ficha y demo, con flag) y datos del editor
  upload.ts        subida (por el servidor o directa a S3) de panorámica/plano
  demo-seed.ts     seed de la demo
src/server/site/events.ts              analítica first-party (allowlist, rate limit, retención)
src/app/api/site/events/route.ts       POST de eventos
src/app/api/crm/propiedades/[id]/tour/subida(/intent|/complete)   subidas del editor
src/app/(site)/demo/tour-360/page.tsx  demo pública
src/app/crm/(panel)/propiedades/[id]/tour/                         editor del CRM (página, acciones, cliente)

src/components/site/property/PropertyMediaSection.tsx  React.lazy de las pestañas (0 KB de tour en fichas sin tour)
src/components/site/property/PropertyMediaTabs.tsx     [Fotos] [Tour 360°] [Plano] [Video]
src/components/site/tour/TourLauncher.tsx              portada + carga del tour por intención (hover/foco/toque) o al entrar
src/components/site/tour/TourExperience.tsx            capa inmersiva (diálogo) — chunk diferido
src/components/site/tour/PanoramaViewer.tsx            wrapper de Photo Sphere Viewer — chunk diferido
src/components/site/tour/FloorPlan.tsx                 plano con «Estás aquí» (sitio y editor)
src/components/site/tour/track.ts                      track() con sendBeacon / fetch keepalive
```

Flujo público: ficha (ISR) → `getSitePropertyMediaExtras(code)` (caché con etiqueta `site:properties`, incluye el flag)
→ si hay tour publicado, pestañas + portada → clic en «Entrar al tour 360°» → `import()` de `TourExperience` (que a su
vez importa PSV/three) → capa a pantalla completa.

Flujo CRM: editor → server actions / rutas de subida → servicios → `virtual_tour.*` en `domain_events` +
`revalidatePublicSiteInRequest()` en la misma petición; la automatización de sistema `site_revalidate_tour_*` cubre
cambios fuera de la UI (seed, scripts).

## 2. Librería: Photo Sphere Viewer 5

Versiones fijadas: `@photo-sphere-viewer/core`, `markers-plugin`, `gyroscope-plugin` **5.15.1**; `three` **0.185.1**
(la que pide PSV).

Motivo: mantenido activamente, ESM + TypeScript, hotspots como elementos HTML (botones reales: foco, Tab, lectores de
pantalla, CSS propio), transiciones en `setPanorama`, giroscopio con permiso a pedido y `stereo-plugin` disponible para
VR. Pannellum y Marzipano están prácticamente sin mantenimiento. No se usa `VirtualTourPlugin`: la navegación (escena
actual, historial, modo guiado) vive en estado de React y el visor solo muestra `setPanorama(url, { position, transition })`
+ `MarkersPlugin`.

Nunca en el bundle inicial: la ficha carga `PropertyMediaSection` (React.lazy); PSV y three viven en el chunk de
`TourExperience`/`PanoramaViewer`, que se pide al pasar el puntero, enfocar o tocar el botón, o al entrar.

## 3. Modelo de datos

Migraciones: `0170_virtual_tours.sql` (CRM), `0171_virtual_tours_reference_data.sql` (flag + automatizaciones),
`0420_site_events.sql` (sitio público).

| Tabla | Claves e integridad |
| --- | --- |
| `properties.is_demo` | `properties_demo_never_published`: `check (not (is_demo and is_published))` |
| `virtual_tours` | `property_id` único (un tour por propiedad; "sin tour" = sin fila). `kind` internal/external, `status` draft/published (+ `published_at`). Externo exige `provider` + `external_url` https; interno no admite proveedor ni URLs externas. `cover_*`, `floor_plan_*` como URL estática (`/tours/...`) o `file_id` del storage. `start_scene_id` con FK compuesta a una escena **del mismo tour** (`on delete set null`). `guided_scene_ids uuid[]` (≤ 60). `is_demo` igual al de la propiedad (trigger). |
| `virtual_tour_scenes` | `slug` único por tour; panorámica/preview/miniatura como URL estática o archivo; `width`/`height` 2:1 ±1 % (check); `initial_yaw ∈ (−π, π]`, `initial_pitch ∈ [−π/2, π/2]`; `is_published`; `plan_x/plan_y ∈ [0,1]` (ambos o ninguno) |
| `virtual_tour_hotspots` | `kind` scene/info/cta; `target_scene_id` obligatorio solo en scene (check), distinto de la propia escena, del mismo tour (trigger); yaw/pitch en rango; borrar la escena destino borra el punto |
| `site_events` | `bigint identity`, sin FK (append-only de alto volumen). `name` con allowlist en un check, `session_key` aleatoria, `tour_id`, `scene_id`/`scene_slug`, `hotspot_id`, `property_id`, `props jsonb` ≤ 1 KB, `occurred_at`. **Sin IP, user agent ni datos personales.** Índices por (tour, evento, fecha), (tour, escena) y fecha |

URLs de assets: función `is_tour_asset_url()` (solo `/tours/...` o `https://host/...`, sin `..`, con `?v=<hash>` opcional).

## 4. Propiedad demo y aislamiento

- Slug fijo `residencia-demo-360`, título «RESIDENCIA DEMO 360°», borrador, sin dirección, sin precio, sin fotos propias,
  sin asesor, descripción que aclara que es ficticia. Su tour es interno y publicado, pero solo se ve en `/demo/tour-360`.
- **Nunca se publica**: constraint en la base + `publishBlockers` + servicio. No se duplica, no tiene publicaciones por
  canal (portales), no genera eventos `property.*` (no dispara redes, portales ni automatizaciones comerciales) y el
  importador no la toca (solo trabaja sobre `external_refs`).
- Excluida explícitamente (además del constraint) en: `publishedWhere` y consultas del home (`public.ts`,
  `public-home.ts`), API v1 por código, herramientas de la IA de WhatsApp, tablero del CRM (conteos), buscador de
  propiedades para vincular leads/oportunidades/agenda/contratos (`crm/lookups.ts`), captura de leads por código,
  contratos, oportunidades y agenda. Tests: `tests/integration/virtual-tours.test.ts` («propiedad demo»).
- En el CRM aparece con insignia **DEMO**, sin «Publicar», «Duplicar» ni portales; el editor del tour es de solo lectura.
- `/demo/tour-360`: `noindex, nofollow` (meta y `X-Robots-Tag`), fuera del sitemap, leyenda «DEMO INTERACTIVA — PROPIEDAD
  FICTICIA» y aclaración de renders 3D. Los CTA no crean leads: explican el flujo y llevan a `/propiedades` y `/contacto`.

## 5. Experiencia pública

- **Pestañas** solo con tour publicado (y flag encendido). Sin tour, la ficha es exactamente la de antes (test e2e).
  Orden: Fotos (si hay), Tour 360°, Plano (planos cargados o plano del tour), Video (si hay). La galería y todo el
  contenido indexable (texto, JSON-LD) no cambian.
- **Portada**: foto (cover del tour o portada de la propiedad), «Viví la propiedad antes de visitarla.», titular y
  «Entrar al tour 360°». Al entrar la foto escala (~560 ms), la UI se retira y la capa inmersiva arranca con la misma
  imagen, que se funde cuando la primera vista está lista.
- **Capa inmersiva**: `role="dialog"`, foco atrapado, Escape (cierra primero el panel abierto), «× Salir del tour»,
  `history.pushState` (atrás cierra), vuelve a la ficha en su scroll, foco de regreso al botón. Pantalla completa real
  opcional si existe `requestFullscreen`.
- **Visor**: arrastre, zoom acotado (FOV 35–95°), flechas y + / − (se desactivan con un panel abierto o al escribir).
  Carga progresiva preview → panorámica. Precarga solo de los destinos de la escena actual, en idle, y solo previews con
  `saveData` o 2G/3G. Transición fundido + desenfoque leve (~420 ms); con `prefers-reduced-motion`, sin animaciones.
- **Hotspots**: botones HTML (44 px), etiqueta en hover/foco (siempre visible en touch). scene navega, info abre tarjeta,
  cta abre «Agendar visita».
- **Ambientes**: barra inferior con miniaturas (scroll-snap en mobile) + lista textual («Ambientes»).
- **Plano**: panel con el plano como imagen (nunca SVG en el DOM), botones por ambiente, «Estás aquí»,
  «PLANO DEMOSTRATIVO» en la demo.
- **Modos**: explorar (por defecto) y recorrido guiado (Anterior / Siguiente / Salir del recorrido, «n de N»).
- **CTA**: «¿Te interesa esta propiedad?» → «Agendar visita» abre el `LeadForm` real de visita (mismo flujo, sin
  duplicar lógica) y «Consultar por WhatsApp» con `whatsappHref` del asesor/propiedad (si no hay número no aparece).
  Compartir reutiliza `ShareButton`.
- **Giroscopio**: botón «Mover con el teléfono» solo en touch con sensor; el permiso se pide recién al tocarlo.
- **Fallback**: sin WebGL → lista de ambientes con miniaturas + plano; error de carga → Reintentar, Volver a la escena
  anterior, Ver fotos, Cerrar tour.
- **Tour externo**: iframe solo con host permitido (ver §8); si no, botón «Abrir en {proveedor}» a pestaña nueva.

## 6. CRM

Ficha del CRM → sección «Tour virtual 360°» (SIN TOUR / BORRADOR / PUBLICADO) → `/crm/propiedades/[id]/tour`:

1. **Crear**: propio o externo (proveedor, URL, URL de inserción; muestra si se va a insertar o abrir aparte).
2. **Escenas**: nombre + panorámica (JPG/PNG/WebP/AVIF, 2:1 ±1 %, ≥ 2048 px, ≤ 15 MB). El servidor quita EXIF/GPS, limita
   a 8192×4096, genera preview 512×256 y miniatura 640×400. Con S3 la subida va directa al bucket (URL firmada) y se
   procesa después (sin el límite de body de la plataforma). **Sin storage configurado** (hoy en producción faltan las
   claves S3): aviso y subida deshabilitada; el servicio también lo rechaza antes de procesar.
3. Orden, escena inicial, ocultar/publicar escena, borrar (borra sus puntos y los que llevan a ella).
4. **Visor del editor** (el mismo componente PSV): «Usar vista actual como vista inicial»; «+ Hotspot» se ubica en el
   centro de la vista (cruz); clic en un punto para editar, «Mover al centro de la vista», borrar.
5. **Plano**: imagen raster (SVG no se acepta: no hay sanitización confiable) y clic para ubicar la escena elegida.
6. **Recorrido guiado**: escenas incluidas y orden.
7. **Previsualizar**: `TourExperience` con los datos en borrador (sin analítica), solo para el equipo.
8. **Publicar** con validaciones (`tourPublishBlockers`): ≥ 1 escena publicada, escena inicial publicada, destinos
   existentes y publicados, guiado sin escenas ocultas. Si la propiedad no está publicada se avisa (no se ve en el sitio).
   Un tour publicado no se puede dejar incompleto con una edición.

Permisos: editar = `properties.manage_media` (agente, marketing, administración); publicar/despublicar y borrar un
tour publicado = `properties.publish`. Auditoría `VIRTUAL_TOUR_*` (entidad `virtual_tour`, `metadata.propertyId`).

## 7. Feature flag

`virtual_tours` (0171, encendido). Apagado: la ficha no muestra pestañas, `/demo/tour-360` responde 404 y
`/api/site/events` no guarda nada. Cambiarlo desde Integraciones invalida la caché del sitio en la misma petición (el
resto de instancias lo ve al vencer la caché de flags, 15 s).

## 8. Seguridad

- **Embeds**: `EMBED_HOSTS` en `model.ts` — Matterport `my.matterport.com`, Kuula `kuula.co`, 3DVista Cloud
  `storage.net-fs.com` (dominio de hosting documentado por 3DVista). Host exacto, https, sin credenciales ni puertos
  raros; `other` nunca se inserta. iframe con `sandbox="allow-scripts allow-same-origin allow-popups
  allow-popups-to-escape-sandbox allow-presentation"`, `allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"`,
  `referrerpolicy="strict-origin-when-cross-origin"`, `loading="lazy"`. Validación en servidor (Zod + checks SQL) y tests
  con `javascript:`, `data:`, http, `kuula.co.evil.com`, subdominios y credenciales.
- **CSP** (`next.config.ts`): `frame-src` suma solo esos hosts; `connect-src` suma el origen de
  `STORAGE_PUBLIC_BASE_URL` (PSV descarga las panorámicas con fetch → blob). Texturas vía `blob:` ya permitidas en
  `img-src`. El e2e verifica que no haya violaciones de CSP ni errores de consola.
- **Archivos**: firma real, tamaño, píxeles máximos antes de decodificar, sin EXIF/GPS, objetos públicos con clave UUID.
- **Analítica**: sin PII (ver §9); mismo origen; límite de 2 KB.

## 9. Analítica

Eventos (allowlist): `virtual_tour_opened` (`entry`), `virtual_tour_scene_viewed` (`source`: start/hotspot/bar/list/plan/
guided/history), `virtual_tour_hotspot_clicked` (`kind`), `virtual_tour_floorplan_opened`, `virtual_tour_guided_started`,
`virtual_tour_cta_clicked` (`cta`: visit/whatsapp/properties/contact), `virtual_tour_closed` (`durationMs`,
`scenesViewed`). Cliente: `track()` con `navigator.sendBeacon` (fallback `fetch keepalive`), respeta Do Not Track y
Global Privacy Control, nunca rompe la UI. Servidor: Zod, propiedades desconocidas descartadas, solo tours publicados
visibles, rate limit por IP (clave con hash) y por sesión, DNT/`Sec-GPC` también en servidor, retención 13 meses
(tarea diaria `site.events_purge`). La vista previa del CRM no registra eventos.

Consultas (reemplazar `:tour` por el id del tour y ajustar el rango):

```sql
-- ¿Cuántos abrieron el tour? (sesiones únicas por día)
select date_trunc('day', occurred_at) as dia, count(distinct session_key) as sesiones
from site_events where tour_id = :tour and name = 'virtual_tour_opened'
group by 1 order by 1;

-- Tiempo de permanencia (mediana y promedio, en segundos)
select percentile_cont(0.5) within group (order by (props->>'durationMs')::bigint) / 1000 as mediana_s,
       avg((props->>'durationMs')::bigint) / 1000 as promedio_s
from site_events where tour_id = :tour and name = 'virtual_tour_closed' and props ? 'durationMs';

-- Ambientes más vistos (sesiones distintas por escena)
select scene_slug, count(distinct session_key) as sesiones
from site_events where tour_id = :tour and name = 'virtual_tour_scene_viewed'
group by scene_slug order by sesiones desc;

-- ¿Cuántos llegaron al jardín? (en la demo: galería o piscina; en otra propiedad, los slugs de exterior)
select count(distinct session_key) as sesiones
from site_events where tour_id = :tour and name = 'virtual_tour_scene_viewed' and scene_slug in ('galeria', 'piscina');

-- ¿Cuántos pulsaron «Agendar visita»? (y cuántos lo hicieron sobre el total de aperturas)
select count(distinct session_key) filter (where name = 'virtual_tour_cta_clicked' and props->>'cta' = 'visit') as agendar,
       count(distinct session_key) filter (where name = 'virtual_tour_opened') as aperturas
from site_events where tour_id = :tour;
```

(Las cinco consultas se ejecutan en `tests/integration/site-events.test.ts`.) Los leads que efectivamente se enviaron
desde el formulario de visita están en `leads` (fuente `web_property`, prioridad alta).

## 10. Performance

- Ficha sin tour: sin código del tour (e2e verifica que ningún chunk cargado contiene PSV). JS inicial medido con el
  build de producción: 615,8 KiB → 616,3 KiB sin comprimir (191,9 → 192,4 KiB gzip) por el envoltorio de carga diferida.
- PSV + three: un chunk diferido (~634 KiB sin comprimir) solo al abrir el tour.
- Panorámicas: preview 512×256 (≈ 5 KB) primero; JPEG progresivo ≤ 8192 px; caché de PSV limitada a 8 archivos;
  precarga solo de vecinos en idle y nunca con ahorro de datos.
- Assets de la demo con `?v=<hash>` (seed): se pueden servir con caché larga y cambian al reemplazar archivos.

## 11. Accesibilidad

Diálogo con foco atrapado y retorno de foco, Escape, pestañas con flechas/Inicio/Fin, hotspots como botones con
`aria-label` (incluyen el destino), áreas táctiles ≥ 44 px, lista textual de ambientes, plano navegable con teclado
(`aria-current="location"`), anuncios `aria-live` al cambiar de ambiente o paso guiado, `prefers-reduced-motion`,
axe sin violaciones serias en la demo (1440 y 390) y con el tour abierto.

## 12. Limitaciones conocidas

- Headless/CI: WebGL con SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`); el render real en
  dispositivos se valida a mano.
- Los hotspots se ubican en el centro de la vista (no arrastrando); para ajustar: apuntar y «Mover al centro de la vista».
- Planos subidos solo raster; el plano SVG de la demo es un archivo del repo (no de usuarios).
- No se guarda el original de la panorámica (se guarda la versión ≤ 8192 px): conservar los originales del fotógrafo.
- 15 MB por archivo (mismo límite que las fotos). Panorámicas de 8K en JPG calidad 85–90 suelen entrar.
- Giroscopio: iOS exige HTTPS y permiso explícito; algunos Android no exponen el sensor al navegador.
- Un tour por propiedad.

## 13. Extensiones futuras (no implementadas)

- **Matterport API / SDK**: importar escenas y medidas del modelo en vez de solo insertar el iframe.
- **VR**: `@photo-sphere-viewer/stereo-plugin` + WebXR para cardboard/visores.
- **Video 360°** por escena (`equirectangular-video-adapter`).
- **Mediciones** sobre la panorámica (requiere calibración o datos de profundidad).
- **Multiidioma**: nombres de escenas y puntos por idioma (tabla de traducciones).
- Hotspots arrastrables en el editor y vista previa del plano con zoom.

## 14. Reemplazar las imágenes

### Demo (renders definitivos)

1. Copiar los archivos con **los mismos nombres** a `public/tours/demo/residencia/` (`{slug}-360.jpg` equirectangular 2:1,
   `{slug}-preview.jpg` 512×256, `{slug}-thumb.jpg` 640×400, `cover.jpg`, `plano.svg`).
2. Si cambia la resolución, actualizar `width`/`height` en `manifest.json` (el seed verifica que coincidan con el archivo).
   Si cambian los encuadres, ajustar `initialYaw`/`initialPitch`, `yaw`/`pitch` de los puntos y `plan`.
3. Ejecutar `pnpm seed:demo-tour` contra la base que corresponda (por defecto `DATABASE_URL`). Es idempotente: actualiza
   URLs (con el nuevo hash), escenas y puntos sin tocar código. Con el servidor en marcha y `APP_URL` + `CRON_SECRET`,
   invalida la caché del sitio al instante; si no, en ≤ 5 minutos.
4. Commit de los archivos y deploy (son estáticos del repo).

`pnpm exec tsx scripts/tours/demo-placeholders.ts` solo genera placeholders que falten (no pisa renders sin `--force`).

### Propiedad real

Desde el CRM: Propiedades → la ficha → «Tour virtual 360°» → subir las panorámicas del fotógrafo, ubicar puntos y plano,
previsualizar y publicar (paso a paso en `docs/TOUR_360_CAPTURE_GUIDE.md`, §10). Requiere el storage S3 configurado.
