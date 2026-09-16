-- 0008 — Datos de referencia comunes a todos los entornos (idempotente).
-- Nada de esto es dato de negocio inventado: son catálogos del sistema (roles, permisos, tipos, etapas).

insert into roles(key, name, description, is_system) values
  ('super_admin', 'Super Admin', 'Acceso total, incluida la gestión de roles y permisos', true),
  ('direccion', 'Dirección', 'Visión completa del negocio, aprobaciones y reportes', true),
  ('administrador', 'Administrador', 'Operación diaria: propiedades, contactos, usuarios e integraciones', true),
  ('agente', 'Agente', 'Sus leads, oportunidades, agenda y propiedades asignadas', true),
  ('alquileres', 'Alquileres', 'Contratos, cobros, ajustes y liquidaciones', true),
  ('marketing', 'Marketing', 'Contenido, campañas y publicaciones', true),
  ('solo_lectura', 'Solo lectura', 'Consulta sin modificar', true)
on conflict (key) do nothing;

insert into permissions(key, module, description) values
  ('dashboard.read', 'dashboard', 'Ver el tablero'),
  ('properties.read', 'properties', 'Ver propiedades'),
  ('properties.create', 'properties', 'Crear propiedades'),
  ('properties.update', 'properties', 'Editar datos de propiedades'),
  ('properties.change_price', 'properties', 'Cambiar precios'),
  ('properties.change_status', 'properties', 'Reservar, vender, alquilar, pausar o archivar'),
  ('properties.publish', 'properties', 'Publicar y despublicar'),
  ('properties.manage_media', 'properties', 'Gestionar fotos, videos y planos'),
  ('properties.read_private', 'properties', 'Ver propietarios y documentos de la propiedad'),
  ('contacts.read', 'contacts', 'Ver contactos'),
  ('contacts.create', 'contacts', 'Crear contactos'),
  ('contacts.update', 'contacts', 'Editar contactos'),
  ('contacts.merge', 'contacts', 'Fusionar contactos duplicados'),
  ('contacts.read_private', 'contacts', 'Ver documentos de identidad y datos sensibles'),
  ('leads.read_all', 'leads', 'Ver todos los leads'),
  ('leads.read_own', 'leads', 'Ver leads asignados a uno mismo'),
  ('leads.create', 'leads', 'Cargar leads'),
  ('leads.update', 'leads', 'Actualizar leads'),
  ('leads.assign', 'leads', 'Asignar leads a agentes'),
  ('opportunities.read_all', 'opportunities', 'Ver todas las oportunidades'),
  ('opportunities.read_own', 'opportunities', 'Ver oportunidades propias'),
  ('opportunities.update', 'opportunities', 'Mover oportunidades en el pipeline'),
  ('agenda.read_all', 'agenda', 'Ver la agenda de todo el equipo'),
  ('agenda.manage', 'agenda', 'Agendar visitas, llamadas y reuniones'),
  ('tasks.manage', 'tasks', 'Crear y completar tareas'),
  ('conversations.read', 'conversations', 'Ver conversaciones de WhatsApp y redes'),
  ('conversations.reply', 'conversations', 'Responder y tomar conversaciones'),
  ('rentals.read', 'rentals', 'Ver contratos de alquiler'),
  ('rentals.manage', 'rentals', 'Crear y editar contratos'),
  ('rentals.register_payment', 'rentals', 'Registrar cobros'),
  ('rentals.void_payment', 'rentals', 'Anular cobros'),
  ('rentals.adjust', 'rentals', 'Calcular y aplicar ajustes'),
  ('settlements.generate', 'rentals', 'Generar liquidaciones'),
  ('settlements.approve', 'rentals', 'Aprobar y marcar pagadas las liquidaciones'),
  ('reports.read', 'reports', 'Ver reportes'),
  ('reports.generate', 'reports', 'Generar y enviar informes a propietarios'),
  ('marketing.read', 'marketing', 'Ver contenido y campañas'),
  ('marketing.create', 'marketing', 'Crear borradores de contenido'),
  ('marketing.approve', 'marketing', 'Aprobar y programar publicaciones'),
  ('publications.manage', 'publications', 'Gestionar la publicación en portales'),
  ('automations.read', 'automations', 'Ver automatizaciones y ejecuciones'),
  ('automations.manage', 'automations', 'Activar, desactivar y reintentar automatizaciones'),
  ('integrations.read', 'integrations', 'Ver el estado de integraciones'),
  ('integrations.manage', 'integrations', 'Configurar integraciones y feature flags'),
  ('users.read', 'users', 'Ver usuarios'),
  ('users.manage', 'users', 'Crear, desactivar e invitar usuarios'),
  ('roles.manage', 'users', 'Cambiar roles y permisos'),
  ('audit.read', 'audit', 'Ver el registro de auditoría'),
  ('migration.read', 'migration', 'Ver el estado de la migración'),
  ('migration.review', 'migration', 'Revisar advertencias y verificar propiedades migradas'),
  ('settings.manage', 'settings', 'Cambiar la configuración general')
