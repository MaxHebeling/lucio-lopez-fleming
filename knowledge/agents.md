---
dominio: agents
titulo: Usuarios del equipo y agentes
resumen: Invitar y administrar usuarios del CRM, roles y sucursales, desactivar, perfil público del asesor, asignar agentes a propiedades, leads y oportunidades, y qué ve cada agente.
permisos: users.read
---

## Ver los usuarios del equipo
<!-- ruta: /crm/usuarios; permisos: users.read -->

Entrá a **Usuarios** en el menú (`/crm/usuarios`, pantalla «Usuarios del equipo»). La tabla muestra cada persona con nombre y email, **Roles**, **Sucursales**, **Estado** (**Activo**, **Invitación pendiente** o **Desactivado**) y **Último ingreso** («Nunca» si todavía no entró). Primero aparecen los activos, ordenados por nombre, de a 25 por página.

Para filtrar:
1. En **Buscar** escribí parte del nombre o del email.
2. En **Rol** elegí un rol (por ejemplo Agente).
3. En **Estado** elegí Activos, Invitación pendiente o Desactivados.
4. Tocá **Aplicar** (o **Limpiar** para quitar filtros).

Tocá el nombre para abrir la ficha del usuario. Con los roles de fábrica, ven esta sección Super Admin, Dirección y Administrador (`users.read`); los agentes no. Solo quien tiene `users.manage` ve el botón **Invitar usuario** y puede modificar datos.

## Invitar un usuario nuevo al CRM
<!-- ruta: /crm/usuarios/invitar; permisos: users.manage -->

Para dar de alta a un agente o a otra persona del equipo:

1. En **Usuarios** tocá **Invitar usuario**.
2. Completá **Nombre completo *** y **Email ***.
3. Opcional: **Teléfono** y **WhatsApp** (característica y número; se guarda en formato internacional).
4. En **Roles** marcá al menos uno. Los roles que no podés otorgar aparecen deshabilitados con «Solo lo asigna quien gestiona roles.».
5. En **Sucursales** marcá las que correspondan.
6. Tocá **Enviar invitación**.

Se abre la ficha del usuario con «Usuario creado. La invitación quedó en la cola de envíos de email.». La persona recibe un link válido por **72 horas** para definir su contraseña. Si el envío de emails todavía no está activo (integración de email o flag `outbound_email`), la invitación sale cuando se active.

Errores comunes: «Ya existe un usuario con ese email», «Elegí al menos un rol» y «Número inválido» en WhatsApp. Hoy el CRM no permite crear un usuario con contraseña ya definida: siempre es por invitación.

## Reenviar una invitación vencida o perdida
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Si la persona no recibió el email o se le venció el link:

1. En **Usuarios** filtrá por **Estado: Invitación pendiente** y abrí la ficha.
2. En **Resumen**, **Invitación** dice «Vence …» o «Vencida: reenviala».
3. Tocá **Reenviar invitación** arriba a la derecha.
4. Confirmá «¿Reenviar la invitación? El link anterior deja de funcionar.».

Se genera un link nuevo, válido otras 72 horas, y el anterior queda inutilizado. El botón solo aparece mientras el usuario no definió su contraseña y está activo; si ya la definió, la invitación figura como «Aceptada». Una cuenta con invitación pendiente no puede usar «Olvidé mi contraseña»: la única forma de activarla es esta invitación. Por seguridad, el link nunca se muestra en pantalla: solo llega por email.

## Roles del equipo y qué puede hacer cada uno
<!-- ruta: /crm/usuarios; permisos: users.read -->

Los roles de fábrica son:

- **Super Admin**: acceso total, incluida la gestión de roles (`roles.manage`).
- **Dirección**: todo menos gestionar roles.
- **Administrador**: operación diaria completa (propiedades, publicación, contactos, leads de todos, asignaciones, usuarios, integraciones) salvo gestionar roles, aprobar liquidaciones y anular cobros.
- **Agente**: ver, crear y editar propiedades y sus fotos; contactos; sus propios leads, oportunidades, agenda y tareas; conversaciones. No publica, no cambia precios ni estados y no asigna agentes.
- **Alquileres**: contratos, cobros, ajustes, liquidaciones (sin aprobar), informes a propietarios, propietarios y datos privados de contactos, agenda y tareas propias.
- **Marketing**: contenido y campañas, portales, fotos de propiedades e informes.
- **Solo lectura**: consulta de propiedades, contactos, todos los leads, oportunidades, agenda y tareas, contratos, informes, marketing, automatizaciones e integraciones, sin modificar.

