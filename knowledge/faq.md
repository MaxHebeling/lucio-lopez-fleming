---
dominio: faq
titulo: Preguntas frecuentes del equipo
resumen: Respuestas cortas a las dudas más comunes del día a día en el CRM, con la pantalla y el permiso que corresponde en cada caso.
permisos:
---

## ¿Por qué no veo un lead que cargó otro agente?
<!-- ruta: /crm/leads -->

Porque con el rol **Agente** solo ves los leads **asignados a vos** (permiso `leads.read_own`). Ver todos los leads requiere `leads.read_all`, que tienen Dirección, Administrador y Solo lectura. En `/crm/leads` el encabezado lo indica: «N leads asignados a vos».

Casos típicos:
- Otro agente cargó el lead: sin permiso de asignar (`leads.assign`), el lead queda a cargo de quien lo carga.
- El lead entró por el sitio: se asigna solo al agente responsable de la propiedad consultada; si la consulta no era por una propiedad o la propiedad no tiene responsable activo, queda **sin asignar** y un agente no lo ve.
- Abriste un link a un lead ajeno: el CRM muestra «no encontrado», aunque exista.

Qué hacer: pedile a un Administrador o a Dirección que te lo asigne desde el detalle del lead (formulario **Asignar**). Desde ese momento te aparece en tu lista.

## ¿Por qué una propiedad no aparece en el sitio?
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

Una propiedad se muestra en el sitio público solo si se cumplen todas estas condiciones:
1. Está **Publicada** (en su ficha del CRM se ve la etiqueta «Publicada desde …» y no «No publicada»).
2. Su estado es **Disponible**, **Reservada**, **Vendida** o **Alquilada** (una pausada o archivada no sale).
3. No es una propiedad **DEMO** ni está borrada.

Para publicarla hace falta, además, que tenga ubicación, al menos una foto y una operación con precio. Si falta algo, la ficha (`/crm/propiedades/[id]`) muestra el aviso «Para publicar falta:» con la lista, y el botón **Publicar** queda deshabilitado.

Otras causas: la home y los destacados muestran solo propiedades disponibles o reservadas con varias fotos, así que una vendida o con pocas fotos puede estar en el buscador pero no en la portada. Los cambios hechos desde el CRM se reflejan en el sitio al instante; los que vienen de procesos automáticos, en pocos minutos. Publicar requiere `properties.publish` (Super Admin, Dirección, Administrador).

## ¿Por qué no puedo publicar una propiedad o cambiarle el precio?
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

Hay dos motivos posibles:

**1. Tu rol no lo permite.** Publicar o despublicar (`properties.publish`), cambiar el precio (`properties.change_price`) y cambiar el estado (`properties.change_status`: reservar, vender, alquilar, pausar, archivar) solo lo pueden hacer Super Admin, Dirección y Administrador. Los roles Agente y Marketing no tienen esos permisos, por eso no ven los botones. Pedíselo a un Administrador.

**2. A la propiedad le faltan datos.** Si ves el botón **Publicar** pero está deshabilitado, en la ficha (`/crm/propiedades/[id]`) aparece «Para publicar falta:» con lo pendiente:
- «El estado debe ser Disponible, Reservada, Vendida o Alquilada».
- «Falta la ubicación».
- «Falta al menos una foto».
- «Falta la operación y el precio».

Una propiedad DEMO nunca se puede publicar. Completá lo que falta (o pedí a quien tenga permiso de editar) y volvé a intentar.

## ¿Por qué un mensaje de WhatsApp quedó «Sin credenciales: no enviado»?
<!-- ruta: /crm/conversaciones/[id]; permisos: conversations.read -->

Porque **WhatsApp Business todavía no está conectado**: faltan las credenciales de Meta en la configuración del servidor. El CRM guarda tu respuesta en la conversación pero no la envía ni simula el envío. Arriba de la conversación vas a ver «WhatsApp Business todavía no está conectado (faltan credenciales de Meta). Las respuestas quedan registradas pero no se envían.».

