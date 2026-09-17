---
dominio: operations
titulo: Operación del sistema
resumen: Automatizaciones, cola de jobs, tareas programadas, auditoría, revisión de la migración desde el sitio anterior, avisos automáticos al equipo y qué pasa si el cron deja de correr.
permisos: automations.read, audit.read, migration.read
---

## Qué son las automatizaciones y cuáles vienen cargadas
<!-- ruta: /crm/automatizaciones; permisos: automations.read -->

Una automatización es una regla del tipo **EVENTO → CONDICIONES → ACCIONES**: cuando pasa algo en el CRM (se crea un lead, se publica una propiedad, un contrato está por vencer) el sistema ejecuta acciones solas, como mandar un aviso, crear una tarea o sincronizar portales. Se ven en **Automatizaciones** (`/crm/automatizaciones`, menú Sistema).

Vienen cargadas de fábrica, entre otras:
- **Aviso de lead nuevo + tarea de seguimiento**: avisa al agente asignado (o a administración) y crea una llamada de primer contacto a 2 horas.
- **Seguimiento posterior a visita**: tarea de seguimiento para el día siguiente.
- **Borradores de redes al publicar** y **Sincronizar portales** al publicar, despublicar o cambiar una propiedad.
- **Aviso de contrato por vencer**, **Recordatorio de vencimiento al inquilino** y **Propuesta de ajuste de alquiler**.
- **Alerta de integración caída** y **Aviso interno por email de lead nuevo**.
- Varias **Actualizar el sitio: …** que refrescan el sitio público cuando cambia una propiedad o un tour virtual.

Hoy el CRM no permite crear automatizaciones nuevas ni editar sus condiciones o acciones desde pantalla: solo verlas, activarlas y desactivarlas.

## Ver las condiciones y acciones de una automatización
<!-- ruta: /crm/automatizaciones; permisos: automations.read -->

Cada automatización aparece como una tarjeta en `/crm/automatizaciones` con:
- El nombre, la clave técnica y la versión (por ejemplo `lead_notify_and_followup · v1`).
- La etiqueta **Activa** o **Desactivada**.
- La descripción de lo que hace.
- Una línea con **Evento** (el disparador, p. ej. `lead.created`), **Últimos 7 días: N ejecuciones**, cuántas **con error** y **Última** (fecha de la última ejecución o «nunca»).

Para ver el detalle técnico:
1. Entrá a **Automatizaciones**.
2. En la tarjeta, abrí **Ver condiciones y acciones**.
3. Se despliegan dos bloques: **Condiciones** y **Acciones**, en formato JSON (por ejemplo una acción `notify` con el rol que recibe el aviso, o `create_task` con el vencimiento en minutos).

Las automatizaciones activas se listan primero. Con solo `automations.read` (por ejemplo el rol Solo lectura) ves todo esto pero no aparecen los botones para activar o desactivar.

## Activar o desactivar una automatización
<!-- ruta: /crm/automatizaciones; permisos: automations.manage -->

Necesitás el permiso `automations.manage` (Super Admin, Dirección o Administrador).

1. Entrá a **Automatizaciones** (`/crm/automatizaciones`).
2. En la tarjeta de la regla tocá **Desactivar** (si está activa) o **Activar** (si está desactivada).
3. Al desactivar aparece la confirmación «¿Desactivar "…"? Los eventos nuevos no la dispararán.»: aceptá.
4. Mientras guarda el botón muestra «Guardando…» y después la etiqueta cambia a **Desactivada** o **Activa**.

Qué tenés que saber:
- Desactivar no borra el historial de ejecuciones.
- Los eventos que ocurren mientras la regla está desactivada **no se recuperan** al reactivarla: por ejemplo, los leads que entraron en ese lapso no reciben el aviso ni la tarea automática. Revisalos a mano.
- Si ya había una ejecución encolada al momento de desactivar, queda **Omitida** (motivo: automatización desactivada).
- Cada cambio queda en la auditoría como `AUTOMATION_ENABLED` o `AUTOMATION_DISABLED`.

## Revisar las ejecuciones de las automatizaciones
<!-- ruta: /crm/automatizaciones; permisos: automations.read -->

Debajo de las tarjetas, en `/crm/automatizaciones`, está el historial de ejecuciones (corridas).

