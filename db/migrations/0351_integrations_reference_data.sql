-- 0351 — Datos de referencia de integraciones (idempotente: los tests lo recargan tras truncar).
-- Plantillas de copy: solo datos reales de la propiedad. Cada línea cuyo(s) marcador(es) quedan vacíos se omite
-- (p. ej. sin dormitorios cargados no aparece la línea de dormitorios; con precio oculto no aparece el precio).
-- Marcadores: {{tipo}} {{operacion}} {{localidad}} {{titulo}} {{ambientes}} {{dormitorios}} {{banos}}
-- {{superficie}} {{precio}} {{codigo}} {{link}} {{inmobiliaria}}

insert into content_templates(key, channel, name, body) values
  ('property_published_instagram', 'instagram', 'Propiedad publicada · Instagram',
   E'{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{precio}}\n\nCódigo {{codigo}} · Ficha completa en {{link}}\n\n{{inmobiliaria}}'),
  ('property_published_facebook', 'facebook', 'Propiedad publicada · Facebook',
   E'{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{precio}}\n\nCódigo {{codigo}}\nFicha completa: {{link}}\n\n{{inmobiliaria}}')
on conflict (key) do nothing;

-- La sincronización con portales también debe correr al publicar y al despublicar
-- (property.updated no se emite en esos flujos).
insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('property_portal_sync_published', 'Sincronizar portales al publicar',
   'Encola la publicación en los portales habilitados cuando se publica una propiedad.',
   'property.published', '[]', '[{"type":"sync_publications"}]', true, true),
  ('property_portal_sync_unpublished', 'Sincronizar portales al despublicar',
   'Encola la baja (pausa) en los portales cuando se despublica una propiedad.',
   'property.unpublished', '[]', '[{"type":"sync_publications"}]', true, true),
  ('lead_internal_email', 'Aviso interno por email de lead nuevo',
   'Encola un email a EMAIL_INTERNAL_TO con el resumen del lead (sin teléfono ni email del contacto).',
   'lead.created', '[]', '[{"type":"notify_email_internal","template":"lead_internal_notice"}]', true, true)
on conflict (key) do nothing;
