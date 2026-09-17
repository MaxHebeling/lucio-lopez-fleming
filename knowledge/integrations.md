---
dominio: integrations
titulo: Integraciones y feature flags
resumen: Pantalla de Integraciones (estados, circuito en pausa, logs, feature flags), dónde se cargan las credenciales y qué pasa sin ellas en WhatsApp, IA, email, Meta, portales, BCRA y storage.
permisos: integrations.read
---

## Qué muestra la pantalla Integraciones
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

**Integraciones** (`/crm/integraciones`, menú Sistema) muestra el estado real de cada conexión externa del CRM. Sin credenciales, una integración queda en espera: el CRM nunca simula un envío o una respuesta. La ven Super Admin, Dirección, Administrador y Solo lectura (`integrations.read`).

Tiene tres tarjetas:
1. **Estado**: una fila por integración con **Integración** (nombre y categoría: Mensajería, Portales, Redes, Email, IA, Storage, Datos, Monitoreo), **Estado**, **Último OK** y **Último error** con su fecha.
2. **Feature flags**: interruptores que encienden o apagan funciones sin desplegar.
3. **Logs recientes**: las últimas llamadas a servicios externos.

Las integraciones listadas son: WhatsApp Business (Cloud API), Claude (IA), Email transaccional (Resend), Object storage (S3 compatible), Instagram / Facebook, Argenprop, Zonaprop, Mercado Libre Inmuebles, BCRA (índices ICL / CER), Adinco (sitio anterior, solo migración) y Sentry. Las que tienen problemas también aparecen en el bloque **Salud del sistema** del Tablero.

## Estados de una integración
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

En la columna **Estado** de `/crm/integraciones` cada integración muestra una etiqueta:

- **Activa**: la última llamada real funcionó.
- **Esperando credenciales**: faltan variables de configuración (claves, tokens). En **Último error** suele figurar cuáles, por ejemplo «Faltan variables de entorno: …». Tener la clave cargada no alcanza para pasar a Activa: pasa recién con la primera llamada exitosa.
- **Degradada**: estaba activa y empezó a fallar (errores de red, tiempos agotados, 5xx, credencial rechazada). Vuelve a **Activa** sola con la próxima llamada que funcione.
- **Con error** y **Desactivada**: existen como estados, pero hoy ningún proceso automático los asigna y el CRM no tiene un botón para desactivar una integración.

Debajo de la etiqueta pueden aparecer:
- «N fallas seguidas»: fallas consecutivas desde el último OK.
- **En pausa hasta …**: el circuito está abierto (ver «Integración en pausa por fallas repetidas»).

Los rechazos por datos (por ejemplo un portal que rechaza una propiedad por un campo faltante) se registran en los logs pero **no** degradan la integración: el proveedor funciona, el problema es el dato.

## Integración en pausa por fallas repetidas
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

Para no insistir contra un servicio caído, el CRM usa un «circuito»: después de **5 fallas seguidas** de una integración, la pone **en pausa durante 5 minutos**. En `/crm/integraciones` y en el Tablero se ve la etiqueta roja **En pausa hasta <hora>**.

Mientras está en pausa, las llamadas a esa integración no se hacen y los jobs que la usan fallan con «Integración … en pausa hasta … por fallas repetidas»; la cola los reintenta más tarde con espera creciente.

Qué hacer:
1. Mirá **Último error** en la tarjeta **Estado** para ver la causa (credencial vencida, cuota agotada, servicio caído).
2. Filtrá **Logs recientes** por esa integración y **Resultado: Error**.
3. Si es una credencial o cuota, avisá a quien administra las claves en Vercel.
4. Esperá: pasados los 5 minutos el circuito se reabre solo y la próxima llamada exitosa la deja **Activa**.

Hoy el CRM no tiene un botón para sacar una integración de la pausa antes de tiempo. Después de 3 fallas seguidas (umbral configurable por el equipo técnico) además se avisa a administración.

## Revisar los logs de llamadas a integraciones
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

La tarjeta **Logs recientes** de `/crm/integraciones` es el registro de llamadas a servicios externos.

1. En **Integración** elegí una (o **Todas**).
2. En **Resultado** elegí **Error**, **OK**, **Reintento**, **Omitido** o **Todos**.
3. Tocá **Filtrar**. **Limpiar** vuelve a la vista completa.

