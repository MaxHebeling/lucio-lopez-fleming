-- 0531 — Datos de referencia de IA Fase 5 (AI Management) y Fase 6 (AI Automation). Idempotente: también lo recargan
-- los tests.

-- ───────────── Permiso de dirección ─────────────
insert into permissions(key, module, description) values
  ('ai.executive', 'ai', 'Ver el Centro de comando y hacer preguntas de dirección al Asistente IA (métricas de todo el equipo)')
on conflict (key) do nothing;

insert into role_permissions(role_key, permission_key)
  select r, 'ai.executive' from unnest(array['super_admin', 'direccion', 'administrador']) r
on conflict do nothing;

-- ───────────── Flags ─────────────
-- Nuevos, encendidos: la capa determinista está completa y testeada. Se apagan en Integraciones → Feature flags.
insert into feature_flags(key, enabled, description) values
  ('ai_daily_brief', true, 'Fase 5 · «Resumen de hoy» al tope del Tablero (conteos reales por rol y alcance; con clave, 2–3 líneas redactadas separando hechos de interpretación)'),
  ('ai_task_center', true, 'Fase 5 · «Tareas sugeridas» (bandeja unificada: aceptar crea la tarea real) y detección de anomalías con evidencia')
on conflict (key) do nothing;

-- Registrados en 0501 como «no construido todavía»: se encienden UNA vez (después un administrador puede apagarlos sin
-- que una migración los vuelva a prender).
update feature_flags set enabled = true,
  description = 'Fase 5 · Centro de comando y preguntas de dirección en el modo Analista (hechos con definición, período y origen; interpretación separada)'
 where key = 'ai_executive' and description like '%no construido todavía%';
update feature_flags set enabled = true,
  description = 'Fase 6 · Reacciones de IA sobre eventos de negocio (visita finalizada, propiedad publicada, lead nuevo, informe confirmado). Solo sugerencias y borradores: nunca envía ni publica'
 where key = 'ai_automations' and description like '%no construido todavía%';

-- ───────────── Settings ─────────────
insert into settings(key, value) values
  -- Resumen de hoy: minutos de cache por usuario y tope de redacciones con IA por usuario y día
  ('ai.daily_brief.cache_minutes', '10'),
  ('ai.daily_brief.max_ai_per_day', '6'),
  -- Tareas sugeridas: tope de clientes evaluados por corrida (siguiente acción) y días máximos para posponer
  ('ai.task_center.max_contacts_per_run', '300'),
  ('ai.task_center.max_snooze_days', '90'),
  -- Calidad baja (mismo corte que el filtro «Calidad baja» del listado de propiedades)
  ('ai.task_center.low_quality_score', '55'),
  -- Anomalías (docs/ai/MANAGEMENT.md › Anomalías: umbrales y por qué)
  ('ai.anomalies.lead_uncontacted_hours', '24'),
  ('ai.anomalies.lead_uncontacted_critical_hours', '72'),
  ('ai.anomalies.visit_followup_hours', '48'),
  ('ai.anomalies.inquiry_baseline_weeks', '8'),
  ('ai.anomalies.inquiry_recent_days', '14'),
  ('ai.anomalies.inquiry_min_baseline', '8'),
  ('ai.anomalies.inquiry_min_expected', '4'),
  ('ai.anomalies.inquiry_max_ratio', '0.25'),
  ('ai.anomalies.inquiry_p_value', '0.05'),
  ('ai.anomalies.job_dead_min', '5'),
  ('ai.anomalies.ai_min_requests', '20'),
  ('ai.anomalies.ai_error_rate', '0.3'),
  ('ai.anomalies.max_notifications_per_user_per_day', '5'),
  -- Motor de automatizaciones: profundidad máxima de una cadena de eventos derivados
  ('ai.events.max_depth', '3')
on conflict (key) do nothing;

-- ───────────── Reacciones de IA (automatizaciones de sistema) ─────────────
-- Se crean DESACTIVADAS: si esta migración se aplica minutos antes que el código, el motor anterior no las despacha
-- (no quedan jobs muertos por acciones que todavía no existen). Las activa la versión nueva del código
-- (`syncAiReactions`: flag `ai_automations` encendido + acciones registradas). Ver docs/ai/AUTOMATION.md.
insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('ai_reaction_visit_finished', 'IA: visita finalizada',
   'Sugiere cargar el informe y preparar el agradecimiento, y actualiza la siguiente acción del cliente. No envía nada.',
   'appointment.finished', '[]', '[{"type":"ai_react_visit_finished"}]', false, true),
  ('ai_reaction_property_published', 'IA: propiedad publicada',
   'Prepara borradores de marketing (plantillas, sin publicar) y sugiere revisarlos al agente responsable. El match inverso lo hace «Ventas: clientes compatibles».',
   'property.published', '[]', '[{"type":"ai_react_property_published"}]', false, true),
  ('ai_reaction_lead_created', 'IA: lead nuevo',
   'Actualiza la siguiente acción del cliente y deja la tarea sugerida al agente (prioridad alta si hay señales fuertes). La calificación la hace «Ventas: calificar lead».',
   'lead.created', '[]', '[{"type":"ai_react_lead_created"}]', false, true),
  ('ai_reaction_report_confirmed', 'IA: informe de visita confirmado',
   'Propone datos del perfil del comprador SUGERIDOS (nunca confirmados) y el seguimiento sugerido. No envía nada.',
   'visit.report_confirmed', '[]', '[{"type":"ai_react_report_confirmed"}]', false, true)
on conflict (key) do nothing;
