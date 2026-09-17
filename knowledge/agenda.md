---
dominio: agenda
titulo: Agenda, citas y tareas
resumen: Cómo ver la agenda, agendar visitas, llamadas y reuniones, cambiar el estado de una cita y gestionar las tareas propias y del equipo.
permisos: agenda.manage, agenda.read_all, tasks.manage, tasks.read_all
---

## Ver la agenda del día o de la semana
<!-- ruta: /crm/agenda; permisos: agenda.manage, agenda.read_all -->

La agenda (calendario de citas, turnos y visitas) está en **Agenda** (`/crm/agenda`). Todos los horarios son en hora de Salta.

1. Arriba elegí la vista **Día** o **Semana**.
2. Navegá con las flechas (día o semana anterior y siguiente) o tocá **Hoy**.
3. Para saltar a una fecha, usá **Ir a**, elegí el día y tocá **Ver**.
4. Tildá **Ver canceladas** y tocá **Ver** si también querés ver las citas canceladas (por defecto se ocultan).

Cada cita muestra hora de inicio y fin, tipo (Visita, Llamada, Reunión, Seguimiento), estado, título, contacto y lugar. Tocá una cita para abrir su detalle, donde están las acciones, los datos vinculados (contacto, propiedad, oportunidad), las notas y los botones **Llamar** y **WhatsApp** del contacto.

Con `agenda.manage` ves las citas asignadas a vos o que creaste vos. Con `agenda.read_all` ves las de todo el equipo, podés filtrar por **Agente** y ves quién tiene cada cita. En el tablero (`/crm`) también aparece el bloque de visitas de los próximos 7 días.

## Ver la agenda semanal de todo el equipo
<!-- ruta: /crm/agenda; permisos: agenda.read_all -->

Si tenés el permiso `agenda.read_all` (dirección, administración y solo lectura, por defecto), la agenda suma la vista **Equipo**:

1. Entrá a **Agenda**.
2. Tocá **Equipo**.
3. Navegá entre semanas con las flechas o **Hoy**, o elegí una fecha en **Ir a** y tocá **Ver**.

Se muestra una tabla con una fila por **Agente** y una columna por día de la semana. Cada casilla lista las citas de ese agente ese día con hora, tipo y contacto; las canceladas aparecen tachadas si tildaste **Ver canceladas**. Tocá cualquier cita para abrir el detalle.

Solo aparecen los agentes que tienen citas en la semana; si nadie tiene, se ve «Nadie del equipo tiene citas esta semana». En esta vista no se usa el filtro **Agente** (está pensada para comparar a todos). Sin `agenda.read_all` la pestaña **Equipo** no aparece y solo ves tu propia agenda.

## Agendar una visita a una propiedad
<!-- ruta: /crm/agenda/nueva; permisos: agenda.manage -->

Para programar una visita (turno para mostrar una propiedad):

1. En **Agenda** tocá **Agendar**. También podés tocar **Agendar** desde un lead o contacto, o **Agendar visita** desde una oportunidad con propiedad: la cita viene precargada y vinculada.
2. En **Tipo** elegí **Visita**.
3. Si podés agendar para otros, elegí el **Agente** («Yo» por defecto).
4. Completá **Fecha y hora** (hora de Salta) y la **Duración** (de 15 min a 3 h).
5. Buscá la **Propiedad a visitar** por código, título o dirección. Es obligatoria para visitas; si la cita sale de una oportunidad o lead y la dejás vacía, se usa la de ellos.
6. Buscá el **Contacto**, y opcionalmente completá **Título (opcional)**, **Lugar (opcional)** y **Notas (opcional)**.
7. Tocá **Agendar**.

Si no ponés título se arma con tipo, propiedad y contacto; si no ponés lugar, en visitas se usa la dirección de la propiedad. Si la visita está vinculada a una oportunidad que estaba en una etapa anterior, la oportunidad pasa sola a «Visita programada». Si agendás para otra persona, le llega la notificación «Visita agendada para vos».

Con el portal de visitas encendido, la misma visita aparece en **Mis visitas** (`/crm/mis-visitas`) del agente asignado. Ahí marca la salida, confirma la llegada, finaliza y carga el informe: ver la guía de visitas.

