---
dominio: crm
titulo: Uso general del CRM
resumen: Qué es el CRM, cómo ingresar y recuperar la contraseña, el menú, el tablero, la búsqueda global, los avisos, Mi cuenta y el uso desde el celular.
permisos:
---

## Qué es el CRM de Lucio López Fleming
<!-- ruta: /crm -->

El CRM es el sistema interno del equipo de la inmobiliaria. Desde ahí se cargan y publican propiedades (inmuebles, fichas, avisos), se atienden los leads y consultas, se lleva el pipeline de oportunidades, la agenda de visitas, las tareas, las conversaciones de WhatsApp, los contratos de alquiler con sus cobros y liquidaciones, el contenido de marketing, los portales, las integraciones y los usuarios del equipo.

Cada persona entra con su propio usuario y ve solo lo que habilitan sus roles (Super Admin, Dirección, Administrador, Agente, Alquileres, Marketing o Solo lectura). Las secciones que no te corresponden no aparecen en el menú, y aunque escribas la dirección a mano, el servidor vuelve a controlar el permiso en cada pantalla y en cada acción.

Todo cambio importante (precios, estados, publicación, usuarios) queda registrado en la auditoría con quién lo hizo y cuándo. El CRM está en `/crm`; el sitio público de la inmobiliaria es otra parte del sistema.

## Ingresar al CRM
<!-- ruta: /crm/login -->

Para entrar al CRM:

1. Abrí `/crm/login`.
2. Completá **Email** y **Contraseña**.
3. Tocá **Ingresar**.

Si ya tenías la sesión abierta, la pantalla de ingreso te lleva directo al **Tablero**. Si llegaste desde un link a una sección interna, después de ingresar volvés a esa sección.

Mensajes posibles:
- «Email o contraseña incorrectos.»: revisá los datos.
- «Demasiados intentos. Esperá 15 minutos o restablecé tu contraseña.»: después de 5 intentos fallidos la cuenta queda bloqueada 15 minutos.
- «Tu usuario está desactivado. Consultá con administración.»: alguien con permiso de gestionar usuarios te desactivó.
- «Demasiados intentos desde esta conexión. Probá más tarde.»: límite por conexión (red).

Si todavía no definiste tu contraseña (te invitaron y no usaste el link), no vas a poder ingresar: pedí que te reenvíen la invitación.

## Recuperar la contraseña olvidada
<!-- ruta: /crm/recuperar -->

Si te olvidaste la clave:

1. En la pantalla de ingreso tocá **Olvidé mi contraseña** (o abrí `/crm/recuperar`).
2. Escribí el email con el que entrás al CRM.
3. Tocá **Enviarme el link**.
4. Abrí el email y seguí el link: te lleva a `/crm/restablecer`.
5. Completá **Contraseña nueva** y **Repetí la contraseña** y tocá **Restablecer contraseña**.
6. Tocá **Ingresar al CRM** y entrá con la clave nueva.

El CRM siempre responde lo mismo, exista o no el email (por seguridad). El link vence en 1 hora y sirve una sola vez; revisá también la carpeta de spam. Hay un límite de 3 pedidos por hora por email. Al restablecer se cierran todas tus sesiones abiertas.

La recuperación solo funciona para cuentas que ya tienen contraseña. Una cuenta con invitación pendiente se activa únicamente con la invitación: si venció, la tiene que reenviar quien gestiona usuarios. Si el link «venció, ya se usó o no es válido», tocá **Pedir un link nuevo**.

## Activar la cuenta con el link de invitación
<!-- ruta: /crm/restablecer -->

Cuando alguien del equipo te invita, recibís un email con un link para definir tu contraseña. El link lleva a `/crm/restablecer` con el aviso «Te invitaron al CRM. Definí tu contraseña para ingresar.».

1. Abrí el link del email.
2. Completá **Contraseña nueva** (mínimo 10 caracteres, con letras y números) y **Repetí la contraseña**.
3. Tocá **Definir contraseña**.
4. Cuando aparezca «¡Listo! Tu contraseña quedó definida.», tocá **Ingresar al CRM**.

