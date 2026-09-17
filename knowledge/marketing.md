---
dominio: marketing
titulo: Contenido para redes y portales inmobiliarios
resumen: Cómo revisar, aprobar y programar publicaciones de Instagram y Facebook, y cómo seguir la publicación de propiedades en Mercado Libre, Argenprop y Zonaprop.
permisos: marketing.read, publications.manage
---

## Ver la cola de contenido para redes sociales
<!-- ruta: /crm/marketing; permisos: marketing.read -->

Las publicaciones (posts) para Instagram y Facebook se gestionan en el menú **Contenido** (`/crm/marketing`), pantalla «Contenido para redes». Regla principal: nada se publica sin aprobación de una persona.

La pantalla tiene cuatro pestañas, cada una con su contador:

- **Para revisar**: borradores y posts en revisión.
- **Aprobadas y programadas**: aprobadas, programadas o publicándose, ordenadas por fecha de salida.
- **Publicadas**: las que ya salieron en Instagram o Facebook.
- **Rechazadas y con error**: rechazadas por el equipo o que fallaron al publicarse.

Cada tarjeta muestra la foto de portada, el canal (Instagram o Facebook), el estado (Borrador, En revisión, Aprobada, Programada, Publicando, Publicada, Con error, Rechazada), el código de la propiedad, la cantidad de fotos, el título, el texto y la fecha: «Sale: …» si está programada, «Publicada: …» o «Actualizada: …». Si hubo un error, aparece en rojo. Tocá la tarjeta para abrir el detalle con la vista previa.

Arriba pueden aparecer avisos si la publicación automática (flag `social_publishing`) o la generación de borradores (flag `social_drafts`) están apagadas.

## De dónde salen los borradores de Instagram y Facebook
<!-- ruta: /crm/marketing; permisos: marketing.read -->

Los borradores de redes se generan solos cuando se **publica una propiedad** en el CRM, si está activa la automatización «Borradores de redes al publicar» y el flag `social_drafts` está encendido (viene encendido).

Por cada publicación de propiedad se crea un borrador para **Instagram** y otro para **Facebook**, con:

- un texto armado con una plantilla y solo datos reales de la ficha: tipo, operación, zona, ambientes, dormitorios, baños y superficie si están cargados, precio solo si no está oculto, código y link público. Una línea sin datos se omite: nada se inventa;
- la portada y hasta 9 fotos verificadas de la propiedad (10 en total).

Al crearse, el equipo de marketing recibe la notificación «Borradores de redes para revisar · código …». Si la propiedad no tiene fotos verificadas, el aviso pide agregarlas antes de aprobar. Republicar la misma propiedad el mismo día no repite los borradores.

Hoy el CRM no permite crear una publicación de redes desde cero ni generar el texto con IA: solo existen los borradores automáticos que salen de publicar una propiedad.

## Editar el texto de una publicación de redes
<!-- ruta: /crm/marketing/[id]; permisos: marketing.create -->

Para corregir o mejorar el texto (copy, caption) de un post:

1. Abrí la publicación desde **Contenido para redes**.
2. En la tarjeta **Texto**, modificá **Texto de la publicación**. Abajo ves el contador de caracteres.
3. Tocá **Guardar texto**. Aparece «Texto guardado».

Límites: Instagram admite hasta 2200 caracteres y 30 hashtags; Facebook, bastante más. Si pasás el límite, el contador se pone en rojo y no se puede guardar. El texto tiene que tener al menos 10 caracteres.

Importante: si la publicación estaba **Aprobada** o **Programada**, cambiar el texto la vuelve a **Borrador** (se pierde la aprobación y la fecha) y hay que aprobarla de nuevo; el formulario lo avisa. Lo mismo pasa con una Rechazada o Con error: vuelve a Borrador. Después de editar, el «Origen del texto» pasa de «Plantilla» a «Editado por el equipo».

Solo se puede editar mientras no esté publicada ni publicándose. Sin el permiso `marketing.create` el campo aparece deshabilitado.

## Elegir y ordenar las fotos de una publicación
<!-- ruta: /crm/marketing/[id]; permisos: marketing.create -->

Cada post usa fotos de la propiedad vinculada. Para cambiarlas:

1. Abrí la publicación y bajá a la tarjeta **Fotos**.
2. Tocá las fotos en el orden en que deben salir. Cada una muestra su número; la **primera es la portada** del post. Máximo 10 fotos.
3. Para cambiar el orden, usá las flechas ← y → debajo de cada foto elegida. Para sacar una, tocala de nuevo.
4. Tocá **Guardar fotos**. Aparece «Fotos guardadas».

Tiene que quedar al menos una foto. Las fotos marcadas «Sin verificar» o «Sin URL pública» pueden no servir para Meta: Instagram y Facebook descargan la imagen desde una dirección pública https. Si la foto no cumple el formato de Instagram, al publicar se genera una copia JPEG compatible sin recortarla.

Como con el texto, cambiar las fotos de una publicación **Aprobada** o **Programada** la vuelve a **Borrador** y hay que aprobarla otra vez. Si la propiedad no tiene imágenes, se ve «La propiedad no tiene fotos disponibles»: cargalas primero en la ficha de la propiedad.

## Aprobar una publicación de redes
<!-- ruta: /crm/marketing/[id]; permisos: marketing.approve -->

La aprobación la hace siempre una persona con el permiso `marketing.approve` (por defecto dirección, administración y el rol de marketing).

1. Abrí la publicación desde la pestaña **Para revisar**.
2. Revisá la **Vista previa**: foto de portada, carrusel y texto tal como van a salir.
3. Revisá la tarjeta **Texto** y la tarjeta **Fotos**.
4. En la tarjeta **Aprobación** tocá **Aprobar**.

La publicación pasa a **Aprobada** y queda registrado quién y cuándo la aprobó. Solo se aprueban posts en Borrador o En revisión, y el CRM exige al menos una foto elegida («Elegí al menos una foto antes de aprobar»).

Aprobar **no publica**: después hay que programar la fecha y hora. Quien no tiene permiso de aprobar ve el mensaje «Tu rol puede preparar el contenido; la aprobación y programación las hace alguien con permiso de aprobar». La acción queda en la auditoría.

## Rechazar una publicación de redes
<!-- ruta: /crm/marketing/[id]; permisos: marketing.approve -->

Si un borrador no sirve o una publicación aprobada no debe salir:

1. Abrí la publicación.
2. En la tarjeta **Aprobación** desplegá **Rechazar**.
3. Escribí el **Motivo del rechazo** (mínimo 3 caracteres; por ejemplo, cambiar la foto de portada).
4. Tocá **Rechazar**.

La publicación pasa a **Rechazada**, pierde la aprobación y la fecha programada (si tenía), y aparece en la pestaña **Rechazadas y con error** con el aviso «Rechazada: motivo».

Se pueden rechazar publicaciones en Borrador, En revisión, Aprobada, Programada o Con error. Una ya **Publicada** no se puede rechazar ni modificar: si hay que sacarla, hacelo directamente en Instagram o Facebook, porque hoy el CRM no permite borrar posts publicados en Meta.

Una publicación rechazada no se descarta: si alguien con `marketing.create` corrige el texto o las fotos, vuelve a **Borrador** y se puede aprobar de nuevo. Hoy el CRM no permite eliminar publicaciones de la cola.

## Programar la fecha y hora de una publicación
<!-- ruta: /crm/marketing/[id]; permisos: marketing.approve -->

Una vez aprobada, la publicación se programa para que salga sola:

1. Abrí la publicación (pestaña **Aprobadas y programadas**).
2. En la tarjeta **Aprobación**, completá **Fecha y hora (Salta)**. Por defecto propone mañana a las 10:00.
3. Tocá **Programar**. Aparece «Programada para … (hora de Salta)».

Reglas:

- la fecha tiene que ser futura (al menos un minuto adelante) y como máximo 180 días hacia adelante;
- solo se programan publicaciones **Aprobadas**, **Programadas** (para cambiar la fecha) o **Con error** (para reintentar);
- si ya salió, no se puede volver a programar.

A la hora elegida el CRM publica en Instagram o Facebook. Además, una revisión horaria retoma las publicaciones vencidas que no salieron (por ejemplo, porque la publicación automática estaba apagada). Si el flag `social_publishing` está apagado, la publicación queda Programada con el aviso «no saldrá hasta activarla». Hoy el CRM no tiene un botón para publicar en el momento: se programa unos minutos adelante.