## Agendar una llamada, reunión o seguimiento
<!-- ruta: /crm/agenda/nueva; permisos: agenda.manage -->

Además de visitas, la agenda guarda llamadas, reuniones y seguimientos con clientes o propietarios.

1. En **Agenda** tocá **Agendar** (o **Agendar** desde la ficha de un contacto o lead, o **Agendar cita** desde una oportunidad sin propiedad).
2. En **Tipo** elegí **Llamada**, **Reunión** o **Seguimiento**.
3. Si tenés `agenda.read_all`, elegí el **Agente**; si no, la cita queda a tu nombre.
4. Cargá **Fecha y hora** y **Duración**.
5. Opcionalmente buscá la **Propiedad (opcional)** y el **Contacto**.
6. Completá **Título (opcional)**, **Lugar (opcional)** y **Notas (opcional)**.
7. Tocá **Agendar**.

Al guardar te lleva al detalle de la cita. Si entrás a **Agendar** desde un día que no es hoy, la fecha viene precargada a las 10:00; si no, se propone la próxima media hora. La cita queda en estado **Programada**. Hoy el CRM no permite editar el título, el contacto, la propiedad ni las notas de una cita ya creada: solo se puede reprogramar, cambiar de estado o agregar notas internas en la tarjeta **Notas**.

## Qué pasa si el agente ya tiene una cita en ese horario
<!-- ruta: /crm/agenda/nueva; permisos: agenda.manage -->

El CRM no permite que un mismo agente tenga dos citas activas superpuestas. La regla está en la base de datos, así que vale para todos los caminos: agendar, reprogramar o pasar la cita a otro agente.

Si el horario choca, el formulario muestra el error **«El agente ya tiene una cita en ese horario»** en el campo de fecha y hora, y la cita no se guarda. Para resolverlo:

1. Revisá la agenda del agente en **Agenda** (vista **Día** o **Semana**, o **Equipo** si ves a todos).
2. Elegí otro horario u otra **Duración**, o asigná la cita a otro **Agente** si tenés permiso.
3. Volvé a tocar **Agendar** (o **Reprogramar**).

Ocupan el horario las citas activas: **Programada**, **Confirmada** y, en las visitas que se operan desde **Mis visitas**, **En camino**, **Check-in** y **En curso**. Una cita **Cancelada**, **Realizada** o marcada como **No asistió** libera el horario. Dos citas pueden ser consecutivas (una termina a la hora exacta en que empieza la otra) sin que se considere superposición.

## Confirmar una cita con el cliente
<!-- ruta: /crm/agenda/[id]; permisos: agenda.manage -->

Cuando el cliente confirma que va a asistir a la visita o reunión, dejalo registrado:

1. Abrí la cita desde **Agenda**.
2. En la tarjeta **Acciones** tocá **Confirmar**.

La cita pasa de **Programada** a **Confirmada**. El botón solo aparece mientras la cita está Programada.

Tené en cuenta que si después reprogramás la cita (cambiás fecha, hora, duración o agente), vuelve a **Programada**, porque la confirmación era para el horario anterior: vas a tener que confirmarla de nuevo.

Para avisarle al cliente usá los botones **Llamar** o **WhatsApp** de la tarjeta **Contactar** en la misma cita; abren tu teléfono y registran la actividad en el historial del contacto. Hoy el CRM no envía recordatorios automáticos de citas al cliente.

## Marcar una visita o cita como realizada
<!-- ruta: /crm/agenda/[id]; permisos: agenda.manage -->

Después de la visita, reunión o llamada, registrá cómo fue:

1. Abrí la cita desde **Agenda**.
2. En **Acciones** tocá **Marcar realizada**.
3. En **¿Cómo fue? (obligatorio)** escribí el resultado: interés, objeciones, próximos pasos (mínimo 3 caracteres).
4. Tocá **Guardar resultado**.

La cita pasa a **Realizada** y el resultado queda visible en el detalle. El botón solo aparece cuando la hora de inicio ya pasó y la cita sigue activa: Programada, Confirmada, En camino, Check-in o En curso. No se puede completar una cita futura.

