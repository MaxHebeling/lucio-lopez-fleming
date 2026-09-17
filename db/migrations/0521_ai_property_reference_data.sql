-- 0521 — Datos de referencia de AI Property + IA de visitas (idempotente: también lo recargan los tests).

-- ───────────── Flags ─────────────
-- Nuevos: encendidos los que tienen su capa determinista completa y testeada (docs/ai/PROPERTY.md › Flags).
insert into feature_flags(key, enabled, description) values
  ('ai_photo_director', true, 'Fase 3 · Ambiente por foto (manual; con clave, sugerencias de visión a aceptar) y orden/portada sugeridos por reglas'),
  ('ai_marketing_director', true, 'Fase 3 · Borradores de marketing por propiedad (SEO, Instagram, Facebook, WhatsApp, email, Reel) y ficha imprimible. Sin publicación automática'),
  ('ai_tour_guide', true, 'Fase 3 · «Preguntá por esta casa» dentro del tour 360°: caminos entre ambientes y datos registrados (determinista; con clave, interpretación de la pregunta)'),
  ('owner_capture_steps', true, 'Fase 3 · «Quiero vender mi propiedad» paso a paso en el home (mismo lead sell_my_property)'),
  ('owner_capture_photos', false, 'Fase 3 · Paso opcional de fotos en la captación de propietarios. Requiere storage S3 configurado; apagado hasta tenerlo')
on conflict (key) do nothing;

-- Registrados en 0501 como «no construido todavía»: se encienden UNA vez (la descripción cambia y el guard ya no aplica,
-- así un administrador puede apagarlos después sin que una migración los vuelva a prender).
update feature_flags set enabled = true,
  description = 'Fase 3 · Calidad de la publicación (completitud ampliada, inconsistencias, fotos duplicadas/oscuras/borrosas) y análisis de inventario. Nunca modifica datos'
 where key = 'ai_property_qa' and description like '%no construido todavía%';
update feature_flags set enabled = true,
  description = 'Fase 4b · Brief previo a la visita (determinista con «NO REGISTRADO»; con clave, redacción separando hechos de interpretación)'
 where key = 'ai_visit_brief' and description like '%no construido todavía%';
update feature_flags set enabled = true,
  description = 'Fase 4b · Seguimiento sugerido con motivo desde el informe confirmado (la tarea se crea solo al confirmar); con clave, propuesta de informe y agradecimiento'
 where key = 'ai_followup' and description like '%no construido todavía%';

-- ───────────── Settings ─────────────
insert into settings(key, value) values
  -- Precio fuera de rango: solo con al menos N comparables (mismo tipo, operación, moneda y localidad)
  ('ai.property_quality.price_min_sample', '8'),
  -- Factor contra la mediana de precio por m² de los comparables (0,5× y 2× por defecto)
  ('ai.property_quality.price_low_factor', '0.5'),
  ('ai.property_quality.price_high_factor', '2'),
  -- Fotos analizadas por corrida del job (descarga desde NUESTRO storage; nunca del CDN del sitio anterior)
  ('ai.property_quality.max_media_per_run', '40'),
  -- Visión: imágenes por corrida del job de sugerencias (con presupuesto diario)
  ('ai.photo_director.vision_batch_size', '12'),
  -- Análisis de inventario: días mínimos publicada y consultas mínimas para marcar «pocas consultas»
  ('ai.inventory.min_days_published', '30'),
  ('ai.inventory.low_leads_threshold', '2'),
  -- Brief de visita: refresco antes del inicio
  ('ai.visit_brief.refresh_hours_before', '2')
on conflict (key) do nothing;

-- ───────────── Plantillas de marketing (reutiliza content_templates; editables) ─────────────
-- Regla de renderContentTemplate: una línea cuyos marcadores quedan todos vacíos se omite. Nada se inventa.
insert into content_templates(key, channel, name, body) values
  ('ai_director_instagram', 'instagram', 'Director de marketing · Instagram',
   E'{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{cocheras}}\n{{destacados}}\n{{precio}}\n\nCódigo {{codigo}} · Ficha completa en el link de la bio\n\n{{inmobiliaria}}\n\n{{hashtags}}'),
  ('ai_director_facebook', 'facebook', 'Director de marketing · Facebook',
   E'{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{resumen}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{cocheras}}\n{{destacados}}\n{{precio}}\n\nCódigo {{codigo}}\nFicha completa: {{link}}\n\n{{inmobiliaria}}'),
  ('ai_director_whatsapp', 'whatsapp', 'Director de marketing · WhatsApp',
   E'Hola, te comparto esta propiedad de {{inmobiliaria_nombre}}:\n\n*{{titulo}}*\n{{tipo}} en {{operacion}} · {{localidad}}\n{{ambientes}}\n{{dormitorios}}\n{{superficie}}\n{{precio}}\n\nFicha completa: {{link}}\n¿Te gustaría coordinar una visita?'),
  ('ai_director_email', 'email', 'Director de marketing · Email',
   E'{{saludo}}\n\nTe acercamos una propiedad que puede interesarte: {{titulo}}, {{tipo_minuscula}} en {{operacion}} en {{localidad}}.\n\n{{resumen}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{destacados}}\n{{precio}}\n\nVer la ficha completa: {{link}}\n\nSi querés coordinar una visita, respondé este correo.\n\n{{inmobiliaria}}')
on conflict (key) do nothing;

-- ───────────── Automatizaciones de sistema (recálculo por evento) ─────────────
-- Solo ENCOLAN un job idempotente (dedupe por propiedad/visita). `property.quality_computed`, `visit.brief_prepared`,
-- etc. no los escucha ninguna automatización: no hay loops.
insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('ai_quality_property_created', 'Calidad de la publicación: propiedad creada',
   'Calcula el informe de calidad de la publicación (no modifica la propiedad).', 'property.created', '[]', '[{"type":"enqueue_property_quality"}]', true, true),
  ('ai_quality_property_updated', 'Calidad de la publicación: propiedad o fotos modificadas',
   'Recalcula el informe de calidad cuando cambian datos o multimedia.', 'property.updated', '[]', '[{"type":"enqueue_property_quality"}]', true, true),
  ('ai_quality_property_price', 'Calidad de la publicación: cambio de precio',
   'Recalcula el informe de calidad cuando cambia el precio.', 'property.price_changed', '[]', '[{"type":"enqueue_property_quality"}]', true, true),
  ('ai_quality_property_status', 'Calidad de la publicación: cambio de estado',
   'Recalcula el informe de calidad cuando cambia el estado.', 'property.status_changed', '[]', '[{"type":"enqueue_property_quality"}]', true, true),
  ('ai_quality_property_published', 'Calidad de la publicación: publicada',
   'Recalcula el informe de calidad al publicar.', 'property.published', '[]', '[{"type":"enqueue_property_quality"}]', true, true),
  ('ai_visit_brief_created', 'Brief de visita: visita creada',
   'Prepara el brief previo de la visita (datos registrados y «NO REGISTRADO»).', 'appointment.created', '[]', '[{"type":"enqueue_visit_brief"}]', true, true),
  ('ai_visit_brief_assigned', 'Brief de visita: visita asignada',
   'Actualiza el brief previo cuando la visita se asigna a otro agente.', 'appointment.assigned', '[]', '[{"type":"enqueue_visit_brief"}]', true, true)
on conflict (key) do nothing;
