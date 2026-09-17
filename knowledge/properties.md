---
dominio: properties
titulo: Propiedades
resumen: Listado y filtros, alta y edición de propiedades, precios y operaciones, estados, publicación en el sitio, fotos y planos, ubicación y dirección oculta, agentes, propietarios, duplicado y portales.
permisos: properties.read
---

## Ver el listado de propiedades y buscar una
<!-- ruta: /crm/propiedades; permisos: properties.read -->

Entrá a **Propiedades** en el menú (`/crm/propiedades`). El listado muestra cada propiedad (inmueble) con foto de portada, código, título, tipo, ubicación, calle, sucursal, estado, si está **Publicada**, precio por operación («Consultar» si el precio está oculto), agente responsable y fecha de última modificación. En celular se ve como tarjetas.

Para buscar:
1. Escribí en **Buscar** un código (con o sin `#`), parte del título, la calle y altura o texto de la descripción.
2. Tocá **Aplicar**.

En **Orden** elegís: Última modificación, Más recientes, Código (mayor o menor primero), Título (A-Z) o Precio (menor o mayor primero). Se muestran 25 por página.

Tocá el título (o la tarjeta) para abrir la ficha. La ficha tiene una barra de secciones: Datos, Precios, Estado, Multimedia, Tour 360°, Propietarios (solo con permiso), Agentes, Publicaciones, Leads y Auditoría (según permisos). Las propiedades archivadas no aparecen salvo que las filtres por estado.

## Filtrar propiedades por estado, publicación, operación, precio o agente
<!-- ruta: /crm/propiedades; permisos: properties.read -->

En el formulario de filtros del listado:

1. **Estado**: por defecto «Todos (sin archivadas)»; elegí Borrador, Disponible, Reservada, Vendida, Alquilada, Pausada o Archivada.
2. **Tipo**: casa, departamento, PH, terreno, lote, local, oficina, etc.
3. Abrí **Más filtros** para ver:
   - **Publicación**: Todas, Publicadas o No publicadas.
   - **Operación**: Venta, Alquiler o Alquiler temporario.
   - **Sucursal** y **Agente** (el agente puede ser responsable o de apoyo).
   - **Moneda** (USD o ARS) y **Precio desde** / **Precio hasta**. El rango de precio se aplica en la moneda elegida.
4. Tocá **Aplicar**. Para volver al listado completo, **Limpiar filtros**.

Los filtros quedan en la dirección de la página, así que podés guardar o compartir el link de una búsqueda. Desde el tablero, los contadores por estado y «Publicadas» llevan al listado ya filtrado.

## Crear una propiedad nueva
<!-- ruta: /crm/propiedades/nueva; permisos: properties.create -->

Para cargar un inmueble:

1. En **Propiedades** tocá **Nueva propiedad**.
2. **Datos principales**: completá **Título *** y **Tipo ***; opcionalmente **Sucursal**, **Descripción** y **Destacada en el sitio**.
3. **Ubicación**: elegí provincia, localidad y barrio, y cargá calle, número, piso, depto y coordenadas.
4. **Superficies y ambientes**: superficies en m², ambientes, dormitorios, baños, cocheras, antigüedad, orientación, apta crédito, etc. Según el tipo aparecen campos extra (por ejemplo, frente y fondo en un terreno).
5. **Características**: marcá servicios y amenities.
6. **Operaciones y precio ***: elegí Operación, Moneda, Precio y, si corresponde, Expensas. Con **Precio a consultar** el precio no se muestra. Con **+ Agregar operación** sumás hasta 3 (venta, alquiler y temporario).
7. **SEO (opcional)**: título (máx. 70) y descripción (máx. 170).
8. Tocá **Crear propiedad**.

La propiedad se crea como **Borrador** con un código nuevo, y quien la carga queda como agente responsable. Todavía no se publica: primero cargá fotos y pasala a Disponible.

## Cargar la ubicación y la dirección de una propiedad
<!-- ruta: /crm/propiedades/[id]/editar; permisos: properties.create, properties.update -->

En la tarjeta **Ubicación** del formulario de alta o edición:

1. Elegí **Provincia**; se habilita **Localidad**; con la localidad se habilita **Barrio** (los barrios cerrados aparecen como «(barrio cerrado)»).
2. Si falta un lugar en la lista, tocá **+ Agregar provincia**, **+ Agregar localidad** o **+ Agregar barrio**, escribí el nombre y tocá **Agregar** (requiere `properties.update`). Si ya existe con ese nombre, se reutiliza.
3. Completá **Calle**, **Número**, **Piso** y **Depto / unidad**.
4. Opcional: **Latitud** y **Longitud** en números decimales. Hoy el formulario no tiene un mapa para marcar el punto: las coordenadas se escriben a mano.
5. Decidí si marcás **Ocultar la dirección exacta en el sitio** (viene marcado por defecto).

La ubicación guardada es el nivel más específico elegido (barrio, o si no localidad, o provincia). Sin ubicación la propiedad no se puede publicar.

## Editar los datos de una propiedad
<!-- ruta: /crm/propiedades/[id]/editar; permisos: properties.update -->

Para corregir la ficha:

1. Abrí la propiedad y tocá **Editar datos**.
2. Cambiá lo que necesites: título, tipo, sucursal, descripción, destacada, ubicación, dirección, superficies, ambientes, características o SEO.
3. Tocá **Guardar cambios** (o **Cancelar** para volver sin guardar).

Solo se envían los campos que modificaste; si no tocaste nada, aparece «No hay cambios para guardar.». Al guardar volvés a la ficha con «Cambios guardados.» y el sitio público se actualiza.

Tené en cuenta:
- El precio y el estado **no** se editan acá: tienen su propia sección en la ficha y su propio permiso.
- Si cambiás el título cambia la URL pública; la dirección vieja redirige a la nueva.
- Si la propiedad está publicada con dirección oculta y no tenés `properties.publish`, no podés destildar «Ocultar la dirección exacta en el sitio».
- Si vino de la migración, los campos que edites quedan protegidos y una reimportación no los pisa.

## Cambiar el precio de una propiedad o agregar una operación
<!-- ruta: /crm/propiedades/[id]; permisos: properties.change_price -->

Para modificar el valor de venta o alquiler:

1. Abrí la ficha y andá a la sección **Precios**.
2. Desplegá **Cambiar precio o agregar operación**.
3. En **Operación** elegí Venta, Alquiler o Alquiler temporario. Las que la propiedad todavía no tiene dicen «(nueva)».
4. Ajustá **Moneda** (USD o ARS), **Precio** y **Expensas**.
5. Marcá **Precio a consultar (no se muestra en el sitio)** si no querés publicar el valor; en ese caso el precio puede quedar vacío.
6. Escribí el **Motivo del cambio** (queda en el historial).
7. Tocá **Guardar precio** (o **Agregar operación** si era nueva).

Aparece «Precio guardado.» y el sitio se actualiza. En la tabla de Precios ves cada operación con su precio, expensas y si en el sitio figura «Visible» o «Consultar». El historial de precios (hasta los últimos 50 cambios) muestra el precio anterior tachado, el nuevo, el motivo, la fecha y quién lo cambió. Hoy el CRM no permite quitar una operación ya cargada: solo cambiar su precio o marcarla como a consultar.

## Cambiar el estado de una propiedad (reservar, vender, alquilar, pausar)
<!-- ruta: /crm/propiedades/[id]; permisos: properties.change_status -->

Para marcar una propiedad como reservada, vendida, alquilada, pausada o archivada:

1. Abrí la ficha y andá a la sección **Estado**.
2. En **Nuevo estado** elegí el estado; la lista solo muestra los cambios permitidos desde el estado actual.
3. Opcional: escribí el **Motivo (opcional)**.
4. Tocá **Cambiar estado**.

Aparece «Estado actualizado.». Si la propiedad está publicada y elegís Pausada o Archivada, antes de confirmar ves «Con este estado la propiedad se despublica del sitio y de los portales.» y se despublica sola. Reservada, Vendida y Alquilada siguen publicadas.

Debajo está el **Historial de estados**: cada cambio con el estado anterior, el nuevo, el motivo, la fecha y quién lo hizo. El estado de una propiedad también puede cambiar automáticamente al activar un contrato de alquiler.