on conflict (key) do nothing;

-- super_admin: todo
insert into role_permissions(role_key, permission_key)
  select 'super_admin', key from permissions
on conflict do nothing;

-- dirección: todo menos gestión de roles
insert into role_permissions(role_key, permission_key)
  select 'direccion', key from permissions where key <> 'roles.manage'
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select 'administrador', key from permissions
   where key not in ('roles.manage', 'settlements.approve', 'rentals.void_payment')
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select 'agente', unnest(array[
    'dashboard.read', 'properties.read', 'properties.create', 'properties.update', 'properties.manage_media',
    'contacts.read', 'contacts.create', 'contacts.update', 'leads.read_own', 'leads.create', 'leads.update',
    'opportunities.read_own', 'opportunities.update', 'agenda.manage', 'tasks.manage',
    'conversations.read', 'conversations.reply'])
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select 'alquileres', unnest(array[
    'dashboard.read', 'properties.read', 'properties.read_private', 'contacts.read', 'contacts.create',
    'contacts.update', 'contacts.read_private', 'rentals.read', 'rentals.manage', 'rentals.register_payment',
    'rentals.adjust', 'settlements.generate', 'reports.read', 'reports.generate', 'agenda.manage', 'tasks.manage'])
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select 'marketing', unnest(array[
    'dashboard.read', 'properties.read', 'properties.manage_media', 'marketing.read', 'marketing.create',
    'marketing.approve', 'publications.manage', 'reports.read'])
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select 'solo_lectura', unnest(array[
    'dashboard.read', 'properties.read', 'contacts.read', 'leads.read_all', 'opportunities.read_all',
    'agenda.read_all', 'rentals.read', 'reports.read', 'marketing.read', 'automations.read', 'integrations.read'])
on conflict do nothing;

