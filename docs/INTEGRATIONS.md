# Integraciones

Estado a 2026-09-16. Regla general: **sin credenciales no hay envío ni publicación simulada**. Cada integración queda en
`awaiting_credentials` (visible en `integrations`, en `/crm/publicaciones` y en el registro de cada mensaje/publicación)
hasta configurarse. Todas las llamadas pasan por `callIntegration()` (circuit breaker + `integration_logs`), con timeout y
reintentos solo para errores reintentables (408/425/429/5xx, red, timeout).

| Integración | Estado real | Código | Flag |
| --- | --- | --- | --- |
| Email (Resend) | Lista, esperando credenciales | `src/server/integrations/email/resend.ts`, `src/server/messaging/*` | `outbound_email` |
| WhatsApp (plantillas) | Depende del equipo WhatsApp | `src/server/messaging/whatsapp-bridge.ts` | `outbound_whatsapp` |
| Mercado Libre Inmuebles | API pública; lista, esperando credenciales | `src/server/integrations/portals/mercadolibre/` | `portal_sync` |
| Argenprop | **Sin API pública** (acuerdo comercial) | `src/server/integrations/portals/agreement-only.ts` | `portal_sync` |
| Zonaprop | **Sin API pública** (acuerdo comercial) | `src/server/integrations/portals/agreement-only.ts` | `portal_sync` |
| Facebook / Instagram (Meta) | Lista, esperando credenciales | `src/server/integrations/meta/graph.ts`, `src/server/marketing/*` | `social_drafts`, `social_publishing` |
| Copia de multimedia | Lista (requiere storage S3 público) | `src/server/media/copy.ts` | `media_copy` |

Jobs y tareas registrados (en `src/server/jobs/handlers.ts`):

| Job | Disparo | Qué hace |
| --- | --- | --- |
| `messaging.send` | `queueMessage()` | Envía un `outbound_messages` (email/WhatsApp) |
| `messaging.resume_awaiting` | cada hora | Reencola mensajes en `awaiting_credentials` de los últimos 7 días cuando ya hay credenciales/flag |
| `portals.sync` | acción `sync_publications` | Publica / actualiza / pausa una propiedad en un portal |
| `portals.resume` | cada hora | Reencola publicaciones `pending`/`awaiting_credentials` si el canal está habilitado y configurado |
| `social.publish` | al programar (run_at = hora elegida) | Publica un post aprobado |
| `social.dispatch` | cada hora | Red de seguridad: posts vencidos sin job vivo o interrumpidos |
| `media.copy` | cada hora (+ continuación si el lote se llena) | Copia fotos a storage propio |

Acciones de automatización nuevas: `sync_publications`, `create_social_drafts`, `notify_email_internal`.
Automatizaciones sembradas en `0351`: `property_portal_sync_published`, `property_portal_sync_unpublished`, `lead_internal_email`.

---

## 1. Email transaccional (Resend)

**Variables**: `RESEND_API_KEY`, `EMAIL_FROM` (remitente de un dominio verificado), `EMAIL_REPLY_TO` (opcional),
`EMAIL_INTERNAL_TO` (avisos internos, admite varias direcciones separadas por coma), `APP_URL` (links).

**Cómo obtener credenciales**
1. Crear cuenta en resend.com y agregar el dominio (p. ej. `luciolopezfleming.com.ar`).
2. Cargar los registros DNS (SPF, DKIM y, recomendado, DMARC) que indica Resend y esperar la verificación.
3. Crear una API key con permiso "Sending access" restringida a ese dominio.
4. Configurar las variables en Vercel (Production/Preview) y encender el flag `outbound_email`.