## Estados de una propiedad y cambios permitidos
<!-- ruta: /crm/propiedades/[id]; permisos: properties.change_status -->

Los estados son: **Borrador**, **Disponible**, **Reservada**, **Vendida**, **Alquilada**, **Pausada** y **Archivada**. El servidor solo acepta estos pasajes:

- Borrador → Disponible o Archivada.
- Disponible → Reservada, Vendida, Alquilada, Pausada o Archivada.
- Reservada → Disponible, Vendida, Alquilada, Pausada o Archivada.
- Vendida → Disponible o Archivada.
- Alquilada → Disponible o Archivada.
- Pausada → Disponible o Archivada.
- Archivada → Borrador o Disponible.

Para publicar, el estado tiene que ser Disponible, Reservada, Vendida o Alquilada. Hoy el CRM no tiene un botón para borrar una propiedad: para sacarla de circulación pasala a **Archivada** (deja de verse en el listado por defecto y en el sitio, y se puede recuperar pasándola a Borrador o Disponible).

## Publicar una propiedad en el sitio
<!-- ruta: /crm/propiedades/[id]; permisos: properties.publish -->

Para que el aviso se vea en el sitio web:

1. Abrí la ficha. Si falta algo, arriba aparece «Para publicar falta:» con la lista.
2. Resolvé cada punto. Los requisitos son:
   - estado Disponible, Reservada, Vendida o Alquilada;
   - ubicación cargada;
   - al menos una foto (que no tenga error);
   - al menos una operación con precio (o marcada como a consultar).
3. Tocá **Publicar** arriba a la derecha (está deshabilitado mientras falte algo; al pasar el mouse se ve el motivo).

Al publicar, la ficha muestra «Publicada desde …», el sitio se actualiza en el momento y la propiedad queda pendiente de sincronizar en los portales habilitados. Con la automatización «Borradores de redes al publicar» activa (viene encendida), también se generan borradores de Instagram y Facebook para que Marketing los revise. La descripción no es obligatoria para publicar, pero conviene revisarla antes, sobre todo si la dirección está oculta. Sin `properties.publish` el botón no aparece. La propiedad DEMO nunca se publica.

## Despublicar una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.publish -->

Para sacar un aviso del sitio sin cambiar su estado:

1. Abrí la ficha de la propiedad publicada.
2. Tocá **Despublicar** arriba a la derecha.
3. En la ventana «Motivo para despublicar (opcional):» escribí el motivo o dejalo vacío y aceptá. Si cancelás, no se despublica.

La propiedad deja de verse en el sitio y queda marcada para darse de baja en los portales. El motivo queda en la auditoría. Para volver a publicarla, tocá **Publicar** (se vuelven a controlar los requisitos).

La propiedad también se despublica sola si la pasás a Pausada o Archivada. Despublicar y publicar requieren el mismo permiso, `properties.publish`.

## Subir fotos y planos de una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.manage_media -->

En la ficha, sección **Multimedia**:

1. En el selector elegí **Fotos** o **Planos**.
2. Arrastrá los archivos al recuadro («Arrastrá fotos acá o elegilas desde tu dispositivo.») o tocá **Elegir archivos** (podés elegir varios).
3. Esperá a que cada archivo pase de «En espera» al porcentaje y a «Listo».

Formatos: JPG, PNG, WebP o AVIF, hasta 15 MB cada uno. El sistema quita los datos de ubicación GPS y optimiza la imagen (hasta 2400 px). Si un archivo falla, se muestra «Error» con el motivo (formato no admitido, supera 15 MB, imagen dañada). Cada propiedad admite hasta 200 archivos.

La primera foto subida queda como **Portada** automáticamente. Hoy el CRM no permite subir videos ni recorridos a Multimedia: el recorrido 360° se carga en la sección **Tour 360°**. Sin `properties.manage_media` solo ves las fotos.

## Ordenar fotos, elegir la portada y editar el texto alternativo
<!-- ruta: /crm/propiedades/[id]; permisos: properties.manage_media -->