1. Por defecto se ve **Ejecuciones con error** (botón **Con error**).
2. Tocá **Todas** para ver **Últimas ejecuciones** (`/crm/automatizaciones?runs=todas`).
3. La tabla muestra hasta 50 filas con las columnas **Automatización**, **Evento** (tipo de evento y el registro que lo generó), **Estado**, **Error** e **Inicio**.

Estados posibles:
- **OK**: se ejecutaron todas las acciones.
- **Falló**: alguna acción dio error; el texto del error aparece en la columna **Error**. Si se reintentó, se ve «intento N».
- **Omitida**: no correspondía ejecutarla (condiciones no cumplidas o regla desactivada).
- **En curso**: se está ejecutando.

Si no hay fallas vas a ver «No hay ejecuciones con error.»; si nunca corrió nada, «Todavía no se ejecutó ninguna automatización.».

## Reintentar una automatización que falló
<!-- ruta: /crm/sistema/jobs; permisos: automations.manage -->

Las automatizaciones no se reintentan desde su propia pantalla: cada ejecución es un job `automation.run` en la cola, y se reintenta desde **Jobs**. Necesitás `automations.manage`.

1. En `/crm/automatizaciones`, vista **Con error**, tocá el link **Jobs** del texto «Los reintentos se hacen desde Jobs.». Te lleva a `/crm/sistema/jobs?status=dead&type=automation.run`.
2. Abrí el job (clic en el tipo) y leé **Último error** para entender la causa (dato faltante, credencial, integración caída).
3. Corregí la causa primero; si no, va a volver a fallar.
4. Tocá **Reintentar** en la fila o **Reintentar ahora** en el detalle.

El sistema ya lo intenta solo hasta 5 veces en total, con espera creciente, antes de dar el job por muerto. Reintentar es seguro: las acciones usan claves de deduplicación, así que no se duplican avisos ni tareas que ya se habían creado, y una ejecución que ya terminó bien no se vuelve a correr.

## Qué es la pantalla Jobs y qué significa cada estado
<!-- ruta: /crm/sistema/jobs; permisos: automations.read -->

**Jobs** (`/crm/sistema/jobs`, menú Sistema) es la cola de tareas en segundo plano: envíos de email y WhatsApp, sincronización con portales, publicación en redes, automatizaciones, descarga de índices y tareas de mantenimiento. La ven quienes tienen `automations.read`.

Arriba hay un botón por estado con la cantidad de jobs:
- **Muertos**: agotaron sus intentos, tuvieron un error permanente o el proceso no terminó a tiempo. No se reintentan solos. Es la vista que se abre por defecto.
- **Fallidos (reintentando)**: fallaron pero el sistema los va a volver a intentar; la columna **Actualizado** muestra «Próximo:» con la hora del próximo intento. La espera crece con cada intento (desde unos segundos hasta varias horas).
- **En cola**: esperando su turno.
- **En ejecución**: corriendo ahora.
- **Completados**: terminaron bien.
- **Cancelados**.

La tabla muestra **Tipo**, **Intentos** (hechos/máximo), **Último error** y **Actualizado**. Cuando un job muere, el sistema manda el aviso «Tarea automática fallida: <tipo>» a Administrador y Super Admin. Los jobs completados o cancelados se borran solos a los 30 días.

## Filtrar jobs y ver el detalle de un job
<!-- ruta: /crm/sistema/jobs/[id]; permisos: automations.read -->

Para encontrar un job puntual:
1. Entrá a **Jobs** (`/crm/sistema/jobs`) y elegí el estado (por ejemplo **Muertos**).
2. En **Tipo** elegí el tipo de job (por ejemplo `messaging.send` para emails, `portals.sync` para portales, `automation.run` para automatizaciones, `whatsapp.send_reply` para respuestas de WhatsApp) o dejá **Todos**.
3. Tocá **Filtrar**. Hay 50 jobs por página.
4. Hacé clic en el tipo de un job para abrir su detalle (`/crm/sistema/jobs/[id]`).

El detalle muestra en **Detalle**: Intentos, Prioridad, Timeout, Próxima ejecución, Creado, Iniciado, Finalizado, Clave de dedupe y Worker. Debajo aparecen **Último error** (si lo hay), **Payload** (los datos con los que se encoló) y **Resultado** (lo que devolvió al terminar). La miga de pan **Jobs** te devuelve a la lista con el mismo estado.