Si en cambio el mensaje figura **En cola** con el aviso sobre el flag `outbound_whatsapp`, las credenciales están pero el envío real está apagado.

Qué hacer:
1. Avisá a un Administrador: las credenciales se cargan en Vercel, no en el CRM, y el flag `outbound_whatsapp` se enciende en `/crm/integraciones`.
2. Una vez configurado, el sistema reenvía solo, cada hora, los mensajes de las últimas 24 horas.
3. También podés tocar **Reintentar envío** debajo del mensaje (permiso `conversations.reply`).

Pasadas 24 horas desde el último mensaje del cliente, WhatsApp ya no permite respuestas libres: solo **Enviar plantilla aprobada**.

## ¿Por qué el asistente de IA no responde los WhatsApp?
<!-- ruta: /crm/conversaciones; permisos: conversations.read -->

El asistente responde solo si están las tres cosas: WhatsApp conectado, la clave de Claude (`ANTHROPIC_API_KEY`, que carga un administrador en Vercel) y el flag `whatsapp_ai_bot` encendido en `/crm/integraciones`. Arriba de **Conversaciones** el CRM te dice cuál falta: «El asistente de IA está apagado…» o «El asistente de IA no tiene credenciales…».

Aunque esté todo configurado, el asistente deriva a una persona (la conversación pasa a modo **Persona** y se ve «Derivada:» con el motivo) cuando:
- El cliente pide hablar con alguien, negocia, quiere reservar o reclama.
- Manda audio, foto o archivo.
- El asistente tiene baja confianza, falla dos veces o intenta dar un dato que no está en la base.
- Se agotó el presupuesto diario de IA.
- Alguien del equipo tomó la conversación.

En modo Persona la IA no vuelve a responder hasta que alguien toque **Devolver al asistente**.

## ¿Dónde veo las visitas de hoy?
<!-- ruta: /crm/agenda; permisos: agenda.manage, agenda.read_all -->

En **Agenda** (`/crm/agenda`). Por defecto abre la vista **Día** con la fecha de hoy.

1. Entrá a **Agenda** desde el menú.
2. Si estás en otro día, tocá **Hoy**.
3. Con **Semana** ves los siete días; con las flechas ← → te movés; en **Ir a** elegís una fecha y tocás **Ver**.
4. Marcá **Ver canceladas** si también querés las citas canceladas.

Qué ves depende de tu permiso:
- Con `agenda.manage` (Agente, Alquileres) ves tus citas: las asignadas a vos y las que cargaste vos.
- Con `agenda.read_all` (Dirección, Administrador, Solo lectura) ves las de todo el equipo, podés filtrar por **Agente** y tenés la vista **Equipo**.

Para cargar una visita tocá **Agendar** (requiere `agenda.manage`). En el **Tablero** también está el bloque **Visitas próximas (7 días)**.

## ¿Dónde veo mis tareas de hoy y las vencidas?
<!-- ruta: /crm/tareas; permisos: tasks.manage, tasks.read_all -->

En **Tareas** (`/crm/tareas`). Abre en la pestaña **Hoy y vencidas**: las tareas pendientes que vencen hoy o ya vencieron.

Otras pestañas: **Vencidas**, **Pendientes**, **Hechas** y **Canceladas**. Si no hay nada verás «No hay tareas acá» (en **Hoy y vencidas**, con la aclaración «No tenés tareas para hoy ni vencidas.»).

Qué tareas aparecen:
- Con `tasks.manage` (Agente, Alquileres): las asignadas a vos y las sin asignar que creaste vos.
- Con `tasks.read_all` (Dirección, Administrador, Solo lectura): también las del equipo; con permiso de gestionar aparecen las vistas **Mías** y **Equipo** y el filtro por responsable.

Muchas tareas las crea el sistema solo: «Primer contacto con el lead» (a 2 horas de un lead nuevo), «Seguimiento post-visita» o «Gestionar renovación o finalización» de un contrato. Para crear una a mano tocá **Nueva tarea**. En el **Tablero** también está el bloque **Tareas vencidas**.

## ¿Cómo cambio mi contraseña?
<!-- ruta: /crm/cuenta -->