En **Multimedia** cada archivo muestra su posición (#1, #2…), el tipo (Foto, Plano), la medida y etiquetas como **Portada**, **En sitio anterior** o **Con error**.

- **Reordenar**: arrastrá la tarjeta a otra posición o usá **↑ Antes** y **↓ Después**. El orden se guarda al instante y es el que se usa en el sitio.
- **Elegir portada**: tocá **Usar de portada** en una foto (los planos no pueden ser portada). La portada es la imagen principal del aviso y del listado.
- **Texto alternativo**: escribí una descripción breve en **Texto alternativo** (por ejemplo «Living con ventanal al jardín», máximo 250 caracteres) y tocá **Guardar**. Sirve para accesibilidad y buscadores.
- **Borrar**: tocá **Borrar** y confirmá «¿Borrar este archivo? Deja de mostrarse en el sitio y en el CRM.». Si borrás la portada, pasa a serlo la siguiente foto.

Si la propiedad está publicada y borrás todas las fotos, el sitio se actualiza, pero no se despublica sola: revisá el aviso.

## Ocultar la dirección exacta en el sitio
<!-- ruta: /crm/propiedades/[id]/editar; permisos: properties.update -->

La opción **Ocultar la dirección exacta en el sitio** (en Editar datos → Ubicación) viene marcada por defecto. Con la dirección oculta, el sitio muestra la calle sin la altura y las coordenadas redondeadas (alcanzan para ubicar la zona, aproximadamente 1 km, no la casa). En el CRM se sigue viendo la dirección completa. En la ficha, «Dirección en el sitio» dice **Oculta (solo zona)** o **Visible**.

Para cambiarla:
1. Abrí la propiedad y tocá **Editar datos**.
2. Marcá o desmarcá la casilla.
3. Tocá **Guardar cambios**.

Si la propiedad ya está publicada con dirección oculta, mostrar la dirección exacta equivale a publicar un dato nuevo: solo lo puede hacer alguien con `properties.publish`. Sin ese permiso la casilla aparece bloqueada con la nota «La propiedad está publicada: mostrar la dirección exacta lo decide quien tiene permiso para publicar.». Ojo: ocultar la dirección no borra la altura si está escrita en el título o la descripción.

## Corregir el aviso de dirección visible en el título o la descripción
<!-- ruta: /crm/propiedades/[id]/editar; permisos: properties.update -->

El CRM detecta cuando una propiedad tiene la dirección oculta pero el título o la descripción igual mencionan calle y altura (por ejemplo «calle … 1241» o «avenida … al 1200»). No cuenta medidas como «250 m2», «300 metros» o «5 km».

Dónde aparece:
- En el listado de **Propiedades** (con permiso de edición): «N propiedades publicadas con dirección oculta la mencionan con altura en el título o la descripción», con el código y el fragmento.
- En la ficha: «La dirección está oculta en el sitio, pero el título (o el texto de la descripción) la menciona: «…»».

Para corregirlo:
1. Abrí la propiedad desde el aviso.
2. Tocá **Editar datos**.
3. Reescribí el título o la descripción sin la altura (dejá solo la calle o la zona).
4. Tocá **Guardar cambios**. El aviso desaparece.

El CRM no corrige el texto solo. Si no tenés permiso de edición, la ficha te indica avisarle a quien pueda editar la propiedad.

## Asignar el agente responsable y de apoyo de una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.assign_agents -->

Cada propiedad puede tener un agente responsable y varios de apoyo:

1. Abrí la ficha y andá a la sección **Agentes**.
2. En **Agente responsable** elegí a la persona o **Sin responsable**.
3. En **Apoyo** marcá a quienes colaboran.
4. Tocá **Guardar agentes**. Aparece «Agentes actualizados.».

El responsable «Recibe los leads que llegan desde la ficha de esta propiedad.»: las consultas del sitio por ese inmueble se le asignan solas. Si tiene el perfil público activado, además figura como asesor en la ficha del sitio. Solo se pueden elegir usuarios activos; uno desactivado que ya estaba asignado aparece como «(inactivo)».

Este permiso es aparte de editar datos: con los roles de fábrica lo tienen Super Admin, Dirección y Administrador. Sin él, la sección solo lista los agentes con su rol (Responsable o Apoyo). Al crear o duplicar una propiedad, quien la carga queda como responsable.

## Cargar los propietarios de una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read_private -->

Los dueños del inmueble son datos privados: la sección **Propietarios** solo aparece con `properties.read_private`, y para modificarla también hace falta `properties.update`.

1. Abrí la ficha y andá a **Propietarios**.
2. En **Agregar propietario (buscá por nombre, email o teléfono)** escribí al menos 2 caracteres y tocá el contacto en los resultados.
3. Para cada propietario cargá el **% titularidad** (opcional) y marcá cuál es el **Principal**.
4. Para sacar a alguien, tocá **Quitar**.
5. Tocá **Guardar propietarios**. Aparece «Propietarios actualizados.».

Reglas: tiene que haber un único principal, no se repiten contactos y la suma de porcentajes no puede superar 100%. El propietario tiene que existir como contacto: si aparece «Sin coincidencias. El contacto se crea desde Contactos.», crealo primero en **Contactos**. Al guardarlo, el contacto queda marcado con el rol Propietario.

## Duplicar una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.create -->

Sirve para cargar rápido unidades parecidas (por ejemplo, departamentos del mismo edificio):

1. Abrí la ficha de la propiedad original.
2. Tocá **Duplicar** arriba a la derecha.
3. Confirmá «¿Duplicar esta propiedad? Se crea un borrador nuevo sin fotos ni publicaciones.».
4. Se abre la copia con «Copia creada. Revisá los datos, cargá fotos y cambiá el estado cuando esté lista.».

La copia tiene código nuevo, título con «(copia)», estado Borrador y no destacada. Copia los datos, la ubicación, las operaciones con su precio y las características. **No** copia fotos ni planos, tour 360°, publicaciones, propietarios, agentes de la original ni historiales; quien duplica queda como responsable. Editá el título y lo que cambie antes de publicar. La propiedad DEMO no se puede duplicar.

## Ver el estado de una propiedad en los portales inmobiliarios
<!-- ruta: /crm/publicaciones; permisos: properties.read, publications.manage -->

En la ficha, la sección **Publicaciones por canal** muestra para cada canal (sitio web y portales): **Deseado** (Publicada / No publicada), **Sincronización** (Pendiente, Sincronizando, Sincronizada, Con error, Reintentando, Sin credenciales, Canal desactivado o «Nunca se publicó»), **Último intento** y **Detalle** con el error o el link **Ver en el portal**.

Con `publications.manage`, en **Portales** (`/crm/publicaciones`):
1. Mirá las tarjetas de cada canal (Habilitado/Deshabilitado y estado de la integración) y tocá **Habilitar** o **Deshabilitar**.
2. Filtrá por portal, estado o «Código o título» y tocá **Filtrar**.
3. En una publicación con error o pendiente, tocá **Reintentar**.

Al publicar una propiedad se envía a todos los portales habilitados: hoy no se elige portal por propiedad. Si un portal falla, el dato del CRM no cambia. Mercado Libre usa su API oficial; Argenprop y Zonaprop no tienen API pública y no se envía nada hasta un acuerdo comercial. Con el flag `portal_sync` apagado, los cambios quedan pendientes.

## Propiedades migradas del sitio anterior
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read, migration.review -->

Las propiedades que vinieron de la migración del sitio anterior tienen la etiqueta **Migrada** en la ficha y en Datos figuran el «Origen» (Migración y fecha), «Verificada» y «Campos protegidos».

- **Campos protegidos**: cada dato que una persona corrige en el CRM (texto, estado, publicación, precio, agentes, fotos, características) queda protegido y una reimportación no lo pisa. Al editar ves «Esta propiedad vino de la migración: los campos que edites quedan protegidos y una reimportación no los pisa.».
- **Verificar**: con `migration.review`, después de comparar la ficha con el sitio anterior tocá **Marcar como verificada** y confirmá. Queda registrada la fecha y quién la verificó; se puede repetir con **Volver a marcar como verificada**.
- Las fotos que siguen apuntando al sitio anterior muestran **En sitio anterior**.

Las advertencias generales de la migración se revisan en **Migración** (`/crm/migracion`).