## Cancelar la programación de una publicación
<!-- ruta: /crm/marketing/[id]; permisos: marketing.approve -->

Si una publicación programada no tiene que salir en esa fecha, pero sigue aprobada:

1. Abrí la publicación desde **Aprobadas y programadas**.
2. En la tarjeta **Aprobación** tocá **Cancelar programación**.
3. Confirmá: «¿Cancelar la programación? Queda aprobada sin fecha».

La publicación vuelve a **Aprobada**, sin fecha. Para que salga más adelante, elegí otra **Fecha y hora (Salta)** y tocá **Programar**.

Si en cambio querés que no salga nunca, usá **Rechazar** con el motivo. Para cambiar solo la fecha no hace falta cancelar: con la publicación Programada, elegí la nueva fecha y tocá **Programar** de nuevo.

Solo se puede cancelar la programación de una publicación en estado **Programada**. Si ya está **Publicando** o **Publicada**, es tarde: revisá el resultado en Instagram o Facebook. La cancelación queda registrada en la auditoría.

## Qué pasa si una publicación falla o no hay credenciales de Meta
<!-- ruta: /crm/marketing/[id]; permisos: marketing.read -->

La publicación en Instagram y Facebook usa la API oficial de Meta. Estados posibles cuando algo no sale bien:

- **Sin credenciales de Meta**: la publicación sigue **Programada** con el aviso «Sin credenciales de Meta: …». No se pierde: sale sola cuando se configuren las credenciales (lo hace un administrador técnico).
- **Publicación automática apagada** (flag `social_publishing`, apagado por defecto): queda Programada y espera. Lo enciende quien tiene `integrations.manage` desde **Integraciones**.
- **Falla transitoria**: se reintenta sola hasta 4 veces; si se agotan, pasa a **Con error**.
- **Resultado incierto**: «Resultado incierto: Meta no confirmó la publicación y pudo haber salido. Verificá en Instagram/Facebook…». No se reintenta solo para no duplicar el post.

Qué hacer con una **Con error**:

1. Abrí la publicación desde **Rechazadas y con error** y leé el mensaje.
2. Si el error es incierto, verificá primero en Instagram o Facebook si el post salió.
3. Si no salió, corregí lo que indique el error (por ejemplo, fotos sin URL pública) y volvé a elegir **Fecha y hora (Salta)** y **Programar**.

## Ver el estado de las propiedades en los portales inmobiliarios
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

La pantalla **Portales** (`/crm/publicaciones`) muestra cómo está publicada cada propiedad en Mercado Libre, Argenprop y Zonaprop. Requiere el permiso `publications.manage` (dirección, administración y el rol de marketing, por defecto).

Arriba, la sección **Canales** tiene una tarjeta por portal con: si está **Habilitado** o **Deshabilitado**, el estado de la integración (Conectada, Esperando credenciales, Con fallas, Error, Apagada), una nota sobre el portal, el último error, los contadores por estado y «Último OK».

Abajo, **Publicaciones** lista cada propiedad por portal. Filtrá por portal («Todos los portales»), por estado («Todos los estados») o por código o título, y tocá **Filtrar**. Cada fila muestra la propiedad («Debe estar publicada» o «Debe estar dada de baja»), el portal, el estado (Pendiente, Sincronizando, Sincronizada, Con error, Reintentando, Esperando credenciales, Canal deshabilitado), **Ver aviso** si ya existe en el portal, el último intento con la cantidad de intentos y el detalle del error.

No se elige portal por propiedad: al publicar una propiedad en el CRM se crea su publicación en todos los portales, y al despublicarla se pide la baja. Si un portal falla, el dato del CRM no cambia.

## Habilitar o deshabilitar un portal inmobiliario
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

Para empezar o dejar de sincronizar las propiedades con un portal:

1. Entrá a **Portales** (`/crm/publicaciones`).
2. En la tarjeta del portal, en **Canales**, tocá **Habilitar** o **Deshabilitar**.
3. Confirmá el mensaje.

Al **habilitar**, las publicaciones de ese portal que estaban en «Canal deshabilitado» pasan a **Pendiente** y se sincronizan cuando haya credenciales y la sincronización automática esté activa.