Si sabés tu contraseña actual:
1. Tocá **Cuenta** arriba a la derecha (`/crm/cuenta`).
2. En **Cambiar contraseña** completá **Contraseña actual**.
3. Escribí la **Contraseña nueva**: mínimo 10 caracteres, con letras y números, distinta de la actual.
4. Repetila en **Repetí la contraseña nueva**.
5. Tocá **Cambiar contraseña**. Aparece «Contraseña actualizada. Se cerraron tus otras sesiones.».

Tu sesión actual sigue abierta; las de otros dispositivos se cierran.

Si no la recordás: en la pantalla de ingreso tocá **Olvidé mi contraseña** (`/crm/recuperar`), escribí tu email y tocá **Enviarme el link**. El link vence en 1 hora. Esto solo funciona si ya habías definido una contraseña: si tu invitación quedó pendiente, pedí que te la reenvíen. Nadie del equipo puede ver ni cambiar tu contraseña por vos.

## ¿Por qué el CRM me obliga a cambiar la contraseña?
<!-- ruta: /crm/cuenta -->

Porque tu usuario tiene marcado el **cambio de contraseña obligatorio**. Mientras esté pendiente, cualquier pantalla te lleva a **Mi cuenta** con el aviso «Antes de seguir tenés que cambiar tu contraseña.», y cualquier acción que intentes devuelve «Antes de continuar tenés que cambiar tu contraseña (Mi cuenta).».

1. En la tarjeta **Cambiar contraseña** completá **Contraseña actual**, **Contraseña nueva** (mínimo 10 caracteres, letras y números, distinta de la actual) y **Repetí la contraseña nueva**.
2. Tocá **Cambiar contraseña**.
3. El CRM te lleva al **Tablero** y ya podés trabajar normalmente.

Mientras tanto solo podés cambiar la contraseña o tocar **Salir**. Si no recordás la contraseña actual, salí y usá **Olvidé mi contraseña** en la pantalla de ingreso: restablecerla por link también quita la obligación.

## ¿Qué hago si quedé bloqueado por intentos fallidos?
<!-- ruta: /crm/login -->

Después de **5 intentos fallidos** seguidos, la cuenta queda bloqueada **15 minutos** y el ingreso muestra «Demasiados intentos. Esperá 15 minutos o restablecé tu contraseña.».

Opciones:
1. Esperá 15 minutos y probá de nuevo con cuidado (revisá mayúsculas y el email).
2. O tocá **Olvidé mi contraseña** (`/crm/recuperar`), pedí el link y definí una contraseña nueva: al restablecerla se levanta el bloqueo.

Si el mensaje es «Demasiados intentos desde esta conexión. Probá más tarde.», el límite es por red (muchos intentos desde la misma conexión), no por tu usuario: esperá unos minutos.

Si dice «Tu usuario está desactivado. Consultá con administración.», no es un bloqueo: alguien con permiso de gestionar usuarios te desactivó y tiene que reactivarte. Quien gestiona usuarios puede ver en `/crm/usuarios/[id]` si hay **Bloqueo por intentos** y hasta cuándo.

## ¿Por qué no me llegó el email de invitación o de recuperación?
<!-- ruta: /crm/usuarios/[id] -->

Revisá primero spam. Si no está, las causas más comunes son:

1. **El envío de emails no está activo.** Si el flag `outbound_email` está apagado o faltan las credenciales del proveedor de email, los emails quedan en cola y no salen. La pantalla de invitación ya lo advierte: «El email queda en la cola de envíos…». Se envían solos cuando se active, si no vencieron.
2. **El link venció.** La invitación dura 72 horas y el link de recuperación 1 hora; si el email no salió a tiempo se cancela.
3. **Pediste recuperación sin haber activado la cuenta.** «Olvidé mi contraseña» no envía nada a cuentas con invitación pendiente.

Qué hacer: pedile a un Administrador que abra tu ficha en `/crm/usuarios/[id]` y, si la **Invitación** dice «Vencida: reenviala» o sigue pendiente, toque **Reenviar invitación** (requiere `users.manage`; el link anterior deja de funcionar). Si el problema es el envío de emails, se revisa en `/crm/integraciones`.