insert into property_types(key, name, name_plural, category, sort_order, field_schema) values
  ('casa', 'Casa', 'Casas', 'residential', 10, '[{"key":"floors","label":"Plantas","type":"integer"},{"key":"has_pool","label":"Pileta","type":"boolean"}]'),
  ('departamento', 'Departamento', 'Departamentos', 'residential', 20, '[{"key":"floor_number","label":"Piso","type":"integer"},{"key":"elevators","label":"Ascensores","type":"integer"},{"key":"balcony","label":"Balcón","type":"boolean"}]'),
  ('ph', 'PH', 'PHs', 'residential', 30, '[{"key":"floor_number","label":"Piso","type":"integer"}]'),
  ('terreno', 'Terreno', 'Terrenos', 'land', 40, '[{"key":"frontage_m","label":"Frente","type":"number","unit":"m"},{"key":"depth_m","label":"Fondo","type":"number","unit":"m"},{"key":"zoning","label":"Zonificación","type":"text"},{"key":"fot","label":"FOT","type":"number"},{"key":"fos","label":"FOS","type":"number"}]'),
  ('lote', 'Lote', 'Lotes', 'land', 50, '[{"key":"frontage_m","label":"Frente","type":"number","unit":"m"},{"key":"depth_m","label":"Fondo","type":"number","unit":"m"},{"key":"lot_number","label":"Número de lote","type":"text"}]'),
  ('local', 'Local', 'Locales', 'commercial', 60, '[{"key":"frontage_m","label":"Frente","type":"number","unit":"m"},{"key":"trade_fund","label":"Fondo de comercio","type":"boolean"}]'),
  ('oficina', 'Oficina', 'Oficinas', 'commercial', 70, '[{"key":"floor_number","label":"Piso","type":"integer"},{"key":"offices_count","label":"Despachos","type":"integer"}]'),
  ('deposito', 'Depósito', 'Depósitos', 'commercial', 80, '[{"key":"ceiling_height_m","label":"Altura","type":"number","unit":"m"}]'),
  ('galpon', 'Galpón', 'Galpones', 'commercial', 90, '[{"key":"ceiling_height_m","label":"Altura","type":"number","unit":"m"},{"key":"bays","label":"Naves","type":"integer"},{"key":"truck_access","label":"Acceso camiones","type":"boolean"}]'),
  ('campo', 'Campo', 'Campos', 'rural', 100, '[{"key":"hectares","label":"Hectáreas","type":"number","unit":"ha"},{"key":"water","label":"Agua","type":"text"},{"key":"land_use","label":"Aptitud","type":"text"}]'),
  ('cochera', 'Cochera', 'Cocheras', 'other', 110, '[{"key":"covered","label":"Cubierta","type":"boolean"}]'),
  ('hotel', 'Hotel', 'Hoteles', 'commercial', 120, '[{"key":"hotel_rooms","label":"Habitaciones","type":"integer"},{"key":"stars","label":"Estrellas","type":"integer"}]'),
  ('negocio_especial', 'Negocio especial', 'Negocios especiales', 'commercial', 130, '[{"key":"business_type","label":"Rubro","type":"text"}]'),
  ('emprendimiento', 'Emprendimiento', 'Emprendimientos', 'development', 140, '[{"key":"possession_date","label":"Posesión","type":"date"},{"key":"units_count","label":"Unidades","type":"integer"}]'),
  ('otro', 'Otro', 'Otros', 'other', 999, '[]')
on conflict (key) do nothing;

insert into lead_sources(key, name, channel) values
  ('web_contact', 'Web · Contacto', 'web'),
  ('web_property', 'Web · Ficha de propiedad', 'web'),
  ('web_appraisal', 'Web · Tasación', 'web'),
  ('whatsapp', 'WhatsApp', 'whatsapp'),
  ('instagram', 'Instagram', 'instagram'),
  ('facebook', 'Facebook', 'facebook'),
  ('email', 'Email', 'email'),
  ('portal_argenprop', 'Argenprop', 'portal'),
  ('portal_zonaprop', 'Zonaprop', 'portal'),
  ('portal_mercadolibre', 'Mercado Libre', 'portal'),
  ('campaign', 'Campaña', 'campaign'),
  ('phone', 'Teléfono', 'phone'),
  ('walk_in', 'Oficina', 'walk_in'),
  ('manual', 'Carga manual', 'manual')
on conflict (key) do nothing;

