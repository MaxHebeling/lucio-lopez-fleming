-- 0171 — Tours virtuales: flag y automatizaciones de sistema (idempotente; también lo recargan los tests).
insert into feature_flags(key, enabled, description) values
  ('virtual_tours', true, 'Tours virtuales 360° en las fichas y demo pública /demo/tour-360')
on conflict (key) do nothing;

-- Cambios en tours (publicar, despublicar, editar uno publicado) invalidan la caché del sitio público.
insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('site_revalidate_tour_published', 'Actualizar el sitio: tour virtual publicado',
   'Invalida la caché del sitio público cuando se publica un tour virtual.',
   'virtual_tour.published', '[]', '[{"type":"revalidate_public_site"}]', true, true),
  ('site_revalidate_tour_unpublished', 'Actualizar el sitio: tour virtual despublicado',
   'Invalida la caché del sitio público cuando se despublica o se borra un tour virtual.',
   'virtual_tour.unpublished', '[]', '[{"type":"revalidate_public_site"}]', true, true),
  ('site_revalidate_tour_updated', 'Actualizar el sitio: tour virtual modificado',
   'Invalida la caché del sitio público cuando cambia un tour virtual (escenas, hotspots, plano).',
   'virtual_tour.updated', '[]', '[{"type":"revalidate_public_site"}]', true, true)
on conflict (key) do nothing;