**API usada** (docs: https://resend.com/docs/api-reference/emails/send-email): `POST https://api.resend.com/emails`,
`Authorization: Bearer`, header `Idempotency-Key` (≤ 256 caracteres, válido 24 h) = `dedupe_key` del mensaje.
Respuesta `{ id }` → `provider_message_id`.

**Comportamiento**
- El worker bloquea la fila, decide y pasa a `sending` antes de llamar (nunca HTTP dentro de una transacción).
  Ya `sent`/`delivered`/`cancelled` → no reenvía. Un `sending` de menos de 5 min → se reintenta luego.
- Sin credenciales o flag apagado → `awaiting_credentials` con el motivo. Nunca `sent`.
- Plantilla desconocida o payload inválido → `failed` + error permanente (no se reintenta).
- 429/5xx → `failed` y reintento de la cola con backoff; otros 4xx → `failed` permanente.
- Los datos de un solo uso (`resetUrl`, `inviteUrl`, `token` y los `sensitiveKeys` de cada plantilla) se redactan cuando el
  mensaje sale de la cola: enviado, fallido sin reintento (error permanente o job muerto) o cancelado. Un fallo reintentable
  conserva el link para el próximo intento. La tarea horaria cancela y redacta los que vencieron (`expiresAt`) o siguen sin
  credenciales pasados los 7 días de la ventana de reanudación.
- Si el payload trae `expiresAt` y venció antes de enviarse → `cancelled` (no se manda un link vencido).

**Plantillas** (`src/server/messaging/templates.ts`) — contrato de payload para quienes encolan:

| Clave | Payload |
| --- | --- |
| `password_reset` | `fullName`, `resetUrl` (path o URL de APP_URL), `expiresMinutes?`, `expiresAt?` |
| `owner_password_reset` | ídem |
| `staff_invite` | `fullName`, `inviteUrl`, `invitedBy?`, `expiresHours?`, `expiresAt?` |
| `owner_invite` | `fullName`, `inviteUrl`, `expiresHours?`, `expiresAt?` |
| `owner_report_ready` | `fullName`, `periodLabel`, `reportUrl` |
| `rent_due_reminder` | `recipientName`, `propertyLabel`, `dueDate` (YYYY-MM-DD), `amount` (saldo pendiente de la cuota), `currency` (ARS/USD), `periodLabel?` |
| `lead_internal_notice` | `leadPath` (`/crm/leads/<uuid>`), `contactName?`, `sourceName?`, `propertyLabel?`, `message?` |

**WhatsApp**: las plantillas con parámetros están en `WHATSAPP_TEMPLATES` (mismo payload de negocio + `whatsappTemplate`
`{ name, bodyParameters }`). Antes de enviar, el worker recalcula los parámetros con `renderWhatsApp` y exige que coincidan con
lo guardado; payload inválido → `failed` permanente, sin llamar a Meta. La plantilla aprobada en Meta debe respetar el orden:

| Plantilla | Parámetros del cuerpo |
| --- | --- |
| `rent_due_reminder` | {{1}} nombre, {{2}} propiedad, {{3}} vencimiento ("10 de octubre de 2026"), {{4}} importe pendiente ("$ 350.000") |

Todo contenido dinámico se escapa; los links solo pueden apuntar al origen de `APP_URL` (otro origen → error permanente).
El aviso interno de leads no incluye teléfono ni email del contacto.

**Cómo verificar**: con credenciales de prueba, encolar un mensaje (`queueMessage`) a una casilla propia, correr
`pnpm jobs:run` y revisar `outbound_messages.status = 'sent'`, `integration_logs` y el panel de Resend.

**Límites y riesgos**: límites de envío del plan de Resend (429 → reintento). Reputación del dominio: sin DMARC/SPF/DKIM
los emails van a spam. El `Idempotency-Key` protege 24 h: un reintento manual más tarde de un mensaje `failed` podría
duplicar si el primer envío en realidad salió.

## 2. WhatsApp (plantillas salientes)

La cola `messaging.send` delega en `sendWhatsAppTemplate`, que implementa el equipo de WhatsApp en
`src/server/integrations/whatsapp/`. Contrato (`src/server/messaging/whatsapp-bridge.ts`):

```ts
registerWhatsAppTemplateSender(sendWhatsAppTemplate);
// (db, { messageId, to, templateKey, payload, dedupeKey }) =>
//   { status: "sent", providerMessageId } | { status: "awaiting_credentials", reason }
// Fallas transitorias: lanzar RetryableError/TimeoutError. Rechazos definitivos: otro Error.
```

El módulo debe importarse en `src/server/jobs/handlers.ts`. Mientras no esté registrado, los WhatsApp quedan en
`awaiting_credentials` con el error "el módulo sendWhatsAppTemplate … no está registrado". `messaging.resume_awaiting`
los reencola cuando el sender existe y `outbound_whatsapp` está encendido.

## 3. Portales inmobiliarios

Interfaz: `PortalAdapter` (`src/server/integrations/portals/types.ts`) con `prepare` (mapeo **puro**), `publish`, `update`,
`remove`, `getStatus` y resultados tipados (`awaiting_credentials` / `invalid_data` / `transient`).

**Sincronización** (`src/server/integrations/portals/sync.ts`)
- `property.updated`, `property.published`, `property.unpublished` → acción `sync_publications` → job `portals.sync`
  por propiedad+canal (dedupe por evento). Flag `portal_sync` apagado → no se encola nada.
- El job reclama la fila (`syncing`, lease 15 min), arma el payload y compara `last_payload_hash`: sin cambios no llama.
- Con `external_id` **siempre actualiza** (nunca crea otro aviso). Despublicar **pausa** el aviso y conserva `external_id`.
- Estados: `pending`, `syncing`, `synced`, `failed` (dato inválido o intentos agotados), `retrying` (backoff de la cola),
  `awaiting_credentials`, `disabled` (canal deshabilitado).
- **El dato del CRM nunca se revierte**: el adaptador solo lee.
- `/crm/publicaciones` (permiso `publications.manage`): estado por canal y propiedad, errores, reintento manual
  (auditado `PUBLICATION_SYNC_RETRY`) y habilitar/deshabilitar canal (auditado `PUBLICATION_CHANNEL_ENABLED/DISABLED`).
  Deshabilitar un canal **no borra** avisos ya publicados en el portal.

### 3.1 Mercado Libre Inmuebles — API pública

Fuentes (consultadas 2026-09): developers.mercadolibre.com.ar — "Autenticación y Autorización", "Guía para inmuebles":
Categorías, Atributos, Publica Inmuebles, Actualiza tus publicaciones; árbol público `GET /categories/MLA1459`.

**Variables**: `MERCADOLIBRE_CLIENT_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REFRESH_TOKEN` (arranque),
`MERCADOLIBRE_LISTING_TYPE` (por defecto `silver`), `MERCADOLIBRE_CONTACT_WHATSAPP` (E.164 `+549…`),
`INTEGRATIONS_ENCRYPTION_KEY` (32 bytes base64, `openssl rand -base64 32`).

**Cómo obtener credenciales**
1. Con la cuenta de Mercado Libre de la inmobiliaria (cuenta principal, no colaborador), crear una aplicación en
   developers.mercadolibre.com.ar → "Mis aplicaciones". Scopes: `read`, `write`, `offline_access`. Registrar un
   `redirect_uri` fijo (https).
2. Autorizar: abrir `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=APP_ID&redirect_uri=…`,
   obtener el `code` y cambiarlo por tokens con `POST https://api.mercadolibre.com/oauth/token`
   (`grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`). Guardar el `refresh_token`
   en `MERCADOLIBRE_REFRESH_TOKEN`. (Este paso es manual y único; no hay endpoint de callback en la app todavía.)
3. Contratar el paquete de publicación de inmuebles que corresponda y configurar `MERCADOLIBRE_LISTING_TYPE` acorde.
4. Vincular ubicaciones: por cada localidad/barrio usado, insertar en `external_refs`
   `(source='mercadolibre', external_type='neighborhood'|'city', external_id=<id de /classified_locations>, entity_type='location', entity_id=<locations.id>)`.
   Se toma el vínculo más específico de la cadena de ubicación. Sin vínculo → `failed` con ese mensaje.
5. Habilitar el canal en `/crm/publicaciones` y encender `portal_sync`.

**Tokens**: el access token dura 6 h; el refresh token es **de un solo uso** y cada renovación devuelve uno nuevo. Por eso
se guardan cifrados (AES-256-GCM) en `integration_credentials`; la renovación se serializa con advisory lock. Si se carga
un `MERCADOLIBRE_REFRESH_TOKEN` distinto, se usa ese (reautorización). `invalid_grant` → `awaiting_credentials`
("volver a autorizar"). Cambiar `INTEGRATIONS_ENCRYPTION_KEY` invalida lo guardado (hay que reautorizar).

**Mapeo** (`mercadolibre/mapping.ts`, testeado): tipo → categoría de tipo (casa MLA1466, departamento MLA1472, PH MLA105179,
terreno/lote MLA1493, local MLA79242, oficina MLA50538, depósito/galpón MLA1475, campo MLA1496, cochera MLA50541,
hotel/negocio especial/otro MLA1892; **emprendimiento no se sincroniza**: requiere paquetes de desarrollos). La operación
(Venta/Alquiler/Alquiler Temporario) y el subtipo "Propiedades Individuales" se resuelven en runtime con `GET /categories/{id}`.
Una sola operación por aviso: venta > alquiler > temporario. Precio obligatorio (precio oculto → `failed`).
Atributos: `ROOMS`, `BEDROOMS`, `FULL_BATHROOMS`, `PARKING_LOTS`, `COVERED_AREA`, `TOTAL_AREA`, `MAINTENANCE_FEE`,
`IS_SUITABLE_FOR_PETS` solo si el dato existe. Los atributos obligatorios de la categoría final se validan contra
`GET /categories/{id}/attributes`; `OPERATION`, `PROPERTY_TYPE` y `OPERATION_SUBTYPE` se completan solo si el valor existe
literalmente en la lista permitida. Si falta algo (p. ej. "Amoblado") → `failed` nombrando el dato: **no se inventan valores**.
Dirección oculta → sin número ni coordenadas. Fotos: portada primero, hasta 30, solo URLs públicas https.
`seller_contact` completo con `country_code2`/`phone2` (obligatorios desde 2026-10-01).

**Cómo verificar**: con un usuario de prueba de Mercado Libre, publicar una propiedad de prueba, correr `pnpm jobs:run`,
revisar `property_publications` (`external_id`, `external_url`) e `integration_logs`; editar un dato → debe haber un PUT y
ningún POST nuevo.

**Límites y riesgos**
- Rate limit (429 → reintento con backoff). Cambios de atributos obligatorios por categoría (se detectan en runtime).
- Si el POST /items se concreta pero la base no llega a guardar `external_id` (corte exacto en ese instante), un
  reintento podría crear un segundo aviso. Ventana mínima; verificar en Mercado Libre ante errores de base.
- El aviso pausado no se cierra: cerrarlo es irreversible y queda como decisión manual.
- Paquetes/costos de publicación dependen del contrato de la inmobiliaria.

### 3.2 Argenprop — sin API pública

Relevamiento: argenprop.com/publicar/inmobiliaria no publica API ni feed. CRMs integrados (p. ej. 2clics, base de
conocimiento "¿Cómo configurar Argenprop?") indican que la integración la habilita el equipo de Argenprop, que entrega
credenciales propias (usuario, contraseña, IdVendedor, IdOrigen) tras enviar datos de la inmobiliaria (razón social,
CUIT, dirección, contacto), y que **al solicitar la integración se dan de baja los avisos activos cargados a mano**.
La especificación técnica no es pública. Nota: el sitio actual (Adinco) es un producto asociado a Argenprop.

**Estado**: adaptador con la interfaz, ficha normalizada testeada (`buildListingSheet`) y `awaiting_credentials` fijo.
**No se llama a ningún endpoint ni se inventan formatos.** Para activarlo: acuerdo comercial + especificación oficial →
implementar `publish/update/remove/getStatus` y sus variables.

### 3.3 Zonaprop — sin API pública

Relevamiento: Zonaprop (grupo Navent) publica vía CRMs integradores; las credenciales las otorga el ejecutivo de cuenta y
la API de integradores no tiene documentación pública (su centro de ayuda menciona cuentas "integradas a un CRM").
**Estado** y **pasos**: iguales a Argenprop.

## 4. Contenido y redes (Meta)

**Borradores** (`src/server/marketing/drafts.ts`): `property.published` → `create_social_drafts` crea un post por
evento y canal (índice único `source_event_id+channel`), `generated_by='template'`, con copy de `content_templates`
(sembradas en `0351`) y fotos verificadas (`verified`/`stored`: portada + hasta 9). Flag `social_drafts`.
El copy usa solo datos reales: tipo, operación, localidad, ambientes/dormitorios/baños/superficie si existen, precio solo si
no está oculto, código, link público `APP_URL/propiedades/<slug>`, nombre y año de fundación de la organización.
Una línea de la plantilla cuyos marcadores quedan vacíos se omite. Variante con IA: **no implementada** (sin
`ANTHROPIC_API_KEY` la regla es solo plantilla; queda pendiente coordinar con el equipo de IA).

**Aprobación humana**: la tabla tiene `CHECK` (no hay `approved/scheduled/publishing/published` sin `approved_by`).
`/crm/marketing` (permisos `marketing.read/create/approve`): cola por estado, vista previa, editar texto (contador y
límite de Instagram), elegir/ordenar fotos (máx. 10), aprobar, rechazar con motivo, programar fecha/hora de Salta y
cancelar programación. Editar un post aprobado/programado lo vuelve a borrador. Todo auditado (`SOCIAL_POST_*`).

**Publicador** (`src/server/marketing/publish.ts`, flag `social_publishing`)

**Variables**: `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, `META_GRAPH_VERSION` (por defecto `v26.0`).

**Cómo obtener credenciales**
1. Página de Facebook de la inmobiliaria y cuenta de Instagram profesional vinculada a esa Página.
2. App en developers.facebook.com (tipo Business) con Facebook Login; permisos `pages_manage_posts`,
   `pages_read_engagement`, `instagram_basic`, `instagram_content_publish` (y `business_management` si la Página está en
   un Business Manager). Pasar **App Review** + **Business Verification** y poner la app en modo Live: en modo desarrollo
   los posts solo los ve el administrador.
3. Obtener un token de usuario de larga duración, luego el **Page access token** (`GET /me/accounts`), y el id de IG
   (`GET /{page-id}?fields=instagram_business_account`).
4. Configurar variables, `STORAGE_DRIVER=s3` con `STORAGE_PUBLIC_BASE_URL` https, y encender `social_publishing`.

**API usada** (developers.facebook.com, Pages API y Instagram Content Publishing):
- Facebook 1 foto: `POST /{page-id}/photos` (`url`, `caption`). Varias: cada una `published=false`, luego
  `POST /{page-id}/feed` con `message` y `attached_media[i]={"media_fbid":…}`.
- Instagram: `POST /{ig-user-id}/media` (`image_url`, `caption`); carrusel con hijos `is_carousel_item=true` y padre
  `media_type=CAROUSEL` + `children` (≤ 10); `GET /{container}?fields=status_code` hasta `FINISHED`;
  `POST /{ig-user-id}/media_publish` (`creation_id`). El token va en header `Authorization`, nunca en la URL.

**Imágenes**: Meta descarga URLs públicas https. Instagram acepta solo JPEG, ≤ 8 MB, proporción 4:5 a 1.91:1. Si la foto de
origen ya cumple y es pública se usa tal cual; si no, se genera un derivado JPEG (≤ 1440 px, sin EXIF, márgenes blancos si
la proporción no entra, sin recortar) en storage público, guardado en `social_assets.file_id`. Sin URL pública válida →
`failed` con "No hay URL pública válida para las imágenes…".

**Idempotencia**: con `external_post_id` no republica. Antes de llamar pasa a `publishing`. Si un proceso muere a mitad:
Instagram consulta el contenedor guardado (`external_container_id`) y, si ya está `PUBLISHED`, marca publicado sin volver a
publicar; Facebook queda `failed` pidiendo verificación humana (no se republica a ciegas). Sin credenciales el post sigue
`scheduled` con el motivo y se retoma cuando se configuren.

**Cómo verificar**: con la app en modo desarrollo y una Página de prueba, aprobar y programar un post a +2 minutos,
correr `pnpm jobs:run`, confirmar `status='published'` y `external_post_id`.

**Límites y riesgos**: Instagram 100 publicaciones por API cada 24 h; 2200 caracteres y 30 hashtags. Tokens de Página
pueden invalidarse (cambio de contraseña, rol) → error 190: regenerar. App Review puede demorar. El texto de redes lo
revisa y aprueba una persona: el sistema no agrega datos.

## 5. Copia de multimedia a storage propio

Job `media.copy` (flag `media_copy`), lotes de 8. Toma `property_media` imagen con `status in ('source_only','verified')`
y sin `file_id`; descarga (timeout 20 s, máx. 25 MB cortando el stream, solo hosts públicos http/https), valida la firma
real (JPEG/PNG/WebP/AVIF), normaliza con sharp (rotación EXIF, sin metadatos, WebP lado mayor ≤ 2400 px), sube a storage
**público**, crea `files`, setea `file_id` + `status='stored'`. No borra `source_url`.
Archivo inválido → `failed` sin reintentos. Fallas transitorias → `copy_attempts` (máx. 5, luego `failed`), con lease de
10 min por `last_checked_at`. Idempotente: la asignación final exige `file_id is null`; si otro proceso ganó, se borra el
objeto subido.

**Requisitos**: `STORAGE_DRIVER=s3` + bucket público + `STORAGE_PUBLIC_BASE_URL` (en local se escribe en `.storage/`).
**Riesgo**: consumo de storage/egreso; conviene activar el flag y observar los primeros lotes.

## 6. Operación

- `pnpm jobs:run` ejecuta una pasada del worker en local (usa `--conditions=react-server` para poder importar módulos
  `server-only`).
- Encender integraciones = variables + flag (tabla `feature_flags`) + canal habilitado (portales).
- Errores y latencias: `integration_logs`; estado agregado: `integrations`; jobs muertos notifican a administración.
