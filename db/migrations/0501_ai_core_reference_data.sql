-- 0501 — Datos de referencia del AI Core (idempotente: también lo recargan los tests).

insert into permissions(key, module, description) values
  ('ai.copilot', 'ai', 'Usar el Asistente IA del CRM (solo responde con lo que el propio rol ya puede ver)'),
  ('ai.read_usage', 'ai', 'Ver uso, costos, calidad y feedback de la IA')
on conflict (key) do nothing;

insert into role_permissions(role_key, permission_key)
  select r, 'ai.copilot' from unnest(array['super_admin', 'direccion', 'administrador', 'agente', 'alquileres', 'marketing', 'solo_lectura']) r
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select r, 'ai.read_usage' from unnest(array['super_admin', 'direccion', 'administrador']) r
on conflict do nothing;

-- Fase 1: el copiloto encendido (sin clave muestra su estado honesto y el modo Analista determinista).
-- Fases siguientes: registradas y APAGADAS hasta que se construyan y validen.
insert into feature_flags(key, enabled, description) values
  ('ai_copilot', true, 'Asistente IA del CRM (guía + analista). Sin ANTHROPIC_API_KEY responde con la guía y consultas directas, sin modelo'),
  ('ai_concierge', false, 'Fase 2 · Conserje comercial de IA para leads (no construido todavía)'),
  ('ai_matching', false, 'Fase 2 · Cruce de necesidades del cliente con propiedades (no construido todavía)'),
  ('ai_property_qa', false, 'Fase 3 · Control de calidad de fichas con IA (no construido todavía)'),
  ('ai_visit_brief', false, 'Fase 4 · Resumen previo a visitas (no construido todavía)'),
  ('ai_followup', false, 'Fase 4 · Sugerencias de seguimiento post-visita (no construido todavía)'),
  ('ai_executive', false, 'Fase 5 · Reporte ejecutivo con IA para dirección (no construido todavía)'),
  ('ai_automations', false, 'Fase 5 · Recomendaciones de IA dentro de automatizaciones (no construido todavía)')
on conflict (key) do nothing;

-- Ruteo de modelos por tarea (valores JSON). Solo se aceptan modelos con precio conocido en src/server/ai/pricing.ts.
insert into settings(key, value) values
  ('ai.model.classify', '"claude-haiku-4-5-20251001"'),
  ('ai.model.extract', '"claude-haiku-4-5-20251001"'),
  ('ai.model.answer', '"claude-sonnet-5"'),
  ('ai.model.analyze', '"claude-sonnet-5"'),
  ('ai.model.vision', '"claude-sonnet-5"'),
  ('ai.copilot.requests_per_hour', '60'),
  ('ai.copilot.session_retention_days', '30'),
  ('ai.analyst.stale_opportunity_days', '14')
on conflict (key) do nothing;