Al **deshabilitar**, se deja de sincronizar y las publicaciones pasan a «Canal deshabilitado». Ojo: **los avisos ya publicados en el portal no se borran**; si hay que darlos de baja, hacelo en el portal.

Aparte de cada canal existe el interruptor general: el flag `portal_sync` (apagado por defecto). Si está apagado, la pantalla muestra «La sincronización automática está apagada (feature flag portal_sync)» y los cambios quedan pendientes. Lo enciende quien tiene `integrations.manage` desde **Integraciones**, en la tarjeta **Feature flags**. Los canales vienen deshabilitados de fábrica. Cada cambio queda en la auditoría.

## Reintentar la publicación de una propiedad en un portal
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

Si una propiedad quedó con error o pendiente en un portal:

1. Entrá a **Portales** y filtrá por estado (por ejemplo «Con error»).
2. Leé la columna **Detalle** para entender el problema y corregí el dato en la ficha de la propiedad si hace falta (precio, fotos, ubicación).
3. En la fila, tocá **Reintentar**. Aparece «Reintento en cola» (o «Ya había un reintento en cola»).

El botón aparece solo si el portal está habilitado y la publicación está Con error, Reintentando, Esperando credenciales o Pendiente. Tiene que estar encendido el flag `portal_sync`; si no, el CRM responde que la sincronización está desactivada. Si ya se está sincronizando, avisa «Ya se está sincronizando».

Con **resultado incierto** («Resultado incierto: verificá en Mercado Libre…») no hay reintento automático. Al reintentar a mano, el CRM busca primero el aviso por referencia propia y, si existe, lo adopta en lugar de crear uno duplicado. Además, una corrida horaria retoma sola las publicaciones que esperaban credenciales. El reintento queda auditado.

## Publicar propiedades en Mercado Libre
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

Mercado Libre Inmuebles es el único portal con **API pública oficial** integrada. Hoy la integración está construida pero **esperando credenciales**: hace falta que un administrador técnico cree la aplicación en Mercado Libre con la cuenta principal de la inmobiliaria, la autorice y contrate el paquete de publicación de inmuebles.

Con eso configurado, el canal habilitado y el flag `portal_sync` encendido, al publicar una propiedad en el CRM:

1. se crea el aviso en Mercado Libre con la referencia propia de la propiedad;
2. cada cambio en la ficha actualiza el mismo aviso (nunca crea un segundo);
3. al despublicar, el aviso se **pausa** (no se cierra, porque cerrarlo es irreversible).

Requisitos del aviso, si no se cumplen queda **Con error** nombrando el dato faltante:

- **precio visible**: con precio oculto no se publica;
- al menos una foto con URL pública https (portada primero, hasta 30);
- los atributos obligatorios de la categoría: el CRM no inventa valores.

Se publica una sola operación por aviso (venta antes que alquiler). Los emprendimientos no se sincronizan. Si la dirección está oculta, se envía sin número ni coordenadas. Si Mercado Libre pide volver a autorizar la cuenta, lo resuelve un administrador técnico.

## Publicar en Argenprop y Zonaprop
<!-- ruta: /crm/publicaciones; permisos: publications.manage -->

**Hoy el CRM no publica en Argenprop ni en Zonaprop.** Ninguno de los dos portales tiene API pública: la integración la habilita cada portal por acuerdo comercial, entregando credenciales y una especificación técnica que no es pública (Zonaprop pertenece al grupo Navent).

Por eso, en **Portales**, esas propiedades quedan siempre en **Esperando credenciales** con el detalle «… no tiene API pública: requiere acuerdo comercial con el portal y su especificación técnica. No se envió nada». Reintentar no cambia nada: el CRM no llama a ningún endpoint ni inventa formatos.

Lo que sí hace el CRM es validar y preparar la ficha con los datos mínimos que pide cualquier portal (operación activa, ubicación y al menos una foto con URL pública), así queda lista para cuando exista el acuerdo.

Mientras tanto, los avisos en Argenprop y Zonaprop se cargan a mano desde el panel de cada portal. Para activar la integración hace falta:

1. firmar el acuerdo comercial con el portal;
2. obtener sus credenciales y la especificación técnica oficial;
3. que el equipo técnico implemente la conexión.

Tené en cuenta que, según el relevamiento de Argenprop, al pedir la integración el portal da de baja los avisos activos cargados a mano.
