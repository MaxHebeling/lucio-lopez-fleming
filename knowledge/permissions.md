---
dominio: permissions
titulo: Roles y permisos
resumen: Qué puede hacer cada uno de los 7 roles del CRM en la práctica, alcance propio o de todo el equipo, por qué no ves un menú o te dice «sin permiso», el cambio de contraseña obligatorio y quién cambia roles.
permisos:
---

## Cómo funcionan los roles y los permisos
<!-- ruta: /crm/cuenta -->

Cada usuario del equipo tiene uno o más **roles**, y cada rol trae un conjunto fijo de **permisos** (por ejemplo `properties.publish` para publicar o `leads.read_all` para ver todos los leads). Si tenés varios roles, sumás los permisos de todos.

Los 7 roles son: **Super Admin**, **Dirección**, **Administrador**, **Agente**, **Alquileres**, **Marketing** y **Solo lectura**.

Reglas generales:
- El menú lateral muestra solo las secciones que tus permisos habilitan.
- Ocultar un botón no es la única protección: el servidor vuelve a verificar el permiso en cada pantalla y en cada acción, aunque escribas la dirección a mano.
- **Super Admin** tiene todos los permisos, incluidos los que se agreguen en el futuro.
- Tus roles se ven en **Mi cuenta** (`/crm/cuenta`), tarjeta **Accesos**.

Hoy el CRM no permite crear roles nuevos ni cambiar qué permisos trae cada rol desde pantalla: la matriz viene definida por el sistema. Lo que sí se puede cambiar es qué roles tiene cada persona (ver «Cambiar los roles de un usuario»).

## Qué puede hacer el rol Super Admin
<!-- ruta: /crm/usuarios -->

**Super Admin** tiene acceso total: ve todas las secciones del menú y puede hacer cualquier acción del CRM.

Es el único rol con `roles.manage`, que en la práctica permite:
- Asignar o quitar el rol **Super Admin** a otra persona.
- Asignar o quitar cualquier rol aunque incluya permisos que uno mismo no tenga.

También puede aprobar y marcar pagadas liquidaciones (`settlements.approve`) y anular cobros (`rentals.void_payment`), dos permisos que fuera de Super Admin solo tiene Dirección.

Límites que aplican incluso a Super Admin:
- No podés quitarte a vos mismo el rol Super Admin («No podés quitarte el rol Super Admin a vos mismo»).
- Tiene que quedar al menos un Super Admin activo («Tiene que quedar al menos un Super Admin activo»).
- No podés desactivar tu propio usuario.

Los avisos dirigidos a administración (lead sin asignar, job muerto, integración con fallas) le llegan a Super Admin además de a Administrador.

## Qué puede hacer el rol Dirección
<!-- ruta: /crm -->

**Dirección** tiene la visión completa del negocio: todos los permisos del sistema **menos** `roles.manage`.

En la práctica:
- Ve todas las secciones del menú: Tablero, Propiedades, Contactos, Agenda, Tareas, Leads, Pipeline, Conversaciones, Contratos, Cobros, Liquidaciones, Índices, Informes, Contenido, Portales, Automatizaciones, Integraciones, Migración, Usuarios, Auditoría y Jobs.
- Ve y gestiona todo lo del equipo: todos los leads, oportunidades, agenda y tareas.
- Publica propiedades, cambia precios y estados, asigna agentes.
- Aprueba liquidaciones y anula cobros (junto con Super Admin, los únicos que pueden).
- Invita, edita y desactiva usuarios; enciende feature flags; reintenta jobs; revisa la migración.

Lo que no puede: asignar o quitar el rol **Super Admin**. Todos los demás roles sí los puede asignar, porque tiene todos sus permisos.

Ojo: los avisos automáticos «a administración» van a los roles Administrador y Super Admin, no a Dirección.

## Qué puede hacer el rol Administrador
<!-- ruta: /crm -->

**Administrador** lleva la operación diaria: propiedades, contactos, usuarios e integraciones. Tiene todos los permisos **menos** tres:
- `roles.manage` (gestionar roles).
- `settlements.approve` (aprobar y marcar pagadas las liquidaciones).
- `rentals.void_payment` (anular cobros).