## ¿Por qué no veo un menú, como Usuarios o Integraciones?
<!-- ruta: /crm -->

El menú lateral se arma con tus permisos: cada sección aparece solo si alguno de tus roles la habilita. Por ejemplo:
- **Usuarios** requiere `users.read`, **Auditoría** `audit.read` y **Migración** `migration.read`: solo Super Admin, Dirección y Administrador.
- **Integraciones**, **Automatizaciones** y **Jobs** requieren `integrations.read` o `automations.read`: además, Solo lectura.
- **Conversaciones** requiere `conversations.read`: Super Admin, Dirección, Administrador y Agente.
- **Contratos**, **Cobros**, **Liquidaciones** e **Índices** requieren `rentals.read`.
- **Portales** requiere `publications.manage`; **Contenido**, `marketing.read`.

Revisá tus roles en **Cuenta** (`/crm/cuenta`), tarjeta **Accesos**. Si te falta algo para tu trabajo, pedile a quien gestiona usuarios que te agregue el rol correcto en `/crm/usuarios/[id]`. **Avisos**, **Cuenta** y **Buscar** están siempre disponibles para todos.

## ¿Qué significa «No tenés permiso para la sección a la que intentaste entrar»?
<!-- ruta: /crm -->

Ese aviso aparece en el **Tablero** cuando abriste una pantalla que tus roles no habilitan, por ejemplo con un link que te pasaron o escribiendo la dirección a mano. El CRM no muestra la pantalla y te devuelve a `/crm`.

No es un error del sistema: el servidor controla el permiso en cada pantalla aunque el link sea correcto.

Otros mensajes parecidos:
- «No tenés permiso para esta acción»: tocaste un botón o guardaste algo que tu rol no incluye. No se guardó nada.
- Página «no encontrado» en un lead, oportunidad, cita, tarea o conversación: puede existir, pero está asignada a otra persona y queda fuera de tu alcance.

Si necesitás ese acceso, pedile a un Administrador o a Dirección que revise tus roles en `/crm/usuarios/[id]`.

## ¿Por qué un lead, una cita o una conversación me dice «no encontrado»?
<!-- ruta: /crm/leads -->

Si el registro existe, lo más probable es que esté **fuera de tu alcance**. Sin los permisos de «ver todo», el CRM responde «no encontrado» en vez de «sin permiso», para no revelar datos de otros:

- **Lead** u **oportunidad**: solo ves los asignados a vos (roles sin `leads.read_all` / `opportunities.read_all`).
- **Cita** o **tarea**: solo las asignadas a vos o las que cargaste vos (sin `agenda.read_all` / `tasks.read_all`).
- **Conversación**: solo las asignadas a vos, las que todavía atiende el asistente sin asignar, o las de un lead o contacto asignado a vos (sin `leads.read_all`).

También pasa si el registro fue borrado o el link está mal copiado.

Qué hacer: pedile a un Administrador que te asigne el lead, la cita o el contacto. Apenas te lo asignen, el link funciona.

## ¿Por qué una propiedad figura «Esperando credenciales» en Portales?
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

En **Portales** (`/crm/publicaciones`, permiso `publications.manage`) cada propiedad publicada tiene un estado por portal. **Esperando credenciales** significa que el portal todavía no está conectado:

- **Argenprop** y **Zonaprop** no tienen API pública: hasta que la inmobiliaria firme un acuerdo con cada portal y se implemente la conexión, no se envía nada.
- **Mercado Libre** necesita la aplicación y la autorización de la cuenta cargadas por el equipo técnico; si el detalle dice «volvé a autorizar», la autorización venció.

Tu propiedad en el CRM y en el sitio no se ve afectada. Cuando la conexión esté lista, las publicaciones pendientes se retoman solas cada hora o con **Reintentar**. Si arriba ves «La sincronización automática está apagada (feature flag portal_sync)…», además hay que encender ese flag en `/crm/integraciones`. Un canal **Deshabilitado** no sincroniza; se habilita con **Habilitar** en su tarjeta.