do $$
declare p uuid;
begin
  insert into pipelines(key, name, kind, is_default) values ('ventas', 'Ventas', 'sales', true)
    on conflict (key) do nothing;
  select id into p from pipelines where key = 'ventas';
  insert into pipeline_stages(pipeline_id, key, name, sort_order, outcome) values
    (p, 'nuevo', 'Nuevo', 10, 'open'),
    (p, 'contactado', 'Contactado', 20, 'open'),
    (p, 'calificado', 'Calificado', 30, 'open'),
    (p, 'visita_programada', 'Visita programada', 40, 'open'),
    (p, 'visita_realizada', 'Visita realizada', 50, 'open'),
    (p, 'negociacion', 'Negociación', 60, 'open'),
    (p, 'reserva', 'Reserva', 70, 'open'),
    (p, 'cerrado', 'Cerrado', 80, 'won'),
    (p, 'perdido', 'Perdido', 90, 'lost'),
    (p, 'pausado', 'Pausado', 100, 'paused')
  on conflict do nothing;

  insert into pipelines(key, name, kind, is_default) values ('alquileres', 'Alquileres', 'rentals', true)
    on conflict (key) do nothing;
  select id into p from pipelines where key = 'alquileres';
  insert into pipeline_stages(pipeline_id, key, name, sort_order, outcome) values
    (p, 'nuevo', 'Nuevo', 10, 'open'),
    (p, 'contactado', 'Contactado', 20, 'open'),
    (p, 'calificado', 'Calificado', 30, 'open'),
    (p, 'visita_programada', 'Visita programada', 40, 'open'),
    (p, 'visita_realizada', 'Visita realizada', 50, 'open'),
    (p, 'documentacion', 'Documentación y garantías', 60, 'open'),
    (p, 'reserva', 'Reserva', 70, 'open'),
    (p, 'cerrado', 'Contrato firmado', 80, 'won'),
    (p, 'perdido', 'Perdido', 90, 'lost'),
    (p, 'pausado', 'Pausado', 100, 'paused')
  on conflict do nothing;

  insert into pipelines(key, name, kind, is_default) values ('captacion', 'Captación y tasaciones', 'acquisition', true)
    on conflict (key) do nothing;
  select id into p from pipelines where key = 'captacion';
  insert into pipeline_stages(pipeline_id, key, name, sort_order, outcome) values
    (p, 'nuevo', 'Nuevo', 10, 'open'),
    (p, 'contactado', 'Contactado', 20, 'open'),
    (p, 'tasacion_agendada', 'Tasación agendada', 30, 'open'),
    (p, 'tasacion_realizada', 'Tasación realizada', 40, 'open'),
    (p, 'propuesta', 'Propuesta enviada', 50, 'open'),
    (p, 'autorizacion', 'Autorización firmada', 60, 'won'),
    (p, 'perdido', 'Perdido', 90, 'lost'),
    (p, 'pausado', 'Pausado', 100, 'paused')
  on conflict do nothing;
end $$;

insert into adjustment_indices(key, name, source, granularity) values
  ('ICL', 'Índice para Contratos de Locación', 'BCRA', 'daily'),
  ('CER', 'Coeficiente de Estabilización de Referencia', 'BCRA', 'daily'),
  ('IPC', 'Índice de Precios al Consumidor', 'INDEC', 'monthly'),
  ('CASA_PROPIA', 'Coeficiente Casa Propia', 'Ministerio de Desarrollo Territorial', 'monthly')
on conflict (key) do nothing;

insert into integrations(key, name, category, status) values
  ('whatsapp_cloud', 'WhatsApp Business (Cloud API)', 'messaging', 'awaiting_credentials'),
  ('anthropic', 'Claude (IA)', 'ai', 'awaiting_credentials'),
  ('resend', 'Email transaccional (Resend)', 'email', 'awaiting_credentials'),
  ('s3_storage', 'Object storage (S3 compatible)', 'storage', 'awaiting_credentials'),
  ('meta_social', 'Instagram / Facebook', 'social', 'awaiting_credentials'),
  ('argenprop', 'Argenprop', 'portal', 'awaiting_credentials'),
  ('zonaprop', 'Zonaprop', 'portal', 'awaiting_credentials'),
  ('mercadolibre', 'Mercado Libre Inmuebles', 'portal', 'awaiting_credentials'),
  ('bcra', 'BCRA (índices ICL / CER)', 'data', 'active'),
  ('adinco', 'Adinco (sitio anterior, solo migración)', 'data', 'active'),
  ('sentry', 'Sentry', 'monitoring', 'awaiting_credentials')
on conflict (key) do nothing;

insert into publication_channels(key, name, kind, integration_key, is_enabled) values
  ('web', 'Sitio web', 'web', null, true),
  ('argenprop', 'Argenprop', 'portal', 'argenprop', false),
  ('zonaprop', 'Zonaprop', 'portal', 'zonaprop', false),
  ('mercadolibre', 'Mercado Libre', 'portal', 'mercadolibre', false),
  ('instagram', 'Instagram', 'social', 'meta_social', false),
  ('facebook', 'Facebook', 'social', 'meta_social', false)
on conflict (key) do nothing;