La tabla muestra las últimas 50 llamadas con **Fecha**, **Integración** (clave técnica, por ejemplo `whatsapp_cloud`, `anthropic`, `resend`, `mercadolibre`, `bcra`), **Operación** (qué se intentó, por ejemplo `messages.create` o `oauth.refresh`, y sobre qué entidad), **Resultado** (con el código HTTP y la duración en ms) y **Detalle** con el mensaje de error.

Si no hay coincidencias verás «Sin llamadas registradas para ese filtro». Los logs se conservan 90 días y después se borran solos. Los secretos (claves, tokens) nunca se guardan en los logs.

## Encender o apagar un feature flag
<!-- ruta: /crm/integraciones; permisos: integrations.manage -->

Los feature flags encienden o apagan funciones sin desplegar código. Verlos requiere `integrations.read`; cambiarlos, `integrations.manage` (Super Admin, Dirección o Administrador).

1. Entrá a **Integraciones** (`/crm/integraciones`), tarjeta **Feature flags**.
2. Buscá el flag por su clave (por ejemplo `outbound_email`). Al lado figura **Encendido** o **Apagado** y la descripción.
3. Tocá **Encender** o **Apagar**.
4. Confirmá el mensaje «¿Encender …?» o «¿Apagar …?». Mientras guarda muestra «Guardando…».

Qué tenés que saber:
- Cada cambio queda auditado como `FEATURE_FLAG_CHANGED` y el flag muestra «Último cambio: fecha por nombre».
- Tu instancia lo aplica al instante; las demás instancias del servidor lo toman en hasta 15 segundos.
- El sitio público se refresca al cambiar un flag (por ejemplo `virtual_tours`).
- Encender un flag de envío (`outbound_email`, `outbound_whatsapp`, `social_publishing`, `portal_sync`) sin las credenciales cargadas no envía nada: los elementos quedan en **Esperando credenciales**.

Con solo `integrations.read` (rol Solo lectura) ves los flags pero no los botones.

## Qué hace cada feature flag
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

Flags disponibles en `/crm/integraciones` y su valor de fábrica:

- `public_lead_capture` (encendido): los formularios del sitio crean leads en el CRM.
- `whatsapp_ai_bot` (apagado): la IA responde los WhatsApp entrantes. Requiere credenciales de WhatsApp y de Claude.
- `outbound_whatsapp` (apagado): envío real de WhatsApp; apagado, los mensajes quedan en cola.
- `outbound_email` (apagado): envío real de emails (invitaciones, recuperación de contraseña, avisos internos); apagado, quedan en cola.
- `portal_sync` (apagado): sincroniza propiedades con portales inmobiliarios.
- `social_drafts` (encendido): al publicar una propiedad se generan borradores de redes, que nunca se publican sin aprobación.
- `social_publishing` (apagado): publica en Instagram y Facebook los posts aprobados y programados.
- `owner_portal` (encendido): portal privado de propietarios.
- `rent_index_fetch` (encendido): descarga automática de ICL y CER desde el BCRA.
- `media_copy` (apagado): copia las fotos migradas a storage propio.
- `virtual_tours` (encendido): tours virtuales 360° en las fichas y la demo pública.

Un flag que no existe cuenta como apagado. El estado real puede diferir del valor de fábrica: el que vale es el que ves en pantalla.

## Dónde se cargan las credenciales de las integraciones
<!-- ruta: /crm/integraciones; permisos: integrations.read, integrations.manage -->

Hoy el CRM **no permite cargar ni ver claves desde pantalla**. Las credenciales (API keys, tokens, secretos) se cargan como **variables de entorno del proyecto en Vercel**, y lo hace un administrador con acceso a ese proyecto o el equipo técnico. Después hace falta un nuevo despliegue para que el servidor las tome.