La invitación vence a las 72 horas y el link es de un solo uso. Si venció, no podés usar «Olvidé mi contraseña»: pedile a quien gestiona usuarios que tome **Reenviar invitación** en tu ficha de usuario.

## Moverse por el menú lateral
<!-- ruta: /crm -->

El menú del CRM está a la izquierda en computadora (y detrás del botón **Menú** en celular). Cada acceso tiene un ícono y se agrupa por área:

- Operación: **Tablero**, **Propiedades**, **Contactos**, **Agenda**, **Tareas**.
- Comercial: **Leads**, **Pipeline**, **Conversaciones**.
- Alquileres: **Contratos**, **Cobros**, **Liquidaciones**, **Índices**, **Informes**.
- Marketing: **Contenido**, **Portales**.
- Sistema: **Automatizaciones**, **Integraciones**, **Migración**, **Usuarios**, **Auditoría**, **Jobs**.

El ítem de la sección donde estás aparece resaltado. Arriba, en la barra superior, tenés el buscador («Buscar propiedad o contacto…»), **Avisos** (con la cantidad sin leer), **Cuenta** y **Salir**. Tocando el nombre de la inmobiliaria arriba del menú volvés al Tablero.

## Por qué no veo una sección en el menú
<!-- ruta: /crm -->

El menú se arma según tus permisos: cada acceso aparece solo si tu rol tiene el permiso que lo habilita. Por ejemplo, **Propiedades** requiere `properties.read`; **Leads**, `leads.read_own` o `leads.read_all`; **Pipeline**, `opportunities.read_own` o `opportunities.read_all`; **Agenda**, `agenda.manage` o `agenda.read_all`; **Tareas**, `tasks.manage` o `tasks.read_all`; **Portales**, `publications.manage`; **Usuarios**, `users.read`; **Auditoría**, `audit.read`; **Jobs** y **Automatizaciones**, `automations.read`.

Si abrís una sección sin permiso (por ejemplo desde un link), el CRM te devuelve al Tablero con el aviso «No tenés permiso para la sección a la que intentaste entrar.». Si tu rol ni siquiera incluye el tablero, ves «Tu rol no incluye el tablero. Usá el menú para ir a tus secciones.».

Los roles no los cambia cada persona: los administra quien gestiona usuarios, desde **Usuarios**. Podés ver tus roles en **Cuenta**.

## Usar el tablero de inicio
<!-- ruta: /crm; permisos: dashboard.read -->

El **Tablero** (`/crm`) es la pantalla de inicio. Muestra indicadores reales de la base, sin estimaciones, en bloques:

- **Propiedades**: Total, Publicadas, Altas en el período y cantidad por estado (cada estado es un link al listado filtrado). No cuenta la propiedad DEMO.
- **Leads** o **Mis leads**: Nuevos en el período, Sin responder, Fuera de SLA (minutos configurados; 120 si no hay configuración) y, si ves todos los leads, Sin asignar.
- **Visitas próximas (7 días)**: las próximas visitas programadas o confirmadas, con la propiedad y el responsable.
- **Tareas vencidas**: Mías y, según permisos, Todo el equipo, con tus tareas vencidas.
- **Contratos por vencer**: contratos activos que vencen dentro del plazo de aviso (60 días si no hay otro configurado).
- **Salud del sistema**: jobs muertos, reintentando o demorados, advertencias de migración e integraciones con error.

Cada bloque tiene un acceso directo («Ver todas», «Ir a leads», «Agenda», «Tareas», «Contratos»). Si no hay propiedades y podés crear, aparece **Cargar propiedad**.

## Filtrar el tablero por sucursal y fechas
<!-- ruta: /crm; permisos: dashboard.read -->

Arriba del tablero hay un formulario de filtros:

1. En **Sucursal** elegí una sucursal o dejá **Todas**.
2. En **Desde** y **Hasta** elegí el período (por defecto, los últimos 30 días, en horario de Salta).
3. Tocá **Aplicar**.

Para volver al estado inicial tocá **Últimos 30 días**. Si ponés las fechas al revés, el CRM las invierte solo.