## Reintentar un job muerto o fallido
<!-- ruta: /crm/sistema/jobs; permisos: automations.manage -->

Necesitás `automations.manage` (Super Admin, Dirección o Administrador). Solo se pueden reintentar jobs **Muertos** o **Fallidos (reintentando)**.

1. Entrá a **Jobs** y elegí **Muertos** (o **Fallidos (reintentando)**).
2. Abrí el job y leé **Último error**.
3. Resolvé la causa: cargar la credencial que falta, corregir el dato de la propiedad o esperar a que la integración vuelva.
4. Tocá **Reintentar** en la fila, o **Reintentar ahora** en el detalle.

El job vuelve a **En cola** para correr de inmediato (en la próxima pasada del cron, como mucho un minuto) y se suma un intento si ya los había agotado. El reintento queda auditado como `JOB_RETRIED`.

Si aparece «Solo se reintentan jobs fallidos o muertos» o «No se pudo reintentar: el job cambió de estado», otro proceso ya lo tomó: refrescá la lista. Ojo con envíos de resultado incierto (WhatsApp, Mercado Libre, redes): verificá primero en el canal si el mensaje o el aviso ya salió.

## Qué tareas programadas corren solas
<!-- ruta: /crm/sistema/jobs; permisos: automations.read -->

El cron del sistema corre cada minuto y, además de procesar la cola, encola tareas periódicas. Las ves en **Jobs** filtrando por **Tipo**.

Diarias (una vez por día, a partir de las 06:00 de Salta):
- `system.housekeeping`: limpieza de sesiones vencidas, jobs viejos y registros de integraciones.
- `rentals.fetch_indices`: descarga ICL y CER del BCRA.
- `rentals.generate_obligations`, `rentals.mark_overdue`, `rentals.expiring_contracts`, `rentals.due_reminders` y `rentals.adjustments_due`: cuotas, vencidos, contratos por vencer, recordatorios y ajustes de alquiler.
- `site.events_purge`: limpieza de eventos del sitio.

Horarias:
- `messaging.resume_awaiting` y `whatsapp.flush_held`: reencolan mensajes que esperaban credenciales o flag.
- `portals.resume`: retoma sincronizaciones pendientes con portales.
- `social.dispatch`: publica posts programados que quedaron atrasados.
- `media.copy`: copia fotos a storage propio (si el flag está encendido).
- `reports.sync_delivery`, `tours.purge_deleted_files` y `properties.purge_public_media`.

Cada tarea diaria corre una sola vez por día aunque el cron pase muchas veces. Hoy el CRM no permite cambiar horarios ni agregar tareas desde pantalla.

## Qué registra la auditoría
<!-- ruta: /crm/auditoria; permisos: audit.read -->

**Auditoría** (`/crm/auditoria`) es el registro inmutable de las operaciones sensibles: quién, cuándo y qué cambió. Nadie puede editar ni borrar un registro, ni siquiera un Super Admin. La ven quienes tienen `audit.read` (Super Admin, Dirección, Administrador).

Se registran, entre otras:
- **Propiedades**: alta, edición, cambio de precio y de estado, publicación y despublicación, fotos, agentes y propietarios asignados, verificación de migradas.
- **Contactos, leads, oportunidades, agenda y tareas**: altas, cambios de estado, asignaciones, fusiones de contactos.
- **Conversaciones**: tomar, devolver al asistente, cerrar, responder, derivaciones y reintentos.
- **Alquileres**: contratos, cobros registrados y anulados, ajustes, liquidaciones, documentos.
- **Marketing**: aprobación, rechazo y programación de posts.
- **Usuarios y accesos**: invitaciones, cambios de roles y sucursales, desactivaciones, ingresos (`LOGIN`), cambios y restablecimientos de contraseña.
- **Sistema**: feature flags, automatizaciones activadas o desactivadas, jobs reintentados, advertencias de migración.

Cada registro guarda **Antes**, **Después**, metadatos, IP y request. Hoy la auditoría no registra consultas o lecturas (quién miró una ficha), solo cambios e ingresos.

## Buscar en la auditoría con filtros
<!-- ruta: /crm/auditoria; permisos: audit.read -->