Un usuario puede tener varios roles y suma los permisos de todos. Hoy el CRM no permite crear roles nuevos ni cambiar los permisos de un rol desde la pantalla.

## Cambiar los roles de un usuario
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Para darle o quitarle un rol a alguien:

1. Abrí la ficha del usuario desde **Usuarios**.
2. En la tarjeta **Roles y sucursales**, marcá o desmarcá los roles.
3. Tocá **Guardar roles** (se habilita solo si hubo cambios y queda al menos un rol).
4. Aparece «Roles actualizados.».

Reglas que controla el servidor:
- Solo podés dar o quitar un rol si tenés `roles.manage` o si ya tenés **todos** los permisos de ese rol. Por eso un Administrador puede sumar Agentes o Marketing, pero no crear otro Administrador ni un Super Admin. Si lo intentás: «No podés asignar o quitar el rol "…": incluye permisos que vos no tenés».
- Super Admin solo lo da o quita quien gestiona roles; nadie se puede quitar Super Admin a sí mismo y siempre tiene que quedar al menos un Super Admin activo.

Los cambios de rol impactan en los permisos de la persona desde su siguiente acción. Sin `users.manage`, la tarjeta solo lista los roles.

## Asignar sucursales a un usuario
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Para indicar en qué sucursal trabaja cada persona:

1. Abrí la ficha del usuario.
2. En **Roles y sucursales**, en **Sucursales**, marcá o desmarcá las sucursales activas.
3. Tocá **Guardar sucursales**. Aparece «Sucursales actualizadas.».

También se pueden elegir al invitar. Las sucursales se ven en la columna **Sucursales** del listado de usuarios. Si no hay sucursales activas, la tarjeta dice «No hay sucursales activas.».

Importante: hoy las sucursales asignadas a un usuario son informativas y **no restringen** qué propiedades, leads, visitas o contratos ve. El alcance de cada persona lo definen sus roles (por ejemplo, ver solo sus leads). Para ver datos de una sucursal usá los filtros de **Sucursal** del tablero o del listado de propiedades.

## Editar los datos de un usuario (nombre, teléfono, WhatsApp)
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Para corregir los datos de contacto de alguien del equipo:

1. Abrí la ficha del usuario desde **Usuarios**.
2. En la tarjeta **Datos** editá **Nombre completo**, **Teléfono** o **WhatsApp**.
3. Tocá **Guardar datos**. Aparece «Datos guardados.».

El WhatsApp se normaliza al formato internacional (si no ponés característica, asume 387). Como el nombre y el WhatsApp del asesor se muestran en las fichas del sitio, al guardar el sitio se actualiza.

Hoy el CRM no permite cambiar el email de un usuario ni que cada persona edite sus propios datos desde **Cuenta**: lo hace quien tiene `users.manage`. Sin ese permiso, la tarjeta solo muestra teléfono, WhatsApp y si el perfil es visible en el sitio.

## Mostrar a un agente como asesor en el sitio (perfil público)
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

El perfil público del asesor hace que el nombre y el WhatsApp del agente aparezcan en la ficha pública de las propiedades donde es responsable:

1. Abrí la ficha del usuario en **Usuarios**.
2. En **Datos**, marcá **Mostrar como asesor en el sitio público**.
3. Verificá que el **WhatsApp** esté cargado.
4. Tocá **Guardar datos**.

Para que el asesor se vea en una propiedad tienen que cumplirse tres cosas: el usuario está activo, tiene el perfil público marcado y es el **Agente responsable** de esa propiedad (sección Agentes de la ficha). Los agentes de apoyo no se muestran. Si desmarcás la casilla o desactivás al usuario, deja de mostrarse. Hoy no existe una página pública individual por asesor con foto o biografía: solo se muestra en las fichas.