Si es una **Visita**, además:

- se agrega «Visita realizada: …» al historial del contacto;
- si está vinculada a una oportunidad abierta en una etapa anterior, la oportunidad pasa sola a «Visita realizada»;
- si la automatización «Seguimiento posterior a visita» está activa, se crea la tarea «Seguimiento post-visita» para el día siguiente;
- con **Mis visitas** encendido, el historial de la visita registra «Visita finalizada» con «Desde la Agenda», y el informe post-visita se puede cargar igual desde **Mis visitas**.

Si la visita la está operando el agente en **Mis visitas**, lo habitual es cerrarla ahí con **Finalizar visita**: en ese caso no se crea la tarea automática y el seguimiento lo crea una persona desde la tarjeta **Seguimiento**.

## Marcar que el cliente no se presentó a la cita
<!-- ruta: /crm/agenda/[id]; permisos: agenda.manage -->

Si el cliente o interesado no vino a la visita o no atendió la llamada agendada:

1. Abrí la cita desde **Agenda**.
2. En **Acciones** tocá **No asistió**.
3. Confirmá en el cartel «¿Marcar que el contacto no asistió?».

La cita pasa al estado **No asistió** y deja de estar activa, así que libera el horario del agente. Este botón solo aparece cuando la hora de inicio ya pasó y la cita está Programada, Confirmada, En camino o Check-in; con la visita **En curso** ya no se puede marcar. En **Mis visitas** este estado se ve como «No se presentó», y **Mis visitas** no tiene un botón propio para marcarlo: se hace desde la Agenda.

Una cita marcada como No asistió no mueve la oportunidad vinculada ni genera tareas automáticas. Si querés volver a intentar, agendá una cita nueva con **Agendar**. Hoy el CRM no permite volver una cita No asistió, Realizada o Cancelada a un estado activo; en esos casos la tarjeta **Acciones** muestra «La cita ya no está activa».

## Reprogramar una cita o pasarla a otro agente
<!-- ruta: /crm/agenda/[id]; permisos: agenda.manage -->

Para cambiar el día, la hora o la duración de una cita, o reasignarla:

1. Abrí la cita desde **Agenda**.
2. En **Acciones** tocá **Reprogramar**.
3. Elegí **Nueva fecha y hora** (hora de Salta) y la **Duración**.
4. Si tenés `agenda.read_all`, podés cambiar el **Agente**. Sin ese permiso no podés pasar la cita a otra persona.
5. Opcionalmente escribí el **Motivo (opcional)**.
6. Tocá **Reprogramar**.

Solo se reprograman citas que todavía no empezaron: Programadas, Confirmadas o con el agente **En camino**. Con la visita en Check-in o En curso el botón ya no aparece. Al reprogramar se mueve la misma cita (no se crea otra) y vuelve a **Programada**; si estaba En camino, se borra la salida. El link del cliente y el seguimiento siguen vinculados, y en **Mis visitas** el historial suma «Visita reprogramada». Quien supervisa también puede pasar una visita a otro agente con **Reasignar** en el **Centro operativo**. Si el nuevo horario choca con otra cita activa del agente, aparece «El agente ya tiene una cita en ese horario» y no se guarda. Si la cita queda a cargo de otra persona, esa persona recibe la notificación «Cita reprogramada». El cambio (horario anterior, nuevo y motivo) queda en la auditoría.

## Cancelar una cita
<!-- ruta: /crm/agenda/[id]; permisos: agenda.manage -->

Si la visita, llamada o reunión no se va a hacer:

1. Abrí la cita desde **Agenda**.
2. En **Acciones** tocá **Cancelar cita**.
3. Escribí el **Motivo (obligatorio)**, con al menos 3 caracteres.
4. Tocá **Cancelar cita** para confirmar.

La cita pasa a **Cancelada**, libera el horario del agente y el motivo queda visible en el detalle como «Motivo de cancelación». Se pueden cancelar todas las citas activas: Programadas, Confirmadas y visitas En camino, Check-in o En curso. **Mis visitas** no tiene botón para cancelar: se hace desde acá. Si la visita tenía un link del cliente vigente, la página pasa a mostrar solo el cierre.

