---
dominio: visits
titulo: Visitas: Mis visitas, check-in y centro operativo
resumen: Cómo operar una visita desde el teléfono (salgo, check-in con GPS, iniciar, finalizar), compartir el link del cliente, cargar informe, seguimiento y agradecimiento, y supervisar el día desde el centro operativo con alertas y reasignación.
permisos: visits.operate, visits.monitor
---

## Ver mis visitas de hoy y las próximas
<!-- ruta: /crm/mis-visitas; permisos: visits.operate, visits.monitor -->

**Mis visitas** (`/crm/mis-visitas`, menú Operación) es el portal del agente para las visitas (citas o turnos para mostrar una propiedad) pensado para usar desde el teléfono. Solo aparecen las citas de tipo **Visita** que se agendaron en la **Agenda**.

1. Entrá a **Mis visitas**.
2. Elegí **Hoy** (visitas del día) o **Próximas** (desde mañana, las próximas dos semanas aproximadamente).
3. Si ves todas las visitas, elegí **Mías** o **Equipo**.
4. Tocá una visita para abrir su detalle (`/crm/mis-visitas/[id]`).

Cada tarjeta muestra la hora (y el día en **Próximas**), el estado, el resultado de la llegada si ya hubo check-in, «Cód. …» con el título de la propiedad y el cliente («Sin cliente cargado» si no tiene). En **Equipo** también figura el agente. Las visitas canceladas no se listan acá.

Quién ve qué: con `visits.operate` (Super Admin, Dirección, Administrador y Agente) ves y operás **solo las visitas asignadas a vos**; no alcanza con haberlas creado. Con `visits.monitor` o `agenda.read_all` ves las de toda la organización y aparecen las pestañas **Mías** / **Equipo**. Solo lectura, Marketing y Alquileres no acceden. Si no hay nada: «No tenés visitas para hoy» o «Sin visitas en los próximos 15 días».

## Estados de una visita y qué botones aparecen
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

Una visita recorre estos estados (se ven como etiqueta en la lista, el detalle y el centro operativo):

- **Programada** (incluye las confirmadas desde la Agenda): el agente asignado ve **Salgo para allá**, **Confirmar llegada** y el enlace **Reportar problema de ubicación**.
- **En camino**: **Confirmar llegada** y **Reportar problema de ubicación**.
- **Check-in**: **Iniciar visita**; si la llegada no quedó verificada, también **Reintentar verificación de llegada (n/3)**.
- **En curso**: **Finalizar visita**.
- **Finalizada**: aparecen las tarjetas **Informe post-visita**, **Seguimiento** y **Agradecimiento**.
- **Cancelada** («La visita fue cancelada: motivo») y **No se presentó** («El cliente no se presentó.»): sin acciones.

La tarjeta se llama **Siguiente paso** mientras la visita está activa y **Estado** cuando terminó. Se puede pasar de Programada a Check-in sin marcar «salgo». Salir, llegar e iniciar solo lo registra el agente asignado; quien mira una visita ajena lee «La salida, la llegada y el inicio los registra el agente asignado desde su teléfono.»

Hoy **Mis visitas** no tiene botones para cancelar ni para marcar que el cliente no vino: eso se hace desde la Agenda. Si tocás una acción que ya no corresponde (por ejemplo, otra persona avanzó la visita), aparece «La visita está «…»: esta acción ya no corresponde. Actualizá la pantalla.»

## Avisar que salís hacia la propiedad («Salgo para allá»)
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Marcar la salida pasa la visita a **En camino** y le avisa al cliente (si tiene el link) que su asesor va para allá.

1. Entrá a **Mis visitas** y tocá la visita.
2. En **Siguiente paso** tocá **Salgo para allá** (mientras guarda dice «Registrando…»).
3. La etiqueta cambia a **En camino**.

Qué tenés que saber:

- Es opcional: podés ir directo a **Confirmar llegada**.
- **No registra ubicación**: solo cambia el estado.
- Solo lo puede marcar el agente asignado, aunque seas administrador.
- Funciona dentro de la franja de la visita: desde 2 horas antes del inicio hasta 2 horas después del fin (configurable en `visits.checkin_window_minutes`). Antes aparece «Todavía es temprano: podés registrarlo desde las …»; después, «La franja de la visita ya pasó: pedí que la reprogramen o cerrala desde la Agenda».
- En el link del cliente se ve «Tu asesor está en camino» y en el centro operativo «Salió HH:MM».
- Si alguien reprograma o reasigna la visita mientras estás en camino, vuelve a **Programada**.

## Confirmar la llegada (check-in) con la ubicación del teléfono
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

El check-in registra que llegaste a la propiedad comparando una única lectura del GPS con las coordenadas del inmueble.

1. Abrí la visita en **Mis visitas** (tiene que estar Programada o En camino).
2. Tocá **Confirmar llegada**. Se abre el diálogo **Confirmar llegada**, que explica que se pide la ubicación una sola vez, el radio usado (150 m por defecto), que no hay seguimiento en segundo plano, que el cliente no ve tu ubicación y que las coordenadas se anonimizan a los 30 días.
3. Tocá **Usar mi ubicación**. Recién ahí el navegador te pide permiso de ubicación: aceptalo.
4. Esperá «Obteniendo ubicación…» (alta precisión, hasta 15 segundos).
5. Se abre **Llegada registrada** con el resultado. Tocá **Continuar**.

La visita pasa a **Check-in** aunque la llegada no quede verificada: nunca se bloquea. Se guarda por intento: hora del servidor y del teléfono, latitud, longitud y precisión, distancia a la propiedad, radio y tope de precisión usados, y el resultado con su motivo. El cliente ve «Tu asesor ya está en la propiedad» con la hora de llegada.

Solo el agente asignado puede hacerlo y dentro de la franja de la visita (2 horas antes del inicio a 2 horas después del fin). La ubicación solo se puede pedir en las pantallas de **Mis visitas**: el resto del CRM y del sitio tiene la geolocalización bloqueada.

## Check-in verificado o para revisar, y cómo reintentar
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

El resultado de la llegada se calcula en el servidor:

- **Verificado** si la distancia a la propiedad es menor o igual al radio (`visits.geofence_radius_m`, 150 m) más la precisión del GPS, con un tope de 200 m (`visits.geofence_max_accuracy_m`). Se ve «Check-in verificado · aprox. 20 m de la propiedad» y la etiqueta «Llegada verificada».
- **Requiere revisión** («Check-in requiere revisión», etiqueta «Llegada para revisar») con uno de estos motivos: «La ubicación quedó fuera del radio de la propiedad», «La precisión del GPS no alcanzó para verificar» (precisión peor que el tope) o «La propiedad no tiene coordenadas cargadas» (también si tiene 0,0).

Con la llegada para revisar el diálogo aclara «No bloquea la visita: podés iniciarla. Queda marcado para que el equipo lo revise.» y se abre la alerta «Check-in para revisar».

Para reintentar:

1. Con la visita en **Check-in**, tocá **Reintentar verificación de llegada (1/3)**.
2. Repetí **Usar mi ubicación**.

Hay **como máximo 3 intentos por visita**, contando el primero y los reportes de problema de ubicación. Después aparece «Ya se registraron los 3 intentos de llegada. El check-in queda para revisión: podés iniciar la visita.» Una vez que la visita está **En curso** ya no se reintenta. La tarjeta **Llegada** lista cada intento: «Intento N · fecha», resultado, motivo, distancia y «precisión ±X m».

## Qué hacer si el GPS falla o negaste el permiso de ubicación
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Si la ubicación no se puede obtener, la visita sigue igual: registrás la llegada sin coordenadas.

En el diálogo **Confirmar llegada** puede aparecer un aviso con el motivo, seguido de «Podés reintentar o reportar el problema: la visita sigue igual.»: «No se dio permiso de ubicación», «El teléfono no pudo obtener la ubicación», «El GPS tardó demasiado» o «El navegador no permite ubicación». El botón pasa a decir **Reintentar**.

Para registrar la llegada sin ubicación:

1. Tocá **Reportar problema de ubicación** (en el diálogo o debajo de los botones de la visita).
2. En **Problema de ubicación** elegí el **Motivo**: los cuatro anteriores u «Otro motivo».
3. Completá **Detalle (opcional)**; si elegiste «Otro motivo» pasa a **Detalle (obligatorio)** y pide al menos 3 caracteres («Contá brevemente qué pasó»). Máximo 500.
4. Tocá **Registrar llegada sin ubicación**.

La visita pasa a **Check-in** con «Llegada registrada sin ubicación» y el historial suma «Problema de ubicación reportado». No se guarda ninguna coordenada. El reporte cuenta como uno de los 3 intentos de llegada, y solo lo puede hacer el agente asignado dentro de la franja de la visita.

## Privacidad de la ubicación en las visitas
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

La ubicación se usa **solo para confirmar la llegada** a una visita, no para medir rendimiento ni saber dónde está una persona.

- Se pide únicamente cuando el agente toca **Confirmar llegada** y después **Usar mi ubicación**: una sola lectura. Nunca en segundo plano, ni durante el trayecto, ni después. No hay seguimiento continuo ni historial de ubicaciones. **Salgo para allá** no registra ubicación.
- Latitud, longitud y precisión se guardan solo en el registro del intento de llegada y se **borran automáticamente a los 30 días** (`visits.location_retention_days`, tarea diaria). Quedan el resultado, el motivo, la distancia y los horarios.
- Las coordenadas no se copian a la auditoría, al historial de la visita, a eventos ni a notificaciones; la base rechaza guardarlas en el historial.
- **El cliente** solo ve el estado («en camino», «ya está en la propiedad», «en curso»), nunca la ubicación ni la distancia.
- **El agente** ve su resultado, distancia y precisión. **Administración y dirección** ven lo mismo en el centro operativo; ninguna pantalla muestra coordenadas.
- **Otros agentes** no ven nada: cada uno ve solo sus visitas.
- Hoy el CRM no comparte la posición en vivo del agente con nadie.

Consultas o pedidos de revisar o borrar un registro puntual se canalizan con dirección.

## Iniciar y finalizar la visita
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Después del check-in, marcá el comienzo y el cierre de la recorrida:

1. Con la visita en **Check-in**, tocá **Iniciar visita** («Iniciando…»). Pasa a **En curso** y el cliente ve «La visita está en curso». Solo lo hace el agente asignado.
2. Al terminar, tocá **Finalizar visita**.
3. Confirmá «¿Finalizar la visita? El cliente verá que terminó y vas a poder cargar el informe.» con **Sí, finalizar** (o **Volver**).

Finalizar lo puede hacer el agente asignado o quien ve todas las visitas y tiene `visits.operate`. Al finalizar:

- la visita queda **Finalizada** y aparecen **Informe post-visita**, **Seguimiento** y **Agradecimiento**;
- se agrega «Visita realizada» al historial del contacto y, si hay una oportunidad abierta en una etapa anterior, pasa a «Visita realizada»;
- el link del cliente deja de mostrar el estado en vivo y muestra el cierre;
- **no** se crea la tarea automática «Seguimiento post-visita»: el seguimiento lo creás vos desde la tarjeta **Seguimiento**.

Si la visita sigue **En curso** más de la duración planificada más 60 minutos, aparece la alerta «Visita en curso demasiado larga».

## Generar y compartir el link de seguimiento para el cliente
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

El link del cliente es una página temporal (`/visita/…`) donde el cliente sigue el estado de su visita. Nada se le envía solo: lo compartís vos.

1. Abrí la visita en **Mis visitas** y buscá la tarjeta **Link del cliente**.
2. Tocá **Generar link para el cliente** («Generando…»).
3. Aparece «Link listo. Compartilo ahora: por seguridad no se vuelve a mostrar.» con el link.
4. Compartilo con **Copiar link** («Copiado ✓»), **Enviar por WhatsApp** o **Compartir…** (menú del teléfono, si el navegador lo permite).

**Enviar por WhatsApp** abre WhatsApp con el texto «Hola …, te comparto el enlace para seguir tu visita con Lucio López Fleming: …», dirigido al WhatsApp del cliente si está cargado.

Qué tenés que saber:

- El link se muestra **una sola vez**; en la base queda solo una huella. Si lo perdés, rotalo.
- Hay **un solo link activo por visita**.
- Lo genera el agente asignado o quien ve todas las visitas (con `visits.operate`).
- No se generan links para visitas finalizadas, canceladas o con cliente ausente: «La visita ya terminó: no se generan links nuevos».
- Después la tarjeta muestra **Estado** (Activo o Vencido), **Aperturas**, **Última apertura** («Todavía no lo abrió») y **Vence**. Las vistas previas de WhatsApp o redes no cuentan como apertura; la primera apertura figura en el historial.

## Rotar o revocar el link del cliente y cuándo vence
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Desde la tarjeta **Link del cliente** del detalle de la visita:

**Rotar** (si perdiste el link o lo mandaste a quien no correspondía):

1. Tocá **Generar link nuevo (rotar)**.
2. Confirmá «El link anterior deja de funcionar en el acto. ¿Generar uno nuevo?» con **Sí, rotar**.
3. Compartí el link nuevo, que también se muestra una sola vez.

**Revocar** (cortar el acceso del cliente):

1. Tocá **Revocar link**.
2. Confirmá «El cliente ya no va a poder abrir el link. ¿Revocarlo?» con **Sí, revocar**.

Revocar se puede también con la visita terminada; rotar, no. Si la visita sigue activa, después de revocar vuelve a aparecer **Generar link para el cliente**.

**Vencimiento**: el link vence 48 horas después del fin de la visita (o del cierre real, si terminó más tarde), configurable en `visits.client_link_grace_hours`, y nunca dura más de 30 días desde que se generó. Si la visita se reprograma, el mismo link sigue sirviendo dentro de ese tope. Cuando vence, la tarjeta muestra **Vencido** y **Venció**, y el historial suma «Link del cliente vencido». Un link vencido, revocado o rotado muestra al cliente «Este enlace no está disponible.»

## Qué ve el cliente al abrir el link de su visita
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

La página `/visita/…` es personal, no aparece en buscadores y no pide iniciar sesión. Mientras la visita está activa muestra:

- «Tu visita», «Hola, [nombre de pila].» y la fecha con el horario.
- El estado con las etapas **Programada**, **En camino**, **En la propiedad** y **En curso**: «Tu visita está programada», «Tu asesor está en camino», «Tu asesor ya está en la propiedad» con «Llegada confirmada HH:MM», o «La visita está en curso». Se actualiza sola cada unos 12 segundos.
- La propiedad: foto, «La propiedad · Cód. …», título, zona y la calle solo si la dirección exacta no está oculta.
- «Tu asesor» con nombre y apellido, y los botones **Contactar por WhatsApp** y **Llamar**: los del asesor si su perfil es público; si no, los de la inmobiliaria («Contacto de la inmobiliaria»).

Nunca muestra la ubicación ni la distancia del asesor, notas ni teléfonos privados. No hay foto del asesor.

Cuando la visita termina, se cancela o el cliente no se presentó, la página muestra solo «Esta visita ha finalizado.» y «Gracias por confiar en Lucio López Fleming.», el asesor y el contacto. Si la visita se finalizó y guardaste un agradecimiento, también se ve ese mensaje. Un link inválido, vencido, revocado o rotado muestra «Este enlace no está disponible.» y sugiere pedirle un enlace nuevo al asesor.

## Cargar el informe post-visita (escrito o dictado)
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

Con la visita **Finalizada**, completá la tarjeta **Informe post-visita**:

1. Escribí **¿Cómo fue la visita?** (mínimo 3 caracteres). Para dictar, tocá **Dictar**, hablá y tocá **Detener dictado**; el texto se agrega al comentario («Escuchando… el texto se agrega al comentario.»).
2. Elegí el **Interés del cliente**: **Bajo**, **Medio** o **Alto**.
3. Completá **Aspectos positivos**, **Objeciones** y **Siguiente paso**.
4. Revisá la **Fecha sugerida de seguimiento**: se completa sola según el interés hasta que la edites.
5. Tocá **Guardar borrador** («Borrador guardado.») o **Confirmar informe**.

