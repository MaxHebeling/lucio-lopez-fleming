---
dominio: virtual-tours
titulo: Tours virtuales 360°
resumen: Cómo crear, editar, previsualizar y publicar el tour 360° de una propiedad (propio o externo): panorámicas, escenas, hotspots, plano, recorrido guiado, flag virtual_tours y demo pública.
permisos: properties.read
---

## Qué es el tour virtual 360° de una propiedad
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.read -->

El tour virtual 360° (recorrido virtual) permite que el visitante del sitio «camine» la propiedad desde su navegador. Cada propiedad puede tener **un solo tour**, de dos tipos:

- **Propio**: se arma en el CRM con panorámicas 360° (una escena por ambiente), puntos para pasar de un ambiente a otro, plano y recorrido guiado.
- **Externo**: ya está hecho en Matterport, Kuula, 3DVista u otro servicio y el CRM solo guarda el link.

En la ficha pública, cuando el tour está publicado aparecen las pestañas Fotos, Tour 360°, Plano y Video (las que correspondan) y una portada con el botón «Entrar al tour 360°». Sin tour, la ficha se ve solo con fotos, como siempre.

El tour se edita en la ficha del CRM → sección **Tour virtual 360°** → `/crm/propiedades/[id]/tour`. Para editar hace falta `properties.manage_media` (Agente, Marketing, Administrador, Dirección, Super Admin); para publicar, despublicar o borrar un tour publicado, `properties.publish`.

## Agregar un tour 360° a una propiedad
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Pasos desde la ficha de la propiedad:

1. Entrá a **Propiedades** y abrí la ficha del inmueble.
2. En la barra de secciones tocá **Tour 360°**. La tarjeta **Tour virtual 360°** dice **SIN TOUR**.
3. Tocá **Crear tour** (si ves **Ver**, no tenés permiso para editar multimedia).
4. En **Crear tour virtual**, en **Tipo de tour**, elegí **Propio** o **Externo** y tocá **Crear tour**.
5. Tour propio: en **Agregar escena** escribí el **Nombre del ambiente**, elegí la **Panorámica 360°** y tocá **Subir escena**. Repetí por cada ambiente.
6. Elegí la escena **Inicial**, ajustá con **Usar vista actual como vista inicial** y agregá puntos con **Agregar en el centro de la vista**.
7. Opcional: subí el **Plano** y armá el **Recorrido guiado**.
8. Tocá **Previsualizar** para revisarlo.
9. Tocá **Publicar tour**. Si falta algo, aparece «Para publicar falta:».

El tour se ve en el sitio solo cuando **la propiedad también está publicada**. Para un tour externo, en el paso 4 cargá proveedor y URL y pasá directo a publicar.

## Cargar un tour externo de Matterport, Kuula o 3DVista
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Si el recorrido ya existe en otro servicio:

1. En el editor del tour, en **Crear tour virtual**, elegí **Externo**.
2. En **Proveedor** elegí Matterport, Kuula, 3DVista u Otro proveedor.
3. Pegá la **URL del tour** (la que se comparte; tiene que empezar con https://).
4. Opcional: pegá la **URL de inserción (opcional)**, la del código «embed» del proveedor.
5. Tocá **Crear tour**.

Debajo de los campos el CRM avisa cómo se va a mostrar:
- «Se va a mostrar dentro del sitio (host verificado del proveedor).»: se inserta en la ficha. Solo pasa con `my.matterport.com`, `kuula.co` y `storage.net-fs.com` (3DVista).
- «Se va a abrir en una pestaña nueva…»: cualquier otra dirección, o «Otro proveedor», se muestra como botón «Abrir en …».

Para cambiar los datos después, editalos en la tarjeta **Tour externo** y tocá **Guardar** («Tour externo guardado.»). Hoy no se puede convertir un tour externo en propio (ni al revés): hay que borrar el tour y crearlo de nuevo.

## Requisitos de las panorámicas 360° (imágenes 2:1)
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Cada escena necesita una foto panorámica 360° **equirectangular**, es decir, con proporción **2:1** (el ancho es el doble del alto; se tolera 1% de diferencia). El CRM rechaza otras proporciones con el mensaje «La imagen mide … px: una panorámica 360° equirectangular tiene que ser 2:1 (por ejemplo 8192 × 4096)».

Requisitos:
- Formato JPG, PNG, WebP o AVIF (se recomienda JPG sRGB calidad 85–90).
- Ancho mínimo 2048 px; ideal entre 6000 y 8192 px (por ejemplo 8192 × 4096, 7680 × 3840 o 6080 × 3040).
- Hasta 15 MB por archivo.
- Sin marca de agua, con el nadir (trípode) parcheado y el horizonte recto.

Al subir, el sistema quita los datos EXIF/GPS, limita la imagen a 8192 × 4096 y genera una vista previa y una miniatura. No se guarda el original: conservá los archivos del fotógrafo. Una foto común, un panorama plano o una imagen de celular recortada no sirven. La guía completa para el fotógrafo está en `docs/TOUR_360_CAPTURE_GUIDE.md`.

## Subir una escena (panorámica) al tour
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

En un tour propio, cada escena es un ambiente (living, cocina, jardín…):

1. En la tarjeta **Agregar escena**, escribí el **Nombre del ambiente** tal como lo va a leer el visitante (máximo 80 caracteres).
2. En **Panorámica 360°** elegí el archivo.
3. Tocá **Subir escena**. Mientras procesa dice «Subiendo y procesando…».
4. Cuando termina aparece un mensaje como «Living» agregada. y la escena se suma a la lista **Escenas**.

Conviene subir las escenas en el orden del recorrido (después se pueden reordenar). La primera escena subida queda como escena inicial. Cada escena nueva entra visible (publicada dentro del tour). Un tour admite hasta 60 escenas.

Si la panorámica supera 15 MB, el CRM avisa «La panorámica supera 15 MB. Exportala en JPG con calidad 85–90.». Si el almacenamiento de archivos no está configurado, el formulario aparece deshabilitado (ver la sección sobre el aviso de almacenamiento).

## Ordenar, renombrar, ocultar y borrar escenas
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

En la lista **Escenas (n)** cada escena muestra miniatura, nombre, cantidad de puntos, medida y si es la «inicial». Tocá una escena para abrirla en el visor. Acciones:

- **Flechas arriba/abajo**: cambian el orden (es el orden de la barra de ambientes y del recorrido guiado si no configurás uno).
- **Inicial**: la marca como escena de arranque del tour.
- **Ocultar** / **Publicar**: oculta la escena del tour público sin borrarla (aparece la etiqueta **Oculta**).
- **Borrar** (ícono de papelera): confirmá «¿Borrar «…»? También se borran sus puntos y los que llevan a esta escena.». Si era la inicial, pasa a serlo otra.
- **Renombrar**: con la escena abierta, cambiá **Nombre** y tocá **Guardar nombre**.

Si el tour está publicado, el CRM no deja hacer un cambio que lo deje incompleto (por ejemplo, ocultar la escena inicial o una escena a la que lleva un punto): muestra «El tour está publicado y este cambio lo dejaría incompleto: … Despublicalo antes o corregí eso primero.».

## Definir la vista inicial de una escena
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

La vista inicial es hacia dónde mira el visitante cuando entra a un ambiente:

1. En **Escenas**, tocá la escena para abrirla en el visor (tarjeta «Escena: …»).
2. Arrastrá la imagen (o usá las flechas del teclado) hasta encuadrar la vista de frente que querés mostrar.
3. Tocá **Usar vista actual como vista inicial**.
4. Aparece «Vista inicial guardada.» y al lado se actualiza «Inicial: …° / …°».

Repetí en cada escena. Un buen encuadre inicial suele mirar hacia la parte más atractiva del ambiente o hacia el paso al siguiente. Si el visor muestra «Este navegador no puede mostrar la vista 360° (WebGL no disponible).» o «No se pudo cargar la panorámica.», probá con otro navegador o revisá el almacenamiento.

## Agregar puntos de navegación (hotspots) a una escena
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Los puntos (hotspots) son los botones dentro de la panorámica. Se ubican en el centro de la vista, marcado con una cruz:

1. Abrí la escena en el visor y girá la vista hasta que la cruz quede sobre la puerta o el objeto.
2. En el formulario **+ Hotspot en el centro de la vista**, elegí el **Tipo**:
   - **Navegación (lleva a otra escena)**: elegí el **Destino** (las ocultas dicen «(oculta)»).
   - **Información (tarjeta con texto)**: completá **Texto de la tarjeta** (obligatorio, máx. 600).
   - **Contacto (abre «Agendar visita»)**: texto opcional; abre el formulario de visita.
3. Escribí el **Texto del punto** (máx. 80). En navegación, si lo dejás vacío se usa «Ir a …».
4. Tocá **Agregar en el centro de la vista**.

Si aparece «Esperá a que cargue la vista para ubicar el punto.», esperá que termine de cargar. Navegación se habilita cuando hay al menos dos escenas. Hacé los puntos de ida y vuelta entre ambientes conectados. Máximo 40 puntos por escena. Hoy los puntos no se pueden arrastrar: se ubican apuntando la vista.

## Editar, mover o borrar un hotspot
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Para corregir un punto existente:

1. Abrí la escena y hacé clic en el punto dentro del visor, o tocá **Editar** en la lista **Puntos de esta escena**.
2. El formulario cambia a «Editar punto «…»».
3. Según lo que necesites:
   - Cambiá tipo, destino o textos y tocá **Guardar punto**.
   - Para reubicarlo, girá la vista hasta que la cruz quede en el lugar correcto y tocá **Mover al centro de la vista**.
   - Para eliminarlo, tocá **Borrar** y confirmá «¿Borrar el punto «…»?».
4. Tocá **Cancelar** para volver al formulario de punto nuevo.

La lista **Puntos de esta escena** muestra cada punto con su texto, a qué escena lleva (o «información» / «contacto») y su ángulo. Si el tour está publicado, no se puede dejar un punto de navegación sin destino válido ni apuntando a una escena oculta.

## Subir el plano del tour y ubicar las escenas
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Con plano, el visitante ve «Estás aquí» y puede saltar de ambiente tocándolo. En la tarjeta **Plano**:

1. En **Subir plano** elegí una imagen (JPG, PNG o WebP; los SVG no se aceptan). Se procesa y aparece en la tarjeta («Subiendo plano…» mientras tanto).
2. En **Escenas**, tocá la escena que querés ubicar.
3. Aparece «Hacé clic en el plano para ubicar «…».»: hacé clic en el punto del plano donde se sacó la panorámica.
4. Repetí con cada escena.

Para sacar una escena del plano, abrila y tocá **Quitar a «…» del plano**. Para cambiar la imagen, usá **Reemplazar plano**; para eliminarla, **Quitar plano** y confirmá «¿Quitar el plano?». El plano del tour es distinto de los planos cargados en **Multimedia** de la ficha, aunque en el sitio ambos alimentan la pestaña Plano.

## Configurar el recorrido guiado del tour
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

El recorrido guiado es la visita paso a paso con botones Anterior / Siguiente que el visitante puede activar en el tour:

1. En la tarjeta **Recorrido guiado**, en **Incluir**, marcá las escenas que forman parte de la visita.
2. En la lista de orden, usá las flechas para acomodarlas en la secuencia ideal (por ejemplo entrada → living → cocina → dormitorios → exteriores).
3. Tocá **Guardar recorrido**.

«Sin escenas elegidas, se usa el orden de la lista.» de escenas. El recorrido no puede incluir escenas ocultas si el tour está publicado ni repetir escenas; si borrás una escena, se quita sola del recorrido.

## Previsualizar el tour antes de publicarlo
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.read -->

En la tarjeta **Estado y publicación** tocá **Previsualizar**. Se abre el tour a pantalla completa tal como lo va a ver un visitante (con el título «(vista previa)»), usando los datos en borrador: escenas, puntos, plano y recorrido guiado.

Usala para revisar que cada punto lleve al ambiente correcto, que las vistas iniciales estén bien encuadradas y que no se vean datos sensibles en las panorámicas (documentos, patentes, numeración de la casa si la dirección es oculta). La vista previa no registra estadísticas. Cerrala con «× Salir del tour» o Escape.

Si aparece «No se pudo abrir la vista previa. Revisá la conexión.», recargá la página e intentá de nuevo. La previsualización también está disponible para quien solo tiene permiso de lectura.

## Publicar o despublicar el tour 360°
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.publish -->

En la tarjeta **Estado y publicación**:

1. Revisá el recuadro «Para publicar falta:». En un tour propio los requisitos son: al menos una escena publicada, escena inicial elegida y visible, todos los puntos de navegación con destino existente y visible, y recorrido guiado sin escenas ocultas. En uno externo: proveedor elegido y URL con https://.
2. Tocá **Publicar tour** (deshabilitado mientras falte algo).
3. Aparece «Tour publicado: ya se ve en la ficha.» o, si la propiedad no está publicada, «Tour publicado. Se va a ver cuando la propiedad esté publicada.».

Para sacarlo del sitio sin borrarlo, tocá **Despublicar tour**: vuelve a **BORRADOR**. En la ficha del CRM la etiqueta pasa a «Tour 360° publicado» o «en borrador». Si el tour está publicado pero la propiedad no, el editor avisa «El tour está publicado, pero la propiedad no: no se ve en el sitio hasta publicarla.». Sin `properties.publish` estos botones no aparecen.

## Borrar un tour virtual completo
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Para eliminar el tour de una propiedad (por ejemplo, para cambiarlo de externo a propio):

1. En el editor, tarjeta **Estado y publicación**, tocá **Borrar tour**.
2. Confirmá «¿Borrar el tour completo? Se eliminan sus escenas, puntos y plano. No se puede deshacer.».

La ficha vuelve a **SIN TOUR** y se puede crear uno nuevo con **Crear tour**. Los archivos de las panorámicas se eliminan del almacenamiento.

Permisos: con `properties.manage_media` podés borrar un tour en borrador; si el tour está publicado, además hace falta `properties.publish` (sin ese permiso el botón no aparece). Si solo querés sacarlo del sitio por un tiempo, usá **Despublicar tour** en lugar de borrarlo.

## Aviso de almacenamiento no configurado al subir panorámicas
<!-- ruta: /crm/propiedades/[id]/tour; permisos: properties.manage_media -->

Las panorámicas y planos se guardan en el almacenamiento de archivos (S3). Si no está listo, el editor muestra un aviso arriba y deshabilita **Subir escena** y **Subir plano**:

- «El almacenamiento de archivos no está configurado (faltan las credenciales S3). Todavía no se pueden subir panorámicas ni planos.»
- «El almacenamiento está configurado sin URL pública (STORAGE_PUBLIC_BASE_URL): las panorámicas no se podrían mostrar en el sitio.»

En ese caso no hay nada que hacer desde el editor: consultá con quien administra el sistema para que configure el almacenamiento. Mientras tanto sí podés crear el tour, cargar un tour **externo** y publicarlo.

Otros errores al subir: «Formato no admitido: subí … en JPG, PNG, WebP o AVIF», «El archivo supera el máximo de … MB», «La panorámica es muy chica (… px de ancho). Mínimo 2048 px», «No pudimos leer la imagen: puede estar dañada…» y «Error de red al subir. Probá de nuevo.».

## Activar o desactivar los tours 360° con el flag virtual_tours
<!-- ruta: /crm/integraciones; permisos: integrations.manage -->

Los tours se pueden apagar en todo el sitio con el feature flag `virtual_tours` (viene encendido):

1. Entrá a **Integraciones** (`/crm/integraciones`).
2. En la tarjeta **Feature flags** buscá `virtual_tours` (etiqueta **Encendido** o **Apagado**).
3. Tocá **Apagar** o **Encender** y confirmá.

Con el flag apagado: las fichas públicas no muestran las pestañas ni la portada del tour (quedan solo con fotos), `/demo/tour-360` responde «no encontrada» y no se registran estadísticas de tours. En el CRM el editor sigue funcionando y los tours conservan su estado; al volver a encender, los tours publicados reaparecen. El cambio impacta el sitio en el momento (otras instancias en hasta 15 segundos). Ver la página requiere `integrations.read`; cambiar flags, `integrations.manage`.

## Ver la demo pública del tour 360° y la propiedad DEMO

Para mostrar cómo funciona un tour a un cliente o propietario existe una demo pública en `/demo/tour-360`, sobre una propiedad **ficticia** («RESIDENCIA DEMO 360°») con renders 3D. La página aclara «DEMO INTERACTIVA — PROPIEDAD FICTICIA», no aparece en buscadores y sus botones de contacto no generan leads.

En el CRM esa propiedad aparece con la etiqueta **DEMO**. No se puede publicar, duplicar ni mandar a portales, y no se vincula a leads ni contratos. Su editor de tour es de solo lectura: «Es el tour de la propiedad DEMO: se edita desde `public/tours/demo/residencia/manifest.json` y se carga con `pnpm seed:demo-tour`. Acá solo se puede previsualizar.». Cambiar las imágenes de la demo es una tarea técnica, no se hace desde el CRM. Si el flag `virtual_tours` está apagado, la demo no está disponible.