Qué afecta cada filtro: la sucursal filtra propiedades, leads, visitas y contratos; el período solo cambia las altas de propiedades y los leads nuevos. Los demás indicadores (sin responder, fuera de SLA, visitas de los próximos 7 días, tareas vencidas, contratos por vencer, salud del sistema) muestran siempre la situación actual.

## Qué bloques del tablero ve cada rol
<!-- ruta: /crm; permisos: dashboard.read -->

Cada bloque del tablero aparece solo si tenés el permiso correspondiente:

- **Propiedades**: `properties.read`.
- **Leads**: con `leads.read_all` ves todos (con «Sin asignar»); con `leads.read_own` el bloque se llama **Mis leads** y cuenta solo los asignados a vos.
- **Visitas próximas**: con `agenda.read_all` ves las de todo el equipo; con `agenda.manage`, solo las tuyas («· mías»).
- **Tareas vencidas**: requiere `tasks.manage`; el contador «Todo el equipo» se muestra además con `agenda.read_all`.
- **Contratos por vencer**: `rentals.read`.
- **Salud del sistema**: jobs con `automations.read`, advertencias de migración con `migration.read` e integraciones con `integrations.read`.

Con los roles de fábrica: Super Admin, Dirección y Administrador ven todo; Agente ve Propiedades, Mis leads, sus visitas y sus tareas; Alquileres ve Propiedades, sus visitas, sus tareas y Contratos; Marketing ve solo Propiedades; Solo lectura ve Propiedades, todos los leads, todas las visitas, Contratos, jobs e integraciones.

## Buscar una propiedad o un contacto desde cualquier pantalla
<!-- ruta: /crm/buscar; permisos: properties.read, contacts.read -->

La búsqueda global encuentra propiedades y contactos a la vez:

1. En computadora, escribí en el buscador de la barra superior («Buscar propiedad o contacto…») y apretá Enter. En celular tocá **Buscar** arriba a la derecha.
2. En `/crm/buscar` escribí en «Código, título, nombre, email o teléfono» y tocá **Buscar**.

Qué busca:
- **Propiedades**: por código (con o sin `#`), título, calle o texto de la descripción. Si coincide el código exacto, esa propiedad aparece primero. Muestra el estado y si está **Publicada**.
- **Contactos**: por nombre, email o teléfono (con al menos 6 dígitos). No muestra contactos fusionados.

Escribí al menos 2 caracteres (o un código numérico). Trae hasta 20 resultados por grupo. La búsqueda no distingue tildes ni mayúsculas. Solo ves los grupos que tu rol permite: propiedades con `properties.read` y contactos con `contacts.read`. Hoy la búsqueda global no incluye leads, oportunidades ni contratos: esos se buscan dentro de su propia sección.

## Ver y marcar los avisos
<!-- ruta: /crm/notificaciones -->

Los avisos (notificaciones internas) están en **Avisos**, en la barra superior; el número al lado indica cuántos tenés sin leer.

1. Tocá **Avisos** (abre `/crm/notificaciones`).
2. Elegí **Todas** o **Sin leer**.
3. Tocá el título de un aviso para ir a lo que corresponde (lead, cita, oportunidad, conversación…).
4. Tocá **Marcar leída** en un aviso, o **Marcar todas como leídas** arriba.

Los avisos sin leer tienen borde oscuro y un punto de color. Se muestran de a 30 por página, del más nuevo al más viejo. Cada persona ve y marca solo los suyos: marcar un aviso como leído no lo cambia para el resto del equipo. Si no tenés pendientes, la pantalla dice «Estás al día.». Hoy el CRM no permite borrar avisos ni configurar cuáles recibir.

## Qué situaciones generan un aviso
<!-- ruta: /crm/notificaciones -->

El CRM te deja un aviso en **Avisos** cuando pasa algo que te toca. Según el código actual, los avisos llegan cuando:

- «Te asignaron un lead» (si te lo asigna otra persona).
- «Te asignaron una oportunidad».
- «Nueva tarea asignada».
- Una cita se agenda para vos («… agendada para vos») o se reprograma («Cita reprogramada»).
- «Nuevo mensaje de WhatsApp» en una conversación atendida por una persona y asignada a vos.
- «Pedido de visita por WhatsApp» (al responsable asignado o, si no hay, al rol Administrador).
- «Borradores de redes para revisar · código …» (al rol Marketing, cuando se publica una propiedad).
- Una tarea automática del sistema falla definitivamente («Tarea automática fallida: …»).
- Una automatización activa envía un aviso; las de fábrica son «Nuevo lead» (al asignado o, si no hay, a Administrador), «Contrato por vencer» y «Ajuste de alquiler para revisar» (a Alquileres) e «Integración con fallas» (a Administrador).

Los avisos dirigidos al rol Administrador también les llegan a los Super Admin. La bandeja de Avisos es interna del CRM; los emails internos (por ejemplo, el aviso de lead nuevo por email) son un envío aparte.

## Cambiar mi contraseña
<!-- ruta: /crm/cuenta -->

Para cambiar tu contraseña estando dentro del CRM:

1. Tocá **Cuenta** en la barra superior (abre **Mi cuenta**, `/crm/cuenta`).
2. En **Cambiar contraseña** completá **Contraseña actual**.
3. Escribí la **Contraseña nueva**: mínimo 10 caracteres y tiene que combinar letras y números.
4. Repetila en **Repetí la contraseña nueva**.
5. Tocá **Cambiar contraseña**.

Cuando sale «Contraseña actualizada. Se cerraron tus otras sesiones.», la sesión de este dispositivo sigue abierta y las de otros dispositivos se cierran. Si la contraseña actual es incorrecta o la nueva no cumple las reglas, el error aparece debajo del campo.

Si el sistema te pide cambiar la contraseña («Antes de seguir tenés que cambiar tu contraseña.»), no vas a poder usar otras secciones hasta hacerlo; al terminar vas directo al Tablero.

## Ver mis roles y datos de Mi cuenta
<!-- ruta: /crm/cuenta -->

En **Cuenta** (`/crm/cuenta`) ves tu nombre y email arriba, el formulario para cambiar la contraseña y la tarjeta **Accesos**, que lista tus roles (por ejemplo «Agente» o «Administrador»), o «sin roles asignados».

Desde Mi cuenta no podés cambiar tu nombre, teléfono, WhatsApp, roles ni sucursales: «Los roles y sucursales los administra quien gestiona usuarios.». Para corregir esos datos pedíselo a alguien con permiso `users.manage`, que lo hace desde **Usuarios** en tu ficha de usuario. Hoy el CRM tampoco tiene foto de perfil ni preferencias personales.

## Cerrar sesión y duración de la sesión
<!-- ruta: /crm -->

Para salir, tocá **Salir** en la barra superior: se cierra la sesión de ese dispositivo y volvés a `/crm/login`.

La sesión se mantiene abierta mientras la uses, pero nunca más de 14 días desde el ingreso: pasado ese plazo tenés que volver a ingresar. Además, la sesión se cierra sola si:

- cambiás tu contraseña desde otro dispositivo (se cierran las demás sesiones),
- restablecés la contraseña con «Olvidé mi contraseña» (se cierran todas),
- alguien con permiso te desactiva el usuario.

En una computadora compartida, tocá siempre **Salir** al terminar.

## Usar el CRM desde el celular
<!-- ruta: /crm -->

El CRM funciona en el navegador del teléfono, sin instalar nada. Diferencias en pantalla chica:

- El menú lateral se oculta: tocá **Menú** arriba a la izquierda para abrirlo y **Cerrar** para ocultarlo. Al elegir una sección se cierra solo.
- El buscador de la barra se reemplaza por el botón **Buscar**, que abre `/crm/buscar`.
- El listado de **Propiedades** se muestra como tarjetas con foto, código, estado y precio en lugar de tabla.
- En la ficha de una propiedad, la barra de secciones (Datos, Precios, Estado, Multimedia, Tour 360°…) queda fija arriba y se desliza de costado.
- En **Multimedia** podés tocar **Elegir archivos** y subir fotos directo desde la cámara o la galería del teléfono.
- Los formularios largos (por ejemplo, alta de propiedad) tienen los botones de guardar fijos abajo.

Hoy no existe una app nativa del CRM para Android o iPhone.