Confirmado, se ve «Informe confirmado» con el resumen y el botón **Editar informe**; si después lo guardás con **Guardar borrador**, vuelve a borrador. Al confirmar sin fecha de seguimiento se usa la sugerida, y si la cita no tenía resultado en la Agenda se copia el comentario.

El dictado usa el reconocimiento de voz del navegador como si fuera el teclado: el CRM no graba ni guarda audio. El botón **Dictar** solo aparece si el navegador lo soporta; si falla, avisa (por ejemplo «Permití el micrófono para dictar (o usá el teclado del teléfono).»).

Lo carga el agente asignado o quien ve todas las visitas con `visits.operate`. Si pasan 12 horas desde el cierre sin informe confirmado, aparece la alerta «Finalizada sin informe».

## Crear la tarea de seguimiento después de la visita
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

El seguimiento post-visita es una tarea que crea una persona, nunca el sistema solo, desde la tarjeta **Seguimiento**:

1. Confirmá antes el informe. Si no, la tarjeta dice «Confirmá el informe para crear el seguimiento.»
2. Revisá **Fecha y hora del seguimiento**. Viene precargada con la fecha del informe o con la sugerencia según el interés, contada desde el cierre: **Alto → 24 h**, **Medio o sin indicar → 48 h**, **Bajo → 7 días** (redondeado a 5 minutos). La ayuda lo explica, por ejemplo «Interés alto: sugerido 24 h después de la visita. Editable.»
3. Tocá **Crear tarea de seguimiento** («Creando…»).

Se crea una tarea de tipo Seguimiento, prioridad Normal, asignada al agente de la visita y vinculada a ella, con un título como «Seguimiento de visita · Prop. … · cliente». La tarjeta pasa a «Tarea de seguimiento creada» con el vencimiento, el estado (Pendiente, Completada o Cancelada) y el enlace **Ver mis tareas**.

Hay **una sola tarea de seguimiento por visita**: tocar de nuevo no duplica. Hace falta además `tasks.manage`; sin ese permiso se lee «Sin permiso para crear tareas.» Si pasan 12 horas desde el cierre con informe confirmado y sin tarea, aparece la alerta «Informe sin seguimiento».

## Preparar el agradecimiento y marcarlo como enviado
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate -->

La tarjeta **Agradecimiento** aparece con la visita **Finalizada**. El CRM **no envía nada automáticamente**: vos copiás o abrís WhatsApp y después registrás que lo mandaste.

1. Revisá el **Mensaje de agradecimiento**. Viene de una plantilla con el nombre de pila del cliente, la propiedad, tu nombre y la inmobiliaria. Editalo si querés (entre 10 y 1000 caracteres).
2. Tocá **Guardar mensaje** (cuando no hay cambios dice «Mensaje guardado»).
3. Envialo con **Copiar mensaje** o **Abrir WhatsApp con el mensaje** (va al WhatsApp del cliente si está cargado).
4. Tocá **Marcar como enviado**. Si había cambios sin guardar, primero se guardan. Queda «Marcado como enviado · fecha».

Qué tenés que saber:

- Se registra el canal usado (WhatsApp, copiado u otro) y el historial suma «Agradecimiento preparado» y «Agradecimiento marcado como enviado».
- Apenas lo guardás, el mensaje aparece en la tarjeta de cierre del link del cliente, mientras el link siga vigente.
- Solo se marca como enviado una vez.
- Lo gestiona el agente asignado o quien ve todas las visitas con `visits.operate`; los demás ven el texto sin botones.

## Supervisar el día en el centro operativo
<!-- ruta: /crm/centro-operativo; permisos: visits.monitor -->

El **Centro operativo** (`/crm/centro-operativo`, menú Operación) es el tablero de las visitas del día para Super Admin, Dirección y Administrador (`visits.monitor`).

1. Navegá entre días con **←**, **Hoy** y **→** (el título dice «Visitas del …»).
2. Para ver a una persona, elegí el **Agente** («Todos» por defecto) y tocá **Filtrar**.
3. Mirá los contadores: **Programadas**, **En camino**, **Check-in**, **En curso**, **Finalizadas** e **Incidencias** (visitas con alertas abiertas, canceladas o sin presentarse).
4. Revisá **Alertas abiertas** y la tabla **Visitas del día**.