Para encontrar quién cambió algo:
1. Entrá a **Auditoría** (`/crm/auditoria`, menú Sistema).
2. Completá los filtros que necesites:
   - **Entidad**: tipo de registro (`property`, `user`, `lead`, `job`, `feature_flag`…).
   - **Id de la entidad**: el uuid o la clave (por ejemplo la clave de un flag).
   - **Usuario**: quién hizo el cambio.
   - **Acción**: por ejemplo `PROPERTY_PRICE_CHANGED`, `USER_ROLES_CHANGED`, `RENT_PAYMENT_VOIDED`.
   - **Desde** y **Hasta**: fechas en hora de Salta, ambas incluidas.
3. Tocá **Aplicar**. **Limpiar** borra los filtros.

Los resultados salen del más nuevo al más viejo, 50 por página. Cada fila muestra la acción, la entidad, la fecha y quién la hizo («Sistema» si fue un proceso automático, «Sin sesión» si no había un usuario logueado). Hacé clic para desplegar **Antes**, **Después** y **Metadatos**; para propiedades, usuarios y jobs aparece **Ir a la entidad**. Si no hay coincidencias verás «Sin registros para esos filtros». El historial de un usuario también se ve en la tarjeta **Historial** de `/crm/usuarios/[id]`.

## Revisar la migración desde el sitio anterior
<!-- ruta: /crm/migracion; permisos: migration.read -->

**Migración** (`/crm/migracion`) muestra lo importado desde el sitio anterior de la inmobiliaria para revisión humana: nada se corrige en silencio. La ven Super Admin, Dirección y Administrador (`migration.read`).

La pantalla tiene:
- **Registros por etapa**: cuántas fichas hay en cada etapa por origen: Descubierta, Extraída, Normalizada, Validada, Importada, Fotos verificadas, Requiere revisión, Verificada, Publicada, Falló y «Omitida (editada a mano)».
- **Corridas recientes**: las últimas 10 importaciones con estado **En curso**, **Completa**, **Completa con errores** o **Falló**, fechas y quién la lanzó. Desplegando una ves el error y las **Estadísticas**.
- **Advertencias**: contadores de errores, advertencias e informativas abiertas, y la tabla para revisar.

Si todavía no hubo importaciones aparece «Todavía no se corrió ninguna importación». Hoy el CRM no permite lanzar una importación desde pantalla: la corre el equipo técnico. Las fichas con advertencias de severidad **Error** quedan en revisión y sin publicar. El tablero muestra el total en **Advertencias de migración** y **De severidad error**.

## Resolver o descartar una advertencia de migración
<!-- ruta: /crm/migracion; permisos: migration.review -->

Necesitás `migration.review` (Super Admin, Dirección o Administrador).

1. Entrá a **Migración** (`/crm/migracion`), tarjeta **Advertencias**.
2. Filtrá con **Estado** (Abiertas, Resueltas, Descartadas), **Severidad** (Error, Advertencia, Info) y **Código**, y tocá **Filtrar**. Se ordenan primero los errores.
3. Leé la advertencia: severidad, código, mensaje, **Campo**, y en **Valores** los datos A y B que no coinciden.
4. Abrí la propiedad (link `#código título`) y corregí el dato en su ficha si hace falta.
5. Volvé y tocá **Resolver** (lo corregiste o está bien) o **Descartar** (no aplica).

Resolver o descartar **no cambia la propiedad**: solo registra tu decisión («Resuelta por … el …») en la auditoría (`MIGRATION_WARNING_RESOLVED` / `MIGRATION_WARNING_DISMISSED`). Códigos frecuentes: `implausible_price` (precio poco creíble), `price_per_unit_in_description` (el precio podría ser por hectárea o m²), `missing_images`, `missing_locality`, `protected_field_conflict` (el sitio anterior difiere de una corrección hecha en el CRM) y `missing_from_source` (ya no está en el sitio anterior; su estado no se cambia solo).

## Marcar como verificada una propiedad migrada
<!-- ruta: /crm/migracion; permisos: migration.review -->

Cuando revisaste a fondo una ficha importada, marcala como verificada para dejar constancia y protegerla de futuras importaciones.

1. En **Migración** (`/crm/migracion`), buscá una advertencia de esa propiedad.
2. En la columna **Propiedad** tocá **Marcar verificada**.
3. Confirmá «¿Marcar la propiedad como verificada?».
4. La fila pasa a mostrar «Verificada» con la fecha.