## Desactivar o reactivar un usuario
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Cuando alguien deja el equipo:

1. Abrí su ficha en **Usuarios**.
2. Tocá **Desactivar** arriba a la derecha.
3. Confirmá «¿Desactivar a …? Se cierran todas sus sesiones y no podrá ingresar.».

El usuario queda **Desactivado**, se cierran sus sesiones y al intentar entrar ve «Tu usuario está desactivado.». Para devolverle el acceso, tocá **Reactivar** (también le quita un bloqueo por intentos fallidos).

Restricciones: no podés desactivarte a vos mismo, no podés desactivar ni reactivar a alguien con un rol que no podrías asignar y tiene que quedar al menos un Super Admin activo. Hoy el CRM no permite borrar usuarios: la baja es siempre por desactivación, así se conserva el historial.

## Qué pasa con los leads y propiedades de un agente desactivado
<!-- ruta: /crm/leads; permisos: leads.assign, properties.assign_agents -->

Desactivar a un usuario **no reasigna** nada automáticamente:

- Sus **leads**, **oportunidades**, citas y tareas siguen asignados a esa persona.
- En las propiedades sigue figurando como agente, con «(inactivo)» en el selector de **Agentes**.
- Los leads nuevos que lleguen por una propiedad cuyo responsable está inactivo quedan **sin asignar** (ya no se le asignan).
- Deja de mostrarse como asesor en el sitio.

Para repartir su cartera:
1. En **Leads**, abrí **Filtros**, elegí en **Asignado** a esa persona y tocá **Aplicar**; abrí cada lead y reasignalo en **Asignado a**.
2. En **Pipeline**, abrí cada oportunidad y cambiá el **Responsable**.
3. En cada propiedad, sección **Agentes**, elegí un nuevo **Agente responsable** y tocá **Guardar agentes**.

Hoy el CRM no tiene reasignación masiva.

## Ver sesiones, bloqueos e historial de un usuario
<!-- ruta: /crm/usuarios/[id]; permisos: users.read -->

La ficha del usuario tiene una tarjeta **Resumen** con:

- **Último ingreso**: fecha y hora, o «Nunca».
- **Sesiones abiertas**: cuántos dispositivos tienen sesión vigente.
- **Invitación**: «Vence …», «Vencida: reenviala» o «Aceptada».
- **Bloqueo por intentos**: «Hasta …» si se bloqueó por 5 contraseñas incorrectas, o «No».

Con `audit.read` aparece además **Historial**: invitaciones, reenvíos, datos editados, cambios de roles y sucursales, desactivaciones, ingresos y cambios o pedidos de restablecimiento de contraseña, cada uno con fecha, quién lo hizo y el detalle «Antes» / «Después».

Hoy no hay un botón para desbloquear a alguien bloqueado por intentos: el bloqueo se levanta solo a los 15 minutos, o antes si la persona restablece la contraseña con «Olvidé mi contraseña». Tampoco se pueden cerrar sesiones de otro usuario por separado (desactivarlo las cierra todas).

## Asignar el agente responsable de una propiedad para que reciba sus leads
<!-- ruta: /crm/propiedades/[id]; permisos: properties.assign_agents -->

El agente responsable de una propiedad es quien recibe automáticamente las consultas de su ficha:

1. Abrí la propiedad y andá a la sección **Agentes**.
2. En **Agente responsable** elegí al agente (solo aparecen usuarios activos) o **Sin responsable**.
3. En **Apoyo** marcá a los agentes que colaboran.
4. Tocá **Guardar agentes**.

Efectos: los leads nuevos vinculados a esa propiedad (desde el sitio o cargados sin asignar) se asignan al responsable activo; el responsable figura como asesor en el sitio si tiene perfil público; en el listado de propiedades la columna **Agente** muestra al responsable, y el filtro **Agente** encuentra propiedades donde la persona es responsable o de apoyo. Hoy los agentes de apoyo no reciben leads automáticamente.

Este permiso (`properties.assign_agents`) es distinto de editar datos: lo tienen Super Admin, Dirección y Administrador. Quien crea o duplica una propiedad queda como responsable.

## Asignar un lead a un agente
<!-- ruta: /crm/leads/[id]; permisos: leads.assign -->

