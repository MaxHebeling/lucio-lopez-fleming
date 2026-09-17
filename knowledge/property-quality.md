---
dominio: properties
titulo: Calidad de la publicación, fotos e inventario
resumen: Informe de calidad de cada ficha (score, faltantes, inconsistencias, fotos), director de fotos (ambientes, orden y portada sugeridos) y análisis de inventario.
permisos: properties.read
---

## Qué es la calidad de la publicación de una ficha
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

En la ficha de cada propiedad, la primera sección es **Calidad de la publicación**. Muestra un score de 0 a 100, la **completitud**, **Qué falta** y **Avisos**. El informe lo arma el sistema con reglas fijas (no es una opinión de la IA ni una tasación) y **nunca modifica la ficha**: solo te dice qué revisar.

Se recalcula solo cuando guardás cambios en la propiedad, en el precio, en el estado o en las fotos, y además cada noche. Si ves «hay cambios posteriores», el recálculo está en camino. El botón **Recalcular** lo hace en el momento.

Cada faltante tiene un link **Completar** que te lleva a la sección exacta (por ejemplo, al campo Descripción del formulario de edición o a la sección Multimedia). Cada aviso tiene **Revisar**.

## Cómo se calcula el score de calidad (pesos)
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

La completitud suma puntos (total 100): foto de portada 10, al menos 5 fotos 8, foto de fachada o exterior etiquetada 5, plano 6, tour 360° publicado 4 (solo residenciales), descripción de 200 o más caracteres 12, precio en una operación activa 12, ubicación 8, calle 3, punto en el mapa 3, superficies 8, dormitorios 5 y baños 3 (solo residenciales), orientación 3 (residenciales y terrenos), al menos 3 características 4 y agente responsable 6. Lo que no aplica al tipo cuenta como cumplido.

Al score se le restan puntos por avisos, con tope: 5 por cada inconsistencia de datos (máximo 15), 3 por cada foto repetida (máximo 9) y 2 por cada foto posiblemente oscura o borrosa (máximo 10).

Si la ficha está publicada y le falta precio, ubicación o portada, el faltante se marca como **Importante**.

## Qué avisos puede mostrar el informe de calidad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

- **Dormitorios y ambientes no cierran**: hay más dormitorios que ambientes (o igual).
- **Superficie cubierta mayor que la total**.
- **Terreno menor que la superficie cubierta** en casas: puede ser correcto si tiene más de una planta; si el campo Plantas dice 2 o más, no se marca.
- **Precio por m² muy por debajo o muy por encima de comparables**: solo aparece si hay al menos 8 propiedades del mismo tipo, operación, moneda y localidad para comparar. No es una tasación: sirve para detectar un precio o una superficie mal cargados.
- **Descripción en mayúsculas** o **La descripción no menciona datos que sí están cargados** (por ejemplo dormitorios o metros).
- **Fotos repetidas**, **posiblemente oscuras** o **posiblemente borrosas**.
- **Fotos no analizadas: fotos externas**.

## Por qué algunas fotos dicen «no analizada: foto externa»
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

Las fotos que vinieron del sitio anterior se muestran desde su dirección original y **no se descargan** para analizarlas (hacerlo en masa bloquea el acceso al sitio anterior). Por eso no se revisan luz, nitidez ni repetidas en esas fotos. Las fotos que subís al CRM desde Multimedia sí se analizan.

La luz se mide con la luminancia de la imagen, la nitidez comparando bordes y contraste al tamaño en que se ve en la ficha, y las repetidas con una huella de la imagen: la misma foto re-subida o apenas recortada se detecta como repetida.

## Filtrar y ordenar propiedades por calidad
<!-- ruta: /crm/propiedades; permisos: properties.read -->

En el listado de **Propiedades**, abrí **Más filtros** y elegí **Calidad de la publicación**: Baja (menos de 55), Mejorable (55 a 79), Buena (80 o más) o Sin informe todavía. En **Orden** podés elegir **Calidad (peor primero)** o **Calidad (mejor primero)**. Cada fila muestra el score en una etiqueta.

## Etiquetar el ambiente de cada foto
<!-- ruta: /crm/propiedades/[id]; permisos: properties.manage_media -->

En la sección **Multimedia** de la ficha, cada foto tiene el selector **Ambiente**: Fachada, Living, Cocina, Comedor, Dormitorio, Baño, Jardín, Piscina, Exterior, Plano u Otro. Al elegir un valor se guarda solo (queda en la auditoría). Etiquetar sirve para el orden y la portada sugeridos, para el guion de Reel y para el criterio «Foto de fachada o exterior etiquetada» del score.

Las fotos del sitio anterior también se pueden etiquetar.

## Sugerencias de ambientes con IA
<!-- ruta: /crm/propiedades/[id]; permisos: properties.manage_media -->

Si la IA está configurada, en **Director de fotos** aparece **Sugerir ambientes con IA** para las fotos subidas al CRM que todavía no tienen etiqueta. La IA mira una versión chica de cada foto y propone un ambiente con su confianza. Nada cambia hasta que vos tocás **Aceptar** (o **Aceptar las N sugerencias**); también podés **Descartar**. Una etiqueta aceptada dice «Sugerida por IA y aceptada por una persona».

Sin IA configurada, el botón no aparece: se etiqueta a mano.

## Orden y portada sugeridos de las fotos
<!-- ruta: /crm/propiedades/[id]; permisos: properties.manage_media -->

Con al menos una foto etiquetada, **Director de fotos** muestra un orden y una portada sugeridos con sus motivos: primero una fachada (o living, exterior, jardín…) sin problemas de luz, nitidez ni repetición; después una foto por ambiente en orden de recorrido; al final los planos y las fotos posiblemente oscuras, borrosas o repetidas. **Nunca se borra ninguna foto.**

Para usarlo tocá **Aplicar orden sugerido** y confirmá. Cambia el orden y la portada en el sitio y los portales, queda en la auditoría y lo podés volver a ordenar a mano. Si otra persona cambió las fotos mientras mirabas, no se aplica y te pide recargar.

## Análisis de inventario
<!-- ruta: /crm/propiedades/inventario; permisos: properties.read -->

Desde **Propiedades** tocá **Análisis de inventario**. Lista las publicaciones activas con días publicadas, consultas (leads) y visitas agendadas desde que se publicaron, y el score de calidad. Las consultas se ven con permiso para ver los leads de todo el equipo.

Se marca una **oportunidad de revisión** cuando una publicación lleva 30 o más días y tiene 2 consultas o menos, por ejemplo «47 días publicada · pocas consultas (1) · revisar: hero, precio, descripción, calidad visual». Lo que conviene revisar sale del informe de calidad (portada, precio, descripción, fotos). **No indica la causa**: es una sugerencia. La mediana de consultas solo se muestra con al menos 10 publicaciones comparables.
