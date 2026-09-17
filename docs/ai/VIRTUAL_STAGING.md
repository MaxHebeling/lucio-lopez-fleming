# Staging virtual (amoblamiento virtual) — arquitectura, NO implementado

Estado: **solo diseño**. No hay código de generación, ni prompts, ni tablas, ni flag creado. Este documento fija las
reglas que cualquier implementación futura tiene que cumplir antes de mergearse.

## Por qué no se implementa todavía

Una imagen generada que se confunda con una foto real es publicidad engañosa (Ley 24.240 de Defensa del Consumidor,
art. 9; y confianza de marca de una inmobiliaria con trayectoria desde 1974). Requiere un proveedor de generación de
imágenes con licencia comercial clara, storage S3 configurado (hoy faltan las claves en producción) y un flujo de
revisión humana. Nada de eso existe hoy.

## Reglas obligatorias

1. **Marca visible e inseparable**: toda imagen virtual lleva, quemada en el píxel (no solo en `alt` o en HTML), la
   leyenda **«REPRESENTACIÓN VIRTUAL»** en una esquina, legible a 400 px de ancho, con contraste AA. Además, en el sitio,
   un rótulo textual «Representación virtual: amoblamiento generado, no es el estado real» junto a la imagen.
2. **Original | virtual**: cada imagen virtual referencia su foto original (`source_media_id`) y el sitio muestra el par
   (comparador o pestaña «Original»). Nunca se publica una virtual sin su original publicado.
3. **Nunca como estado real**: no puede ser portada, no entra en los portales (Zonaprop, Argenprop, Mercado Libre), ni
   en borradores de redes sin la marca, ni en la ficha imprimible; no alimenta el análisis de calidad (duplicadas,
   luz, nitidez) ni las sugerencias de ambiente.
4. **Almacenamiento separado**: prefijo propio `properties/{id}/virtual-staging/` en el bucket público, filas en una
   tabla propia (`property_virtual_stagings`: `id`, `property_id`, `source_media_id`, `file_id`, `style`, `status`
   draft|approved|published|withdrawn, `provider`, `model`, `prompt_version`, `approved_by`, `approved_at`, auditoría),
   **nunca** en `property_media`. Borrar la original retira la virtual.
5. **Flag** `ai_virtual_staging` (apagado por defecto) + permiso propio `properties.virtual_staging` (marketing y
   administración). Con el flag apagado no se sirve ninguna virtual aunque existan filas.
6. **Human in the loop**: generar = borrador; publicar exige aprobación de una persona con permiso (CHECK
   `status <> 'published' or approved_by is not null`, igual que `social_posts`).
7. **Gobernanza del AI Core**: proveedor detrás de `AIProvider` (nueva capacidad `image_edit`), ruteo por tarea,
   presupuesto diario, registro en `ai_interactions` (sin imágenes), circuit breaker, prompt versionado, y prohibición
   de cambiar estructura (paredes, ventanas, vistas, dimensiones): solo mobiliario y decoración. Rechazo automático si
   el proveedor no garantiza preservación estructural.
8. **Evento** `media.virtual_staging_published` (sin datos personales) y automatización de revalidación del sitio.

## Tests mínimos exigidos para mergear una implementación

Marca en píxeles (detección en imagen generada en test), virtual nunca en portales/portada/ficha imprimible, flag
apagado oculta todo, aprobación obligatoria (constraint), borrado en cascada al retirar la original, RBAC.