Para derivar una consulta a un agente:

1. Abrí el lead desde **Leads**.
2. En la tarjeta **Gestión**, en **Asignado a**, elegí al agente (o **Sin asignar**).
3. Tocá **Asignar**.

El agente recibe el aviso «Te asignaron un lead» (salvo que te lo asignes a vos). Solo se puede elegir usuarios activos del equipo. El cambio queda en la auditoría.

Al cargar un lead nuevo (**Nuevo lead**), con `leads.assign` aparece **Asignar a**; si lo dejás **Sin asignar** y el lead tiene una propiedad con responsable, se asigna a ese responsable. Sin `leads.assign`, el formulario muestra «Queda asignado a vos.» y no podés asignárselo a otra persona.

Los leads del sitio se asignan solos al responsable de la propiedad consultada; si no hay responsable, quedan sin asignar y en el tablero cuentan en «Sin asignar». Para encontrarlos: **Leads** → **Filtros** → **Asignado: Sin asignar**.

## Asignar una oportunidad a un agente
<!-- ruta: /crm/pipeline/[id]; permisos: opportunities.assign -->

Para cambiar el responsable de una oportunidad del pipeline:

1. Abrí la oportunidad desde **Pipeline**.
2. En la tarjeta **Responsable**, elegí al agente o **Sin asignar**.
3. Tocá **Asignar**.

El agente recibe el aviso «Te asignaron una oportunidad». Solo se eligen usuarios activos.

Al crear una oportunidad (**Nueva oportunidad**), con `opportunities.assign` aparece el campo **Responsable**. Sin ese permiso, la oportunidad queda a tu nombre, o, si la creás desde un lead, puede respetar el asignado del lead solo si ves todas las oportunidades. Con los roles de fábrica, `opportunities.assign` lo tienen Super Admin, Dirección y Administrador; un Agente no puede pasarle una oportunidad a otra persona.

## Qué ve un agente: alcance propio o de todo el equipo
<!-- ruta: /crm/leads; permisos: leads.read_own, leads.read_all -->

El CRM separa «lo mío» de «todo» con pares de permisos, y lo controla siempre en el servidor:

- **Leads**: con `leads.read_all` ve todos; con `leads.read_own` solo los asignados a él («… leads asignados a vos») y el tablero muestra **Mis leads**.
- **Pipeline**: `opportunities.read_all` o `opportunities.read_own` («… oportunidades a tu cargo»).
- **Agenda**: `agenda.read_all` o `agenda.manage` (solo citas asignadas a él o creadas por él).
- **Tareas**: `tasks.read_all` o `tasks.manage` (asignadas o creadas por él).
- **Conversaciones**: sin `leads.read_all`, solo las asignadas a él, las que todavía atiende el bot sin asignar, las de sus leads y las de sus contactos.

Si un agente abre el link de un registro fuera de su alcance, el CRM responde como si no existiera. En cambio, **Propiedades** y **Contactos** no se filtran por agente: con `properties.read` y `contacts.read` ve todas. El rol Agente trae los permisos «propios»; Administrador, Dirección y Super Admin, los de «todos».

## Agendar citas y asignar tareas a otra persona
<!-- ruta: /crm/agenda/nueva; permisos: agenda.read_all, tasks.read_all -->

Quién puede cargar trabajo a nombre de otro depende del alcance:

- **Citas y visitas**: con `agenda.read_all` podés agendar para otra persona o pasar una cita a otro responsable al reprogramarla. Con solo `agenda.manage`, las citas quedan a tu nombre; si intentás otra persona: «No podés agendar para otra persona» o «No podés pasar la cita a otra persona».
- **Tareas**: con `tasks.read_all` podés asignar tareas a cualquier usuario activo; con solo `tasks.manage`: «No podés asignar tareas a otra persona».

Quien recibe la cita ve el aviso «… agendada para vos» (y «Cita reprogramada» si cambia), y quien recibe la tarea, «Nueva tarea asignada». Con los roles de fábrica, Super Admin, Dirección y Administrador tienen ambos permisos amplios; Agente y Alquileres solo gestionan lo propio. Solo lectura puede ver todo, pero no crear citas ni tareas.