En la práctica ve todo el menú (igual que Dirección) y puede: cargar, editar, publicar y despublicar propiedades, cambiar precio y estado, asignar agentes; ver y asignar todos los leads y oportunidades; ver la agenda y las tareas de todo el equipo; responder conversaciones; crear contratos, registrar cobros, calcular ajustes y generar liquidaciones; aprobar contenido y gestionar portales; invitar y desactivar usuarios; encender o apagar feature flags; reintentar jobs; revisar la auditoría y la migración.

Al asignar roles, un Administrador puede dar Administrador, Agente, Alquileres, Marketing y Solo lectura, pero **no** Dirección ni Super Admin (incluyen permisos que no tiene).

Recibe los avisos de administración: leads sin asignar, jobs muertos, integraciones con fallas y conversaciones derivadas sin responsable.

## Qué puede hacer el rol Agente
<!-- ruta: /crm/leads -->

**Agente** trabaja sus propios leads, oportunidades, agenda y conversaciones.

Menú: Tablero, Propiedades, Contactos, Agenda, Tareas, Leads, Pipeline y Conversaciones.

Puede:
- Ver **todas** las propiedades, crearlas (**Nueva propiedad**), editar sus datos y gestionar fotos, videos y planos.
- Ver, crear y editar contactos.
- Ver solo los **leads asignados a él**, cargar leads (quedan asignados a quien los carga) y actualizarlos.
- Ver y mover solo **sus** oportunidades en el pipeline.
- Agendar visitas, llamadas y reuniones propias y manejar sus tareas.
- Ver y responder conversaciones de WhatsApp dentro de su alcance.

No puede: publicar o despublicar propiedades, cambiar precios ni estados (reservar, vender, pausar), asignar agentes a propiedades, asignar leads u oportunidades a otros, ver datos privados (propietarios, documentos de identidad), fusionar contactos duplicados, ni entrar a alquileres, marketing, portales, usuarios o secciones de sistema. Para publicar o cambiar un precio, pedíselo a un Administrador o a Dirección.

## Qué puede hacer el rol Alquileres
<!-- ruta: /crm/alquileres -->

**Alquileres** gestiona contratos, cobros, ajustes y liquidaciones.

Menú: Tablero, Propiedades, Contactos, Agenda, Tareas, Contratos, Cobros, Liquidaciones, Índices e Informes.

Puede:
- Ver propiedades con sus datos privados (propietarios y documentos).
- Ver, crear y editar contactos, incluidos documentos de identidad y datos sensibles.
- Crear y editar contratos (**Nuevo contrato**), registrar cobros, calcular y aplicar ajustes, cargar índices manuales (IPC, Casa Propia) y generar liquidaciones.
- Ver informes y generarlos o enviarlos a propietarios.
- Agendar y manejar sus propias tareas y citas.

No puede: aprobar ni marcar pagadas liquidaciones, ni anular cobros (eso queda para Dirección y Super Admin); tampoco ve Leads, Pipeline ni Conversaciones, ni publica o edita propiedades.

Recibe los avisos automáticos «Contrato por vencer» y «Ajuste de alquiler para revisar», que van a todos los usuarios con este rol.

## Qué puede hacer el rol Marketing
<!-- ruta: /crm/marketing -->

**Marketing** maneja contenido, campañas y publicaciones.

Menú: Tablero, Propiedades, Contenido, Portales e Informes.

Puede:
- Ver propiedades y gestionar sus fotos, videos y planos.
- Ver el contenido de redes, crear borradores, aprobarlos y programarlos (`marketing.read`, `marketing.create`, `marketing.approve`).
- Gestionar la publicación en portales (`/crm/publicaciones`): habilitar o deshabilitar canales y reintentar sincronizaciones.
- Ver informes.

No puede: editar los datos de una propiedad, publicarla o despublicarla en el sitio, cambiar precios o estados, ni ver contactos, leads, conversaciones, alquileres o secciones de sistema. Si una propiedad necesita estar publicada para aparecer en portales o redes, la publica un Administrador o Dirección.

## Qué puede hacer el rol Solo lectura
<!-- ruta: /crm -->