insert into feature_flags(key, enabled, description) values
  ('public_lead_capture', true, 'Formularios públicos crean leads en el CRM'),
  ('whatsapp_ai_bot', false, 'La IA responde WhatsApp entrante (requiere credenciales de WhatsApp y Claude)'),
  ('portal_sync', false, 'Sincroniza propiedades con portales inmobiliarios'),
  ('social_drafts', true, 'Al publicar una propiedad se generan borradores de redes (nunca se publican sin aprobación)'),
  ('social_publishing', false, 'Publica en Instagram/Facebook los posts aprobados y programados'),
  ('owner_portal', true, 'Portal privado de propietarios'),
  ('outbound_email', false, 'Envío real de emails (si no, quedan en cola)'),
  ('outbound_whatsapp', false, 'Envío real de WhatsApp salientes (si no, quedan en cola)'),
  ('rent_index_fetch', true, 'Descarga automática de ICL/CER desde el BCRA'),
  ('media_copy', false, 'Copia la multimedia migrada a storage propio')
on conflict (key) do nothing;

insert into automation_definitions(key, name, description, trigger_event, conditions, actions, is_enabled, is_system) values
  ('lead_notify_and_followup', 'Aviso de lead nuevo + tarea de seguimiento',
   'Notifica al agente asignado (o a administración) y crea una tarea de primer contacto a 2 horas.',
   'lead.created', '[]',
   '[{"type":"notify","to":"assignee_or_role","role":"administrador","title":"Nuevo lead"},{"type":"create_task","title":"Primer contacto con el lead","due_in_minutes":120,"kind":"call"}]',
   true, true),
  ('visit_followup', 'Seguimiento posterior a visita',
   'Al completar una visita crea una tarea de seguimiento para el día siguiente.',
   'visit.completed', '[]',
   '[{"type":"create_task","title":"Seguimiento post-visita","due_in_minutes":1440,"kind":"follow_up"}]',
   true, true),
  ('property_social_drafts', 'Borradores de redes al publicar',
   'Genera borradores de Instagram y Facebook para revisión humana cuando se publica una propiedad.',
   'property.published', '[]',
   '[{"type":"create_social_drafts","channels":["instagram","facebook"]}]',
   true, true),
  ('property_portal_sync', 'Sincronizar portales al cambiar una propiedad',
   'Encola la sincronización con los portales habilitados.',
   'property.updated', '[]',
   '[{"type":"sync_publications"}]',
   true, true),
  ('contract_expiring_notice', 'Aviso de contrato por vencer',
   'Notifica al equipo de alquileres 60 días antes del vencimiento.',
   'contract.expiring', '[]',
   '[{"type":"notify","to":"role","role":"alquileres","title":"Contrato por vencer"},{"type":"create_task","title":"Gestionar renovación o finalización","due_in_minutes":4320,"kind":"task"}]',
   true, true),
  ('rent_due_reminder', 'Recordatorio de vencimiento al inquilino',
   'Encola un recordatorio (email/WhatsApp) al inquilino antes del vencimiento.',
   'rent.due', '[]',
   '[{"type":"queue_message","template":"rent_due_reminder","to":"tenants"}]',
   true, true),
  ('rent_adjustment_proposal', 'Propuesta de ajuste de alquiler',
   'Calcula el ajuste por índice y lo deja PROPUESTO para que una persona lo aplique.',
   'rent_adjustment.due', '[]',
   '[{"type":"propose_rent_adjustment"},{"type":"notify","to":"role","role":"alquileres","title":"Ajuste de alquiler para revisar"}]',
   true, true),
  ('integration_failure_alert', 'Alerta de integración caída',
   'Notifica a administración cuando una integración supera el umbral de fallas.',
   'integration.failed', '[]',
   '[{"type":"notify","to":"role","role":"administrador","title":"Integración con fallas"}]',
   true, true)
on conflict (key) do nothing;

insert into settings(key, value) values
  ('ai.daily_budget_usd', '5'),
  ('leads.first_response_sla_minutes', '120'),
  ('rentals.expiring_notice_days', '60'),
  ('rentals.due_reminder_days', '3'),
  ('integrations.failure_alert_threshold', '3')
on conflict (key) do nothing;