## ¿Por qué no llegó el aviso ni se creó la tarea de un lead nuevo?
<!-- ruta: /crm/automatizaciones -->

El aviso «Nuevo lead» y la tarea «Primer contacto con el lead» los crea la automatización **Aviso de lead nuevo + tarea de seguimiento**, que corre en segundo plano (normalmente en menos de un minuto).

Causas posibles:
1. **La automatización está desactivada** en `/crm/automatizaciones`. Los leads que entraron mientras estaba apagada no reciben aviso ni tarea, aunque la reactives.
2. **Falló la ejecución**: aparece en **Ejecuciones con error** y se reintenta desde **Jobs**.
3. **El proceso automático (cron) no está corriendo**: en el Tablero sube **En cola demorados**.
4. **El aviso fue a otra persona**: va al agente asignado; si el lead no tiene asignado, a Administradores y Super Admin.

Revisar automatizaciones requiere `automations.read`; activar o reintentar, `automations.manage`. Si no tenés esos permisos, avisá a un Administrador. Mientras tanto, creá la tarea a mano desde **Tareas** → **Nueva tarea**.

## ¿Dónde veo mis avisos o notificaciones?
<!-- ruta: /crm/notificaciones -->

En **Avisos**, arriba a la derecha en cualquier pantalla del CRM (`/crm/notificaciones`). El número al lado indica cuántos tenés sin leer.

1. Tocá **Avisos**.
2. Elegí **Todas** o **Sin leer**.
3. Tocá el título de un aviso para ir al registro (lead, conversación, job…).
4. Tocá **Marcar leída** en uno, o **Marcar todas como leídas**.

Ahí llegan, entre otros: leads nuevos asignados a vos, conversaciones de WhatsApp derivadas a vos, contratos por vencer y ajustes para revisar (rol Alquileres), y alertas del sistema como jobs fallidos o integraciones con fallas (Administrador y Super Admin). Cada persona ve solo sus propios avisos. Hoy el CRM no permite elegir qué avisos recibir ni mandarlos por email o WhatsApp personal.

## ¿Quién puede cambiarme el rol o darme más permisos?
<!-- ruta: /crm/usuarios/[id] -->

Los roles los cambia alguien con permiso `users.manage` (Super Admin, Dirección o Administrador), desde tu ficha en `/crm/usuarios/[id]`, tarjeta **Roles y sucursales**, botón **Guardar roles**. Vos no podés cambiarte los roles desde **Mi cuenta**: ahí solo los ves.

Límites:
- **Administrador** puede asignar Administrador, Agente, Alquileres, Marketing y Solo lectura.
- **Dirección** puede asignar todos menos Super Admin.
- Solo **Super Admin** puede dar o quitar el rol Super Admin.

Hoy el CRM no permite darle a una persona un permiso suelto: los permisos vienen agrupados por rol, y una persona puede tener varios roles a la vez. El cambio rige desde la próxima pantalla que abras, sin volver a ingresar, y queda registrado en la auditoría.

## ¿Cómo sé quién modificó una propiedad o cambió un precio?
<!-- ruta: /crm/auditoria -->

En **Auditoría** (`/crm/auditoria`), que ven Super Admin, Dirección y Administrador (`audit.read`).

1. En **Entidad** elegí `property`.
2. Si tenés el id de la propiedad, pegalo en **Id de la entidad** (o dejalo vacío para ver todas).
3. En **Acción** elegí, por ejemplo, `PROPERTY_PRICE_CHANGED` (precio), `PROPERTY_STATUS_CHANGED` (estado), `PROPERTY_PUBLISHED` o `PROPERTY_UPDATED`.
4. Opcional: acotá por **Usuario**, **Desde** y **Hasta**.
5. Tocá **Aplicar**.

Cada registro muestra fecha, quién lo hizo y, al desplegarlo, **Antes** y **Después** con los valores. **Ir a la entidad** abre la propiedad. Los registros no se pueden editar ni borrar. Si no tenés `audit.read`, pedile la consulta a un Administrador.