**Solo lectura** consulta sin modificar.

Menú: Tablero, Propiedades, Contactos, Agenda, Tareas, Leads, Pipeline, Contratos, Cobros, Liquidaciones, Índices, Informes, Contenido, Automatizaciones, Integraciones y Jobs.

Puede ver:
- Todas las propiedades y contactos (sin datos privados).
- **Todos** los leads, oportunidades, la agenda y las tareas del equipo.
- Contratos de alquiler, informes y contenido de marketing.
- El estado de automatizaciones, jobs, integraciones y feature flags.

No puede crear, editar, publicar, asignar, reintentar ni encender nada: los botones de acción no aparecen y, si intenta una acción, el servidor responde «No tenés permiso para esta acción». Tampoco ve Conversaciones, Portales, Migración, Usuarios ni Auditoría.

## Quién puede hacer las acciones sensibles
<!-- ruta: /crm/propiedades/[id] -->

Resumen de acciones que suelen generar dudas (Super Admin puede todas):

- **Publicar o despublicar una propiedad** (`properties.publish`): Dirección y Administrador.
- **Cambiar precio** (`properties.change_price`) y **cambiar estado** (`properties.change_status`: reservar, vender, alquilar, pausar, archivar): Dirección y Administrador.
- **Asignar agente responsable y de apoyo** (`properties.assign_agents`): Dirección y Administrador.
- **Ver propietarios y documentos** (`properties.read_private`, `contacts.read_private`): Dirección, Administrador y Alquileres.
- **Fusionar contactos duplicados** (`contacts.merge`): Dirección y Administrador.
- **Asignar leads** (`leads.assign`) y **oportunidades** (`opportunities.assign`): Dirección y Administrador.
- **Registrar cobros**, **ajustes** y **generar liquidaciones**: Dirección, Administrador y Alquileres.
- **Anular cobros** y **aprobar liquidaciones**: solo Dirección.
- **Aprobar contenido de redes** y **gestionar portales**: Dirección, Administrador y Marketing.
- **Invitar o desactivar usuarios** (`users.manage`), **feature flags** (`integrations.manage`), **reintentar jobs y activar automatizaciones** (`automations.manage`), **revisar migración** (`migration.review`): Dirección y Administrador.
- **Ver auditoría** (`audit.read`): Dirección y Administrador.

## Ver solo lo propio o todo el equipo
<!-- ruta: /crm/leads -->

En Leads, Pipeline, Agenda y Tareas el CRM decide en el servidor si ves **lo tuyo** o **lo de todos**:

- **Leads**: con `leads.read_all` (Dirección, Administrador, Solo lectura) ves todos; con solo `leads.read_own` (Agente) ves únicamente los leads **asignados a vos**. El encabezado dice «N leads asignados a vos» y no aparece el filtro **Asignado**.
- **Pipeline**: `opportunities.read_all` ve todas; `opportunities.read_own` solo las asignadas a vos.
- **Agenda**: `agenda.read_all` ve la agenda del equipo (con la vista **Equipo** y el filtro **Agente**); con solo `agenda.manage` ves las citas asignadas a vos o que cargaste vos.
- **Tareas**: `tasks.read_all` ve las del equipo (con `tasks.manage` además aparecen las vistas **Mías** y **Equipo**); con solo `tasks.manage` ves las asignadas a vos y las sin asignar que creaste vos, y no podés asignar tareas a otra persona.

Si abrís un lead, oportunidad, cita o tarea fuera de tu alcance (por ejemplo desde un link que te pasaron), el CRM responde como si no existiera (página «no encontrado»): no confirma que el registro exista. Propiedades y contactos no tienen alcance propio: quien tiene permiso de verlos ve todos.

## Qué conversaciones de WhatsApp ve cada uno
<!-- ruta: /crm/conversaciones; permisos: conversations.read -->

Las conversaciones requieren `conversations.read` (Super Admin, Dirección, Administrador y Agente). Responder, tomar, devolver o cerrar requiere `conversations.reply`.