La tabla tiene **Hora** (inicio y fin), **Agente** («Usuario inactivo» si corresponde), **Propiedad**, **Cliente**, **Estado** (con las alertas), **Llegada** (resultado del check-in y «Salió HH:MM · Llegó HH:MM»), **Cierre** («Informe confirmado», «Informe en borrador» o «Sin informe», y «Con seguimiento» o «Sin seguimiento») y las acciones **Ver** y **Reasignar**. A diferencia de Mis visitas, acá también se listan las canceladas.

**Ver** abre el detalle de la visita con la tarjeta **Llegada** (cada intento) y el **Historial de la visita**: las últimas 100 novedades con fecha, qué pasó (reprogramada, salió, check-in, link abierto, informe confirmado, etc.) y quién («Cliente», «Sistema» o la persona). El historial no se puede editar ni borrar. Desde el detalle no podés registrar salida, llegada ni inicio de otro agente.

## Entender las alertas del centro operativo
<!-- ruta: /crm/centro-operativo; permisos: visits.monitor -->

Las alertas se recalculan cada 5 minutos («Sin alertas abiertas. Se recalculan cada 5 minutos.»), se ordenan por gravedad y se resuelven solas cuando la situación se corrige. La lista **Alertas abiertas** incluye las de cualquier día (respeta el filtro de agente). Tocá una para abrir la visita.

- **Visita próxima sin agente activo** (crítica): visita activa que empieza en las próximas 24 horas con el agente desactivado. Avisa a Administrador y Dirección. Solución: reasignarla.
- **Sin check-in después del inicio** (crítica): sigue Programada o En camino 15 minutos después del inicio.
- **Check-in para revisar** (advertencia): la llegada quedó sin verificar (fuera del radio, poca precisión, propiedad sin coordenadas o sin ubicación).
- **Visita en curso demasiado larga** (advertencia): En curso más de la duración planificada más 60 minutos.
- **Visita pasada sin finalizar** (advertencia): sigue activa (sin estar en curso) 2 horas después del fin.
- **Finalizada sin informe** (info): 12 horas después del cierre sin informe confirmado.
- **Informe sin seguimiento** (info): informe confirmado sin tarea de seguimiento 12 horas después del cierre.

«Sin check-in», «Check-in para revisar» y «Visita pasada sin finalizar» notifican al agente, a Administrador y a Dirección. Las otras solo se ven en el tablero. Cada tipo notifica **una sola vez por visita**, aunque la alerta se resuelva y vuelva. Los plazos se configuran en `visits.alert_*`.

## Reasignar una visita a otro agente
<!-- ruta: /crm/centro-operativo; permisos: visits.monitor -->

Si el agente no puede ir, pasale la visita a otra persona con el mismo horario:

1. Entrá a **Centro operativo** y ubicá la visita en **Visitas del día**.
2. Tocá **Reasignar**. Solo aparece si la visita está **Programada** (o confirmada) o **En camino**.
3. En el diálogo «Reasignar · HH:MM · Cód. …» elegí el **Agente**.
4. Tocá **Reasignar** («Reasignando…»). El botón no se activa si elegís al mismo agente.

La visita mantiene fecha, hora y duración, vuelve a **Programada** (se borra la salida si estaba en camino) y el nuevo agente recibe la notificación «Cita reprogramada». El historial suma «Agente reasignado» y el link del cliente sigue siendo el mismo, ahora con el nombre del nuevo asesor.

Qué tenés que saber:

- Con la visita en **Check-in** o después ya no se puede reasignar.
- Si el nuevo agente tiene otra cita superpuesta, aparece «El agente ya tiene una cita en ese horario».
- La lista muestra a todos los usuarios activos del equipo: elegí a alguien con `visits.operate` para que pueda operarla desde **Mis visitas**.
- También se puede cambiar el agente desde la Agenda con **Reprogramar** (campo **Agente**).

## Qué pasa si los flags visits_operations o client_visit_link están apagados
<!-- ruta: /crm/mis-visitas; permisos: visits.operate, visits.monitor -->

El módulo de visitas depende de dos feature flags, que vienen encendidos y se cambian en **Integraciones** (`/crm/integraciones`, con `integrations.manage`):