Qué hace: guarda quién y cuándo verificó, pasa sus registros de migración a la etapa **Verificada** y audita `PROPERTY_VERIFIED`. Una propiedad verificada ya no se sobrescribe si el equipo técnico vuelve a correr el importador. Aparte de eso, cualquier campo que edites a mano en el CRM queda protegido: la importación no lo pisa y, si el sitio anterior trae otro valor, genera la advertencia `protected_field_conflict`. Marcar verificada no publica la propiedad ni resuelve las advertencias abiertas: eso se hace por separado.

## Qué avisos automáticos recibe el equipo
<!-- ruta: /crm/notificaciones; permisos: automations.read, users.read -->

Los avisos (notificaciones in-app) llegan a **Avisos** (`/crm/notificaciones`, arriba a la derecha, con el contador de no leídos). Según la configuración de fábrica:

- **Lead nuevo**: «Nuevo lead» al agente asignado; si el lead no tiene asignado, a todos los Administradores y Super Admin. Además se crea la tarea «Primer contacto con el lead».
- **Contrato por vencer** (60 días antes) y **Ajuste de alquiler para revisar**: a todos los usuarios con rol Alquileres.
- **Integración con fallas**: a Administradores y Super Admin, como mucho una vez por hora mientras siga fallando.
- **Tarea automática fallida: <tipo>** (job muerto): a Administradores y Super Admin, con link a Jobs.
- **Conversación de WhatsApp derivada a una persona**: al agente asignado o a administración.

Los avisos «a administración» van a los roles Administrador y Super Admin; el rol Dirección no los recibe salvo que también tenga uno de esos roles. Aparte, la automatización **Aviso interno por email de lead nuevo** manda un email a la casilla interna configurada, sin teléfono ni email del contacto, cuando el envío de emails está activo. Hoy el CRM no permite elegir desde pantalla quién recibe cada aviso.

## Ver la salud del sistema en el tablero
<!-- ruta: /crm; permisos: automations.read, integrations.read, migration.read -->

El **Tablero** (`/crm`) tiene el bloque **Salud del sistema** para quienes tienen permisos de sistema. Cada número es un acceso directo:

- **Jobs muertos** → `/crm/sistema/jobs?status=dead`.
- **Reintentando** → jobs fallidos que el sistema va a volver a intentar.
- **En cola demorados** (más de 10 min) → jobs que deberían haber corrido y no corrieron: suele indicar que el cron no está funcionando.
- **Advertencias de migración** y **De severidad error** → `/crm/migracion`.
- La lista de integraciones **Degradada**, **Con error** o **En pausa hasta …**, con su último error; si no hay problemas dice «Ninguna integración con errores.».

Cada parte aparece solo si tenés el permiso correspondiente: `automations.read` para los jobs, `migration.read` para la migración e `integrations.read` para las integraciones. Una rutina sana: revisar semanalmente jobs muertos, integraciones degradadas y advertencias de migración abiertas.

## Qué pasa si el cron no corre
<!-- ruta: /crm/sistema/jobs; permisos: automations.read -->

El cron es el proceso que corre cada minuto en el servidor: despacha los eventos a las automatizaciones, encola las tareas programadas y procesa la cola de jobs. Si deja de correr, el CRM sigue funcionando para cargar y consultar datos, pero se frena todo lo automático:

- No llegan los avisos ni se crean las tareas automáticas (por ejemplo, de leads nuevos).
- Emails, respuestas de WhatsApp, sincronización con portales y publicaciones programadas quedan en cola.
- No se descargan índices ni corren las tareas diarias de alquileres.

Cómo darte cuenta: en el tablero sube **En cola demorados**; en **Jobs → En cola** hay jobs con «Próximo» en el pasado; en **Automatizaciones** la **Última** ejecución no avanza.

Qué hacer: avisá al equipo técnico. Ellos verifican en Vercel que el cron `/api/cron/jobs` responda bien y que esté configurado su secreto; en producción, `/api/ready` también lo marca. Cuando vuelve, los eventos y jobs pendientes se procesan solos, sin duplicarse. Las tareas diarias corren para el día en curso: los días perdidos no se recuperan como corridas separadas.