El alcance depende de `leads.read_all`:
- **Con** `leads.read_all` (Dirección, Administrador): ves todas las conversaciones.
- **Sin** ese permiso (Agente): ves solo las conversaciones que
  1. están asignadas a vos,
  2. están sin asignar y todavía las atiende el asistente de IA (cualquiera del equipo puede tomarlas),
  3. están vinculadas a un lead asignado a vos, o
  4. son de un contacto asignado a vos.

Una conversación fuera de tu alcance se responde como inexistente. Si necesitás ver una que no te aparece, pedile a un Administrador que te asigne el lead o el contacto. El rol Solo lectura no ve Conversaciones.

## Por qué no veo un menú o una sección
<!-- ruta: /crm -->

El menú lateral se arma con tus permisos: cada sección exige uno. Si no ves una sección es porque ninguno de tus roles la habilita. Permisos por sección:

- Tablero `dashboard.read` · Propiedades `properties.read` · Contactos `contacts.read`.
- Agenda `agenda.manage` o `agenda.read_all` · Tareas `tasks.manage` o `tasks.read_all`.
- Leads `leads.read_own` o `leads.read_all` · Pipeline `opportunities.read_own` o `opportunities.read_all`.
- Conversaciones `conversations.read`.
- Contratos, Cobros, Liquidaciones e Índices `rentals.read` · Informes `reports.read`.
- Contenido `marketing.read` · Portales `publications.manage`.
- Automatizaciones y Jobs `automations.read` · Integraciones `integrations.read` · Migración `migration.read` · Usuarios `users.read` · Auditoría `audit.read`.

**Avisos**, **Cuenta** y **Buscar** están siempre arriba para todo el equipo. Si creés que te falta un acceso, revisá tus roles en **Mi cuenta** y pedile el cambio a quien gestiona usuarios. Dentro de una pantalla también pueden faltar botones (por ejemplo **Publicar**) aunque veas la sección: cada acción tiene su propio permiso.

## Qué significa «No tenés permiso»
<!-- ruta: /crm -->

Hay tres mensajes distintos:

1. **«No tenés permiso para la sección a la que intentaste entrar.»**: aparece en el **Tablero** (`/crm?sin-permiso=1`) cuando abriste una pantalla que tus roles no habilitan, por ejemplo escribiendo la dirección a mano o siguiendo un link. El CRM te devuelve al tablero en lugar de mostrarla.
2. **«No tenés permiso para esta acción»**: aparece al tocar un botón o guardar un formulario cuya acción tu rol no incluye. No se guardó nada.
3. **Página «no encontrado»**: en leads, oportunidades, citas, tareas y conversaciones puede significar que el registro existe pero está fuera de tu alcance (asignado a otra persona). Por seguridad el CRM no distingue entre «no existe» y «no es tuyo».

Mensajes más específicos, como «No podés asignar leads a otra persona» o «No podés asignar tareas a otra persona», indican que te falta el permiso de asignar. Si necesitás el acceso, pedile a un Administrador o a Dirección que revise tus roles en `/crm/usuarios/[id]`.

## Cambio de contraseña obligatorio
<!-- ruta: /crm/cuenta -->

Si tu usuario tiene marcado el cambio de contraseña obligatorio, al entrar a cualquier pantalla del CRM te lleva a **Mi cuenta** (`/crm/cuenta?cambiar=1`) con el aviso «Antes de seguir tenés que cambiar tu contraseña.».

Mientras no la cambies no podés ejecutar ninguna acción del CRM (solo cambiar la contraseña o salir): cualquier otra devuelve «Antes de continuar tenés que cambiar tu contraseña (Mi cuenta).».

1. En la tarjeta **Cambiar contraseña** completá **Contraseña actual**.
2. Escribí la **Contraseña nueva**: mínimo 10 caracteres, con letras y números, y distinta de la actual.
3. Repetila en **Repetí la contraseña nueva**.
4. Tocá **Cambiar contraseña**.

Al guardar, el CRM te lleva al **Tablero**, se cierran tus otras sesiones abiertas y queda registrado como «Cambió su contraseña» en la auditoría. Restablecer la contraseña por link (recuperación o invitación) también quita la marca.

## Cambiar los roles de un usuario
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Cambiar roles requiere `users.manage` (Super Admin, Dirección, Administrador). No hay otra pantalla para esto.