**`visits_operations`** (portal, check-in, informe, seguimiento y centro operativo). Apagado:

- **Mis visitas** y **Centro operativo** desaparecen del menú y sus pantallas responden «no encontrado».
- En la Agenda desaparece **Abrir en Mis visitas** y la Agenda funciona igual que antes (sin historial de visita ni eventos nuevos).
- Las alertas y el registro de links vencidos dejan de calcularse.
- Todos los links de clientes responden «Este enlace no está disponible.»
- El borrado de coordenadas a los 30 días **sigue corriendo** igual.

**`client_visit_link`** (link del cliente). Apagado:

- La tarjeta **Link del cliente** no aparece en el detalle de la visita.
- Generar o rotar responde «El link del cliente está desactivado».
- Cualquier link ya compartido muestra «Este enlace no está disponible.»; al volver a encender el flag, los que no vencieron ni se revocaron vuelven a funcionar.

El resto del portal (salgo, check-in, informe, seguimiento y agradecimiento) funciona con `client_visit_link` apagado.

## Relación entre Mis visitas y la Agenda: reprogramar, cancelar o marcar ausencia
<!-- ruta: /crm/agenda/[id]; permisos: visits.operate, agenda.manage, agenda.read_all -->

**Mis visitas** no crea visitas nuevas: trabaja sobre **la misma cita** de la Agenda (`/crm/agenda`). Una visita se agenda con **Agendar** y tipo **Visita**, y aparece sola en Mis visitas.

- En el detalle de la cita en la Agenda está **Abrir en Mis visitas** (si la visita es tuya o ves todas). En Mis visitas, el enlace **Ver en la Agenda (reprogramar, notas)** hace el camino inverso.
- **Reprogramar**: desde la Agenda, con **Reprogramar**, mientras la visita esté Programada, Confirmada o En camino. Después de la llegada ya no se puede. Reprogramar mueve la misma cita (no crea otra) y la vuelve a **Programada**, así que la oportunidad, el link del cliente y el seguimiento siguen vinculados. El historial suma «Visita reprogramada» con «Nuevo horario: …».
- **Cancelar** y **No asistió** se hacen solo desde la Agenda (**Cancelar cita** con motivo obligatorio, **No asistió** después de la hora de inicio). En Mis visitas se ven como **Cancelada** y **No se presentó**.
- **Marcar realizada** en la Agenda también cierra la visita (el historial dice «Desde la Agenda»). En ese caso sí corre la automatización «Seguimiento post-visita».
- Las visitas En camino, Check-in y En curso siguen ocupando el horario del agente: no se puede agendarle otra cita superpuesta.

## Lo que la IA todavía no hace en las visitas
<!-- ruta: /crm/mis-visitas/[id]; permisos: visits.operate, visits.monitor -->

En esta fase el módulo de visitas **no usa inteligencia artificial**. Todo lo que ves es determinista o lo carga una persona. Para que nadie lo espere:

- **Brief previo a la visita**: hoy el CRM no genera un resumen de la propiedad, el cliente y su historial antes de salir. La tarjeta «Antes de la visita» está prevista pero no aparece.
- **Informe estructurado**: hoy el CRM no convierte el comentario escrito o dictado en interés, positivos, objeciones y siguiente paso. Esos campos los completás vos. El panel «Revisá y confirmá» con «Usar estos campos» está previsto, pero no aparece porque no hay propuesta.
- **Agradecimiento redactado por IA**: el mensaje sale de una plantilla fija y editable, no de un borrador generado.
- **Sugerencia de seguimiento**: es una regla fija por interés (24 h, 48 h o 7 días), no una recomendación de IA.
- **Envío automático**: hoy el CRM no envía el link, el agradecimiento ni ningún mensaje por WhatsApp o email sin que una persona lo haga.
- **Posición en vivo del agente**: no existe; el cliente solo ve el estado.
- **Dictado**: lo hace el reconocimiento de voz del navegador, no la IA del CRM.

Son puntos de extensión documentados para una fase siguiente. Cuando se implementen, la propuesta de la IA siempre va a requerir que el agente la revise y confirme.