## ¿Por qué no puedo reintentar un job o activar una automatización?
<!-- ruta: /crm/sistema/jobs; permisos: automations.read -->

Ver **Jobs** y **Automatizaciones** requiere `automations.read` (Super Admin, Dirección, Administrador y Solo lectura), pero reintentar un job o activar y desactivar una automatización requiere `automations.manage`, que Solo lectura no tiene. Sin ese permiso los botones **Reintentar**, **Reintentar ahora**, **Activar** y **Desactivar** no aparecen.

Si tenés el permiso y no ves **Reintentar**, fijate el estado: solo se reintentan jobs **Muertos** o **Fallidos (reintentando)**. Los que están **En cola**, **En ejecución**, **Completados** o **Cancelados** no se reintentan. Si al tocar aparece «Solo se reintentan jobs fallidos o muertos» o «No se pudo reintentar: el job cambió de estado», otro proceso ya lo tomó: refrescá la pantalla.

Antes de reintentar, leé **Último error** y corregí la causa; si no, va a volver a fallar.

## ¿Qué hago con una advertencia de migración?
<!-- ruta: /crm/migracion; permisos: migration.read -->

Las advertencias de **Migración** (`/crm/migracion`) señalan datos dudosos importados del sitio anterior: precios poco creíbles, fichas sin fotos o sin localidad, diferencias con correcciones hechas en el CRM.

1. Filtrá por **Severidad: Error** primero: esas fichas quedan en revisión y sin publicar.
2. Leé el mensaje, el **Campo** y los **Valores** A y B.
3. Abrí la propiedad con el link y corregí el dato en su ficha si hace falta.
4. Volvé y tocá **Resolver** (quedó bien) o **Descartar** (no aplica).
5. Cuando la ficha esté revisada, tocá **Marcar verificada**.

Resolver o descartar no modifica la propiedad: solo deja registrada tu decisión. Ver la pantalla requiere `migration.read`; resolver, descartar y verificar requieren `migration.review` (Super Admin, Dirección, Administrador).

## ¿Puedo cargar la clave de la IA o de WhatsApp desde el CRM?
<!-- ruta: /crm/integraciones -->

No. Hoy el CRM no tiene ninguna pantalla para cargar o ver claves, tokens o secretos. Las credenciales de WhatsApp Business, Claude (`ANTHROPIC_API_KEY`), email, Meta, Mercado Libre y storage las carga un administrador con acceso al proyecto en **Vercel**, como variables de entorno, y después se vuelve a desplegar.

Lo que sí se hace desde el CRM, en `/crm/integraciones`:
- Ver si cada integración está **Activa**, **Esperando credenciales** o **Degradada**, y su último error.
- Encender o apagar los feature flags (`whatsapp_ai_bot`, `outbound_whatsapp`, `outbound_email`…), con permiso `integrations.manage`.

Nunca pegues una clave en una nota, tarea, conversación o chat del CRM: el CRM no la necesita y quedaría visible para otras personas. Si una integración figura **Esperando credenciales**, avisá a quien administra el proyecto en Vercel.

## ¿Por qué no me deja responder una conversación de WhatsApp?
<!-- ruta: /crm/conversaciones/[id]; permisos: conversations.reply -->

Responder requiere `conversations.reply` (Super Admin, Dirección, Administrador y Agente). Si tenés el permiso y el cuadro de respuesta está bloqueado, el CRM te dice por qué:

- «La conversación está cerrada. Tomala para reabrirla y responder.»: tocá **Reabrir y tomar**.
- «Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada.»: es una regla de WhatsApp. Usá **Enviar plantilla aprobada** si está configurada; si no aparece, no hay plantilla cargada.

Para tomar una conversación que atiende el asistente, tocá **Tomar conversación**: pasa a modo **Persona** y la IA deja de responder. Con **Devolver al asistente** la devolvés, y con **Cerrar** la cerrás.

Si la conversación ni siquiera te aparece, está fuera de tu alcance (asignada a otra persona). Pedí que te asignen el lead o el contacto.