1. Entrá a **Usuarios** (`/crm/usuarios`) y buscá a la persona por nombre o email (podés filtrar por **Rol** y **Estado**).
2. Abrí su ficha (`/crm/usuarios/[id]`).
3. En la tarjeta **Roles y sucursales**, marcá o desmarcá los roles.
4. Tocá **Guardar roles**. Aparece «Roles actualizados.».

Reglas:
- Tiene que quedar al menos un rol; con ninguno marcado el botón no se habilita («Elegí al menos un rol»).
- Los roles que no podés asignar aparecen deshabilitados con la leyenda «Solo lo asigna quien gestiona roles.».
- El cambio rige desde la próxima pantalla que abra esa persona; no hace falta que vuelva a ingresar.
- Queda en la auditoría como `USER_ROLES_CHANGED` («Roles cambiados» en el **Historial** de la ficha).

Quien solo tiene `users.read` ve los roles en texto, sin poder cambiarlos. Tus propios roles los ves en **Mi cuenta**, tarjeta **Accesos**.

## Qué roles puede asignar cada uno
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage, roles.manage -->

Además de `users.manage`, el CRM controla que nadie dé más permisos de los que tiene:

- **Con `roles.manage`** (solo Super Admin): puede asignar o quitar cualquier rol, incluido **Super Admin**.
- **Sin `roles.manage`**: solo puede asignar o quitar un rol si ya tiene **todos** los permisos de ese rol, y nunca Super Admin.

En la práctica:
- **Dirección** asigna Dirección, Administrador, Agente, Alquileres, Marketing y Solo lectura.
- **Administrador** asigna Administrador, Agente, Alquileres, Marketing y Solo lectura, pero no Dirección (incluye aprobar liquidaciones y anular cobros) ni Super Admin.

Si lo intentás igual, el mensaje es «No podés asignar o quitar el rol "…": incluye permisos que vos no tenés» o «Solo quien gestiona roles puede asignar o quitar Super Admin». La misma regla aplica al **invitar** un usuario (`/crm/usuarios/invitar`) y al **desactivar o reactivar** a alguien: no podés desactivar a una persona que tiene un rol que vos no podrías asignar.

## Sucursales de un usuario
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Además de roles, cada usuario puede tener una o más sucursales (oficinas) asignadas.

1. Abrí la ficha del usuario en `/crm/usuarios/[id]`.
2. En **Roles y sucursales**, bloque **Sucursales**, marcá las que correspondan.
3. Tocá **Guardar sucursales**. Aparece «Sucursales actualizadas.».

Se puede dejar sin sucursales. Si no hay sucursales activas cargadas verás «No hay sucursales activas.». El cambio queda auditado como `USER_BRANCHES_CHANGED`.

Importante: hoy las sucursales **no restringen** qué datos ve la persona. El alcance de lo que ves lo definen los roles (propio o de todo el equipo), no la sucursal. En el **Tablero** el filtro **Sucursal** sirve para mirar números de una oficina, pero no limita permisos. La columna **Sucursales** también aparece en la lista de `/crm/usuarios`.

## Quitar el acceso a una persona
<!-- ruta: /crm/usuarios/[id]; permisos: users.manage -->

Para que alguien deje de entrar al CRM no se borra el usuario: se desactiva.

1. Entrá a `/crm/usuarios/[id]` de esa persona.
2. Tocá **Desactivar** (arriba a la derecha).
3. Confirmá «¿Desactivar a …? Se cierran todas sus sesiones y no podrá ingresar.».

Efectos: se cierran todas sus sesiones al instante; si intenta ingresar ve «Tu usuario está desactivado. Consultá con administración.»; deja de recibir avisos por rol; su nombre y WhatsApp dejan de mostrarse como asesor en el sitio público. Queda auditado como «Desactivado».

Para devolverle el acceso tocá **Reactivar** en la misma ficha. No podés desactivarte a vos mismo, no podés desactivar al último Super Admin activo y no podés desactivar a alguien con un rol que vos no podrías asignar. Quitar un rol (en vez de desactivar) sirve para recortar accesos sin cortar el ingreso.