Las citas canceladas se ocultan de la agenda; para verlas tildá **Ver canceladas** y tocá **Ver**. Hoy el CRM no permite borrar una cita ni reactivar una cancelada: si el cliente vuelve a querer la visita, creá una cita nueva con **Agendar**.

## Estados de una cita y qué significan
<!-- ruta: /crm/agenda/[id]; permisos: agenda.manage, agenda.read_all -->

Cada cita (visita, llamada, reunión o seguimiento) tiene uno de estos estados:

- **Programada**: recién agendada o reprogramada. Ocupa el horario del agente.
- **Confirmada**: el cliente confirmó. Ocupa el horario.
- **En camino**, **Check-in** y **En curso**: solo en visitas. Los marca el agente asignado desde **Mis visitas** (salió, llegó, empezó). Ocupan el horario.
- **Realizada**: se hizo (en **Mis visitas** se ve como «Finalizada»).
- **Cancelada**: no se hace; tiene motivo. Oculta salvo con **Ver canceladas**.
- **No asistió**: el contacto no se presentó (en **Mis visitas**, «No se presentó»).

Qué muestra la tarjeta **Acciones** según el estado:

1. **Programada**: **Confirmar**, **Reprogramar** y **Cancelar cita**. Después de la hora de inicio, también **Marcar realizada** y **No asistió**.
2. **Confirmada** y **En camino**: lo mismo, sin **Confirmar**.
3. **Check-in**: **Cancelar cita** y, después de la hora de inicio, **Marcar realizada** y **No asistió**. Ya no se reprograma.
4. **En curso**: **Cancelar cita** y **Marcar realizada** (después de la hora de inicio).
5. **Realizada**, **Cancelada** y **No asistió** son finales: «La cita ya no está activa.»

Reprogramar vuelve la cita a **Programada** desde Confirmada o En camino. En visitas con **Mis visitas** encendido, el encabezado de la cita muestra **Abrir en Mis visitas** (si la visita es tuya o ves todas). Solo quien tiene `agenda.manage` ve la tarjeta **Acciones**; con `agenda.read_all` solamente se puede consultar.

## Ver mis tareas del día y las vencidas
<!-- ruta: /crm/tareas; permisos: tasks.manage, tasks.read_all -->

Las tareas (pendientes, recordatorios, llamadas a devolver) están en **Tareas** (`/crm/tareas`). Por defecto se abre la pestaña **Hoy y vencidas**.

Pestañas de estado:

- **Hoy y vencidas**: pendientes con vencimiento hasta el final de hoy, incluidas las atrasadas.
- **Vencidas**: pendientes cuyo vencimiento ya pasó.
- **Pendientes**: todas las abiertas, con o sin vencimiento.
- **Hechas** y **Canceladas**.

Cada tarea muestra título, tipo (Tarea, Llamada, Reunión, Seguimiento, Email, WhatsApp), prioridad si no es normal, detalle, vencimiento («Vence …», o «Venció …» en rojo si está atrasada, o «Sin vencimiento») y el vínculo al contacto, lead, oportunidad, cita o propiedad. Tocá el vínculo para ir a esa ficha.

En **Mías** ves las tareas asignadas a vos y las sin asignar que creaste vos. Las tareas sin vencimiento no aparecen en **Hoy y vencidas**: buscalas en **Pendientes**. La lista muestra hasta 200 tareas.

## Crear una tarea
<!-- ruta: /crm/tareas/nueva; permisos: tasks.manage -->

Para anotar algo que hay que hacer (llamar, mandar documentación, hacer un seguimiento):

1. En **Tareas** tocá **Nueva tarea**. También podés tocar **Nueva tarea** desde la ficha de un contacto, lead u oportunidad: la tarea queda **Vinculada a** esa ficha y al guardar volvés ahí.
2. Escribí **Qué hay que hacer** (mínimo 2 caracteres).
3. Elegí **Tipo**: Tarea, Llamada, Reunión, Seguimiento, Email o WhatsApp.
4. Elegí **Prioridad**: Baja, Normal, Alta o Urgente.
5. Opcionalmente cargá **Vence** (fecha y hora de Salta).
6. Si tenés `tasks.read_all`, elegí el **Responsable** («Yo» por defecto).
7. Opcionalmente agregá **Detalle (opcional)**.
8. Tocá **Crear tarea**.

