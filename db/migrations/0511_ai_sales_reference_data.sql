-- 0511 — Datos de referencia de IA Fase 2 · Ventas (idempotente: también lo recargan los tests).

-- Flags: la capa determinista está completa y testeada → encendidos. Se apagan en Integraciones → Feature flags
-- (sin redeploy). Apagados, el sitio y el CRM quedan exactamente como antes de la Fase 2.
insert into feature_flags(key, enabled, description) values
  ('site_compare', true, 'Sitio · Comparador de hasta 3 propiedades (datos publicados, sin IA; resumen redactado solo con clave)')
on conflict (key) do nothing;
update feature_flags set enabled = true,
  description = 'Fase 2 · Concierge del sitio: «Contanos qué buscás» → filtros reales del buscador (determinista; con clave, extracción con IA validada)'
  where key = 'ai_concierge';
update feature_flags set enabled = true,
  description = 'Fase 2 · Perfil del comprador, coincidencias cliente ↔ propiedad, señales de interés y siguiente acción en el CRM'
  where key = 'ai_matching';
update feature_flags set enabled = true,
  description = 'Fase 2 · «Preguntale a esta propiedad» en la ficha pública (solo datos publicados; con clave, redacción con guardas)'
  where key = 'ai_property_qa';

insert into settings(key, value) values
  -- IA pública (sitio, anónima): presupuesto propio dentro del diario general y límite por IP
  ('ai.public.daily_budget_usd', '1'),
  ('ai.public.requests_per_ip_per_hour', '30'),
  -- Coincidencias: tolerancia de presupuesto (%), puntaje mínimo para listar y aviso al agente responsable
  ('ai.matching.budget_tolerance_pct', '10'),
  ('ai.matching.min_score', '55'),
  ('ai.matching.notify_agents', 'true')
on conflict (key) do nothing;

-- Automatizaciones de sistema (acciones en src/server/sales/jobs.ts). Idempotentes; ninguna contacta al cliente.
insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('sales_lead_qualify', 'Ventas: calificar lead',
   'Arma el resumen del lead, propone la siguiente acción y (con clave de IA) sugiere datos del perfil a partir de la consulta.',
   'lead.created', '[]', '[{"type":"sales_qualify_lead"}]', true, true),
  ('sales_match_property_published', 'Ventas: clientes compatibles con una propiedad publicada',
   'Calcula clientes compatibles (match inverso) y avisa al agente responsable. No contacta a nadie.',
   'property.published', '[]', '[{"type":"sales_match_property","trigger":"property_published"}]', true, true),
  ('sales_match_property_price', 'Ventas: clientes compatibles tras un cambio de precio',
   'Recalcula clientes compatibles cuando cambia el precio y avisa al agente responsable. No contacta a nadie.',
   'property.price_changed', '[]', '[{"type":"sales_match_property","trigger":"price_changed"}]', true, true)
on conflict (key) do nothing;
