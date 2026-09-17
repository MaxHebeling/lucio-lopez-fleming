---
dominio: marketing
titulo: Director de marketing y ficha imprimible
resumen: Borradores por canal desde una propiedad (SEO, Instagram, Facebook, WhatsApp, email y guion de Reel), revisión humana y ficha imprimible en PDF.
permisos: marketing.read
---

## Generar borradores de marketing desde una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: marketing.create -->

En la ficha de la propiedad, sección **Marketing**, tocá **Generar borradores**. Se arman borradores para **Sitio web (SEO)**, **Instagram**, **Facebook**, **WhatsApp**, **Email** y **Guion de Reel** usando solo los datos cargados en la ficha: tipo, operación, zona, ambientes, dormitorios, baños, superficies, cocheras, características, precio (si no está oculto) y el link de la ficha. No se agregan adjetivos sobre lo que no consta (nada de «vista increíble» si la ficha no lo dice).

Si la IA está configurada aparece **Redactar con IA**: el modelo redacta con los mismos datos y el sistema revisa el texto; si menciona cifras, links o características que la ficha no tiene, se descarta y quedan las plantillas (lo avisa).

Regenerar con los mismos datos no crea nada nuevo. Un borrador que editaste a mano nunca se pisa al regenerar.

## Revisar y publicar los borradores de Instagram y Facebook
<!-- ruta: /crm/marketing; permisos: marketing.read -->

Los borradores de Instagram y Facebook del director de marketing van a la misma cola de **Contenido** que el resto, en estado borrador, con la portada y hasta 9 fotos. Desde la sección Marketing de la ficha tocá **Revisar, elegir fotos y aprobar**. Aprobar, programar y publicar siguen siendo acciones de una persona con permiso: nada se publica solo.

## Editar, copiar o descartar los borradores de SEO, WhatsApp, email y Reel
<!-- ruta: /crm/propiedades/[id]; permisos: marketing.create -->

En la sección **Marketing** de la ficha cada borrador se puede editar y tocar **Guardar cambios** (queda como «Editado»), **Copiar** para pegarlo en WhatsApp o en el correo, o **Descartar**. WhatsApp y email no se envían desde acá: los copia y envía una persona.

## Aplicar el título y la descripción SEO a la ficha
<!-- ruta: /crm/propiedades/[id]; permisos: properties.update -->

En el borrador **Sitio web (SEO)** tocá **Aplicar a la ficha** y confirmá. Reemplaza el Título SEO y la Descripción SEO de la propiedad (se ven en Datos) y queda en la auditoría. Necesitás además permiso para editar propiedades; guardá los cambios del borrador antes de aplicarlo.

## Ficha imprimible o PDF de una propiedad
<!-- ruta: /crm/propiedades/[id]; permisos: properties.read -->

En la sección **Marketing** de la ficha tocá **Ficha imprimible**: se abre una hoja con la marca, fotos, datos principales, características, descripción y el link de la ficha. Tocá **Imprimir / Guardar PDF** y elegí «Guardar como PDF» para enviarla. Solo muestra datos públicos: sin altura si la dirección está oculta, «Consultar» si el precio está oculto y nunca propietarios, notas ni documentos.
