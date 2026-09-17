-- 0410 — Sitio público: invalidación de la caché ante cambios de propiedades que no pasan por la UI del CRM
-- (alquileres que marcan una propiedad alquilada, jobs, importador). La acción `revalidate_public_site` vive en
-- src/server/site/revalidate.ts. Los cambios hechos desde el CRM ya invalidan en la misma petición; esto es la red
-- para el resto. Idempotente: invalidar dos veces no tiene efecto.
insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('site_revalidate_property_updated', 'Actualizar el sitio: propiedad modificada',
   'Invalida la caché del sitio público cuando cambia una propiedad (datos, fotos o asesor).',
   'property.updated', '[]', '[{"type":"revalidate_public_site"}]', true, true),
  ('site_revalidate_property_published', 'Actualizar el sitio: propiedad publicada',
   'Invalida la caché del sitio público cuando se publica una propiedad.',
   'property.published', '[]', '[{"type":"revalidate_public_site"}]', true, true),
  ('site_revalidate_property_unpublished', 'Actualizar el sitio: propiedad despublicada',
   'Invalida la caché del sitio público cuando se despublica una propiedad.',
   'property.unpublished', '[]', '[{"type":"revalidate_public_site"}]', true, true),
  ('site_revalidate_property_status', 'Actualizar el sitio: cambio de estado',
   'Invalida la caché del sitio público cuando una propiedad cambia de estado (reservada, vendida, alquilada).',
   'property.status_changed', '[]', '[{"type":"revalidate_public_site"}]', true, true),
  ('site_revalidate_property_price', 'Actualizar el sitio: cambio de precio',
   'Invalida la caché del sitio público cuando cambia el precio de una propiedad.',
   'property.price_changed', '[]', '[{"type":"revalidate_public_site"}]', true, true)
on conflict (key) do nothing;