Sin `tasks.read_all` la tarea queda asignada a vos. Si la asignás a otra persona, le llega la notificación «Nueva tarea asignada». Solo podés vincular la tarea a fichas que tenés permiso para ver. Hoy el CRM no permite editar una tarea ya creada (título, vencimiento o responsable): si hace falta, cancelala y creá otra.

## Completar, cancelar o reabrir una tarea
<!-- ruta: /crm/tareas; permisos: tasks.manage -->

Desde la lista de **Tareas**, cada tarea tiene sus botones a la derecha:

1. **Completar**: marca la tarea como **Hecha** (se ve tachada y pasa a la pestaña **Hechas**).
2. **Cancelar**: pide confirmación («¿Cancelar esta tarea?») y la pasa a **Canceladas**.
3. **Reabrir**: aparece en las tareas hechas o canceladas y la vuelve a **Pendiente**, con el mismo vencimiento que tenía.

No se puede completar una tarea cancelada ni cancelar una ya completada: primero hay que reabrirla. Cada cambio queda en la auditoría.

Podés gestionar las tareas asignadas a vos y las que creaste vos. Con `tasks.read_all` podés gestionar las de todo el equipo desde la vista **Equipo**. Quien solo tiene `tasks.read_all` sin `tasks.manage` (por ejemplo, el rol de solo lectura) ve las tareas pero no los botones. Hoy el CRM no permite borrar tareas.

## Ver y asignar las tareas del equipo
<!-- ruta: /crm/tareas; permisos: tasks.read_all -->

Con el permiso `tasks.read_all` (dirección, administración y solo lectura, por defecto) podés supervisar las tareas de todos:

1. Entrá a **Tareas**.
2. Tocá **Equipo** (al lado de **Mías**). Si solo tenés permiso de lectura, se abre directamente la vista del equipo.
3. Elegí la pestaña de estado (**Hoy y vencidas**, **Vencidas**, **Pendientes**, **Hechas**, **Canceladas**).
4. En **Responsable** elegí «Todos», «Sin asignar» o una persona, y tocá **Filtrar**.

En esta vista cada tarea muestra también a quién está asignada o «Sin asignar». Revisá seguido el filtro **Sin asignar**: ahí caen las tareas automáticas de eventos que no tenían agente asignado.

Para asignarle una tarea nueva a otra persona, en **Nueva tarea** elegí el **Responsable**; la persona recibe una notificación. Hoy el CRM no permite reasignar una tarea existente: cancelala y creala de nuevo para la otra persona.

## Tareas que se crean automáticamente
<!-- ruta: /crm/tareas; permisos: tasks.manage, tasks.read_all -->

Algunas tareas no las carga nadie: las generan las automatizaciones del CRM (se ven y activan en **Automatizaciones**) y el asistente de WhatsApp.

- **Lead nuevo**: «Aviso de lead nuevo + tarea de seguimiento» crea la tarea de tipo Llamada «Primer contacto con el lead», que vence a las 2 horas, asignada al agente del lead.
- **Visita realizada**: «Seguimiento posterior a visita» crea «Seguimiento post-visita», que vence al día siguiente.
- **Contrato de alquiler por vencer**: «Aviso de contrato por vencer» crea «Gestionar renovación o finalización», que vence a los 3 días.
- **Pedido de visita por WhatsApp**: cuando un cliente pide visitar una propiedad, el asistente crea la tarea «Coordinar visita a #código» (o «Coordinar visita pedida por WhatsApp») para un asesor. Nunca confirma una cita: la visita la agenda una persona desde **Agendar**.

Las de lead nuevo y visita realizada quedan vinculadas a esa ficha y muestran el enlace; la de contrato por vencer no muestra enlace en la lista. Si el evento no tenía agente asignado, la tarea queda **Sin asignar** y solo se ve en la vista **Equipo** con el filtro «Sin asignar». Se completan, cancelan y reabren igual que las manuales.