Ejemplos de variables por integración:
- WhatsApp Business: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
- Claude (IA): `ANTHROPIC_API_KEY`.
- Email: `RESEND_API_KEY`, `EMAIL_FROM` y `EMAIL_INTERNAL_TO` para avisos internos.
- Instagram / Facebook: `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`.
- Mercado Libre: `MERCADOLIBRE_CLIENT_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REFRESH_TOKEN`, `INTEGRATIONS_ENCRYPTION_KEY`.
- Storage: `STORAGE_DRIVER`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` y afines.

Nunca pegues una clave en una nota, conversación, tarea o chat del CRM. En la pantalla de Integraciones solo se ve si una integración está configurada y funcionando, jamás el valor de la clave. Encender el flag correspondiente sí se hace desde el CRM.

## Qué pasa cuando falta una credencial
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

Regla general: **sin credenciales no hay envío ni publicación simulada**. Lo que depende de esa integración queda guardado y marcado, y se retoma solo cuando se configura.

- La integración pasa a **Esperando credenciales** en `/crm/integraciones`, con el detalle de qué falta en **Último error**.
- **Emails** (invitaciones, recuperos, avisos): quedan en espera. Cada hora el sistema reintenta los de los últimos 7 días si ya hay credenciales y flag; pasados 7 días se cancelan. Los que llevan un link con vencimiento (una invitación vence a las 72 horas) se cancelan al vencer.
- **WhatsApp**: el mensaje se guarda con el estado «Sin credenciales: no enviado». Cada hora se reencolan los de las últimas 24 horas; también se puede usar **Reintentar envío** en la conversación.
- **Asistente de IA**: las conversaciones se derivan a una persona («Asistente de IA sin credenciales»).
- **Portales**: la publicación queda **Esperando credenciales** en `/crm/publicaciones` y se retoma sola cada hora cuando el canal está habilitado y configurado.
- **Redes (Meta)**: el post programado sigue programado, con el motivo, hasta que haya credenciales.

Nada de esto cambia los datos del CRM: la propiedad, el lead o la conversación quedan intactos.

## WhatsApp Business: estados y qué revisar
<!-- ruta: /crm/conversaciones; permisos: conversations.read, integrations.read -->

La integración **WhatsApp Business (Cloud API)** usa la API oficial de Meta (no WhatsApp Web). Los mensajes entrantes llegan a **Conversaciones** (`/crm/conversaciones`) y las respuestas salen por la misma vía.

Arriba de las conversaciones el CRM muestra avisos honestos:
- «WhatsApp Business todavía no está conectado (faltan credenciales de Meta). Las respuestas quedan registradas pero no se envían.»
- «El envío real de WhatsApp está desactivado (flag outbound_whatsapp): las respuestas quedan en cola.»
- «WhatsApp está con fallas: algunos envíos pueden demorarse o fallar. Revisá Integraciones.»

Estados de un mensaje enviado: **En cola**, **Enviando**, **Enviado**, **Entregado**, **Leído**, **Falló** o **Sin credenciales: no enviado**. Con permiso `conversations.reply` aparece **Reintentar envío** en los fallidos o sin credenciales. Si el resultado fue incierto («Verificá en WhatsApp si llegó antes de reintentar») el botón dice **Verifiqué que no llegó: reenviar**: no lo toques sin chequear, para no duplicar el mensaje.

Pasadas 24 horas desde el último mensaje del cliente, WhatsApp solo permite una plantilla aprobada: botón **Enviar plantilla aprobada**, si está configurada.

## Asistente de IA (Claude) en WhatsApp
<!-- ruta: /crm/conversaciones; permisos: conversations.read, integrations.read -->

El asistente de IA responde consultas de WhatsApp usando solo datos reales de la base (propiedades publicadas). Necesita tres cosas:
1. La clave `ANTHROPIC_API_KEY`, que carga un administrador en las variables de entorno de Vercel, no en el CRM.
2. WhatsApp Business conectado.
3. El flag `whatsapp_ai_bot` encendido en `/crm/integraciones`.

Si falta algo, todo mensaje entrante lo atiende una persona. En Conversaciones verás «El asistente de IA está apagado: todos los mensajes entrantes los atiende una persona.» o «El asistente de IA no tiene credenciales: las conversaciones nuevas se derivan a una persona.». La integración **Claude (IA)** figura **Esperando credenciales** hasta la primera respuesta exitosa.

El asistente deriva a una persona (modo **Persona**) cuando el cliente lo pide, hay negociación, reserva o reclamo, tiene baja confianza, falla dos veces, recibe audios o fotos, o intenta dar un dato que no salió de la base. También deriva al agotarse el **presupuesto diario de IA** (5 USD por defecto, contado en hora de Salta): motivo «Presupuesto diario de IA agotado». Hoy el CRM no permite cambiar ese presupuesto desde pantalla. Las visitas que pide un cliente se crean como tarea para un asesor, nunca como cita confirmada.

## Email transaccional (Resend)
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

La integración **Email transaccional (Resend)** envía los emails del sistema:
- Invitaciones al equipo y a propietarios.
- Links de recuperación de contraseña.
- Aviso interno de lead nuevo (a la casilla interna configurada, sin teléfono ni email del contacto).
- Recordatorios de vencimiento a inquilinos e informes a propietarios.

Para que salgan hacen falta las variables `RESEND_API_KEY` y `EMAIL_FROM` en Vercel (con el dominio verificado en Resend) **y** el flag `outbound_email` encendido en `/crm/integraciones`.

Si falta algo, los emails quedan en espera con el motivo («Envío de email desactivado (feature flag outbound_email apagado)» o «Email sin configurar: …»). Al invitar a alguien, `/crm/usuarios/invitar` ya avisa que la invitación saldrá cuando se active el envío. Cada hora se reintentan los emails en espera de los últimos 7 días; los que tenían un link vencido se cancelan y hay que reenviarlos (por ejemplo, **Reenviar invitación** en la ficha del usuario).

Hoy el CRM no tiene una pantalla con la bandeja de emails enviados: el rastro está en **Jobs** (tipo `messaging.send`) y en **Logs recientes** filtrando por Resend.

## Instagram y Facebook (Meta)
<!-- ruta: /crm/marketing; permisos: marketing.read, integrations.read -->

La integración **Instagram / Facebook** publica los posts de redes aprobados.

Cómo funciona:
1. Al publicar una propiedad, si el flag `social_drafts` está encendido, se generan **borradores** para Instagram y Facebook con datos reales de la ficha.
2. En **Contenido** (`/crm/marketing`) una persona con permiso los revisa, edita, aprueba y programa. Nada se publica sin aprobación humana.
3. Si `social_publishing` está encendido y hay credenciales, a la hora programada se publica.

Requisitos que gestiona un administrador fuera del CRM: la Página de Facebook y la cuenta profesional de Instagram vinculada, una app de Meta aprobada y en modo Live (en modo desarrollo los posts solo los ve el administrador), el token de Página y el storage público para las fotos.

Sin credenciales, el post aprobado y programado sigue programado con el motivo visible y se publica cuando se configuren. Si una publicación queda con resultado incierto («verificá en Facebook/Instagram»), revisá la red antes de reintentar para no duplicarla.

## Mercado Libre Inmuebles
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

**Mercado Libre Inmuebles** es el único portal con API pública. La publicación se gestiona en **Portales** (`/crm/publicaciones`), con permiso `publications.manage` (Super Admin, Dirección, Administrador, Marketing).

Para que sincronice hacen falta:
1. Credenciales de la aplicación de Mercado Libre y la autorización de la cuenta de la inmobiliaria (las carga el equipo técnico en Vercel).
2. El canal **Habilitado** en `/crm/publicaciones`.
3. El flag `portal_sync` encendido; si está apagado la pantalla avisa «La sincronización automática está apagada (feature flag portal_sync)…».
4. La propiedad publicada, con precio visible y los datos que exige la categoría.

Estados por propiedad: **Pendiente**, **Sincronizando**, **Sincronizada**, **Con error**, **Reintentando**, **Esperando credenciales** y **Canal deshabilitado**. Si la columna **Detalle** dice «Mercado Libre rechazó…/volvé a autorizar», hay que reautorizar la cuenta (tarea técnica). Si dice «Resultado incierto: verificá en Mercado Libre…», revisá el portal antes de tocar **Reintentar**. Despublicar pausa el aviso; deshabilitar el canal no borra avisos ya publicados. Los datos del CRM nunca se modifican desde el portal.

## Argenprop y Zonaprop
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

**Argenprop** y **Zonaprop** no tienen API pública: la integración la habilita cada portal por acuerdo comercial, entregando credenciales y una especificación técnica propia. En `/crm/publicaciones` cada tarjeta lo aclara: «Sin API pública: la integración la habilita Argenprop por acuerdo comercial. Hasta entonces no se envía nada.» (y lo mismo para Zonaprop con Navent).

En la práctica, hoy:
- Las dos integraciones figuran **Esperando credenciales** en `/crm/integraciones`.
- Si habilitás el canal y publicás una propiedad, la publicación queda **Esperando credenciales**: no se llama a ningún servidor del portal ni se inventa un formato.
- Reintentar no cambia nada hasta que exista el acuerdo y se implemente la conexión.

Para activarlas hace falta que la inmobiliaria firme el acuerdo con cada portal y que el equipo técnico implemente la especificación que entreguen. Ojo: según lo relevado, al pedir la integración Argenprop da de baja los avisos cargados a mano; coordinalo antes.

## BCRA e índices de ajuste de alquileres
<!-- ruta: /crm/alquileres/indices; permisos: rentals.read -->

La integración **BCRA (índices ICL / CER)** usa la API pública del Banco Central, sin credenciales, y viene **Activa** de fábrica.

- Todos los días, desde las 06:00 de Salta, la tarea `rentals.fetch_indices` descarga **ICL** y **CER**, siempre que el flag `rent_index_fetch` esté encendido.
- En **Índices** (`/crm/alquileres/indices`, permiso `rentals.read`) se ven los valores y el estado de la conexión con el BCRA: **Operativa**, **Con fallas** o **Sin credenciales**, la etiqueta «Descarga diaria activa» o «Descarga diaria desactivada (flag rent_index_fetch)», **Última respuesta correcta**, **Último error**, **Fallas seguidas** y las últimas consultas.
- **IPC** y **Casa Propia** no vienen del BCRA: se cargan a mano con la variación mensual publicada, con permiso `rentals.adjust` (Super Admin, Dirección, Administrador, Alquileres). No se puede cargar un mes que todavía no empezó, y cada carga queda auditada.

Si el BCRA falla, la integración pasa a **Degradada** y, tras 5 fallas seguidas, queda en pausa 5 minutos; la tarea del día siguiente vuelve a intentar desde la última fecha cargada. Si ves valores faltantes, revisá **Logs recientes** filtrando por BCRA.

## Storage de fotos y archivos
<!-- ruta: /crm/integraciones; permisos: integrations.read -->

El **Object storage (S3 compatible)** guarda fotos, planos, documentos y archivos de tours. Los archivos públicos (fotos del sitio) se sirven desde un bucket público; los privados (documentos de contratos, identidad) salen con links firmados de corta duración o por una ruta que controla permisos.

La configuración (`STORAGE_DRIVER=s3`, endpoint, buckets y claves) la carga el equipo técnico en Vercel. Hoy el CRM no permite configurarlo desde pantalla. Importante: la fila de storage en `/crm/integraciones` no se actualiza sola, así que su estado **Esperando credenciales** no prueba que falte configurarlo. Lo mismo pasa con **Sentry** (monitoreo de errores).

Relacionado: el flag `media_copy` activa la copia de las fotos importadas del sitio anterior a storage propio, en lotes chicos cada hora (job `media.copy`). Necesita el storage S3 público configurado. Conviene encenderlo y mirar los primeros lotes en **Jobs** antes de dejarlo corriendo.

## Alertas cuando una integración falla
<!-- ruta: /crm/notificaciones; permisos: integrations.read, automations.read -->

Cuando una integración acumula **3 fallas seguidas** (umbral de fábrica), el sistema dispara el evento `integration.failed` y la automatización **Alerta de integración caída** manda el aviso «Integración con fallas» a los usuarios con rol Administrador y Super Admin. Mientras siga fallando, el aviso se repite como mucho una vez por hora.

Dónde lo ves:
1. En **Avisos** (`/crm/notificaciones`).
2. En el **Tablero**, bloque **Salud del sistema**, con el nombre de la integración, su estado y el último error.
3. En `/crm/integraciones`, columna **Estado** («N fallas seguidas», **Degradada**, **En pausa hasta …**).

Si además un job agotó sus intentos por esa falla, llega «Tarea automática fallida: <tipo>» con link a **Jobs**: una vez resuelta la causa, reintentalo desde ahí (`automations.manage`). Los rechazos por datos inválidos no cuentan como falla ni disparan la alerta. Si la automatización **Alerta de integración caída** está desactivada en `/crm/automatizaciones`, estos avisos no llegan.
