-- 0510 — IA Fase 2 · Ventas: perfil del comprador (preferencias con origen, confianza y estado), coincidencias
-- cliente ↔ propiedad, siguiente acción recomendada (decisiones humanas), vínculo sesión del sitio ↔ contacto y
-- nuevos eventos de analítica sin PII. Bloque 0510–0519 (ver docs/CONVENTIONS.md). Aditiva.

-- ───────────── Perfil del comprador: una fila por dato, con historial ─────────────
-- Lista CERRADA de campos inmobiliarios (nada de atributos sensibles). Cada dato tiene origen, confianza y estado:
--   suggested  → propuesto (formulario, concierge del sitio, conversación, consulta libre); lo confirma una persona
--   confirmed  → validado por el equipo (o cargado por el equipo)
--   rejected   → descartado por el equipo
--   superseded → reemplazado por un valor más nuevo (historial)
create table client_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  contact_id uuid not null references contacts(id),
  field text not null check (field in (
    'transaction_type', 'goal', 'property_types', 'budget', 'locations', 'bedrooms_min', 'bathrooms_min',
    'surface', 'features', 'move_timeframe', 'financing', 'notes')),
  value jsonb not null check (pg_column_size(value) <= 4096),
  source text not null check (source in ('form', 'concierge', 'conversation', 'agent', 'lead_message')),
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  status text not null check (status in ('suggested', 'confirmed', 'rejected', 'superseded')),
  lead_id uuid references leads(id),
  created_by uuid references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (status not in ('confirmed', 'rejected') or decided_at is not null),
  check (field <> 'notes' or (jsonb_typeof(value) = 'string' and length(value #>> '{}') <= 1000))
);
-- Un valor vigente confirmado y a lo sumo una sugerencia pendiente por campo.
create unique index client_preferences_confirmed on client_preferences(contact_id, field) where status = 'confirmed';
create unique index client_preferences_suggested on client_preferences(contact_id, field) where status = 'suggested';
create index client_preferences_contact on client_preferences(contact_id, created_at desc);
create index client_preferences_active on client_preferences(organization_id, field) where status in ('suggested', 'confirmed');

-- ───────────── Coincidencias cliente ↔ propiedad (match inverso) ─────────────
-- Las calcula un job idempotente al publicarse una propiedad o cambiar su precio, y el servicio al cambiar
-- preferencias. NUNCA disparan contacto automático: se muestran al agente, que decide.
create table property_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  contact_id uuid not null references contacts(id),
  property_id uuid not null references properties(id),
  score smallint not null check (score between 0 and 100),
  -- { matched: [...], consider: [...], unconfirmed: bool } sin datos personales
  reasons jsonb not null default '{}'::jsonb check (jsonb_typeof(reasons) = 'object' and pg_column_size(reasons) <= 4096),
  algorithm_version text not null check (algorithm_version ~ '^[a-z0-9.-]{3,40}$'),
  trigger text not null check (trigger in ('property_published', 'price_changed', 'preferences_changed', 'manual')),
  status text not null default 'candidate' check (status in ('candidate', 'dismissed', 'stale')),
  dismiss_reason text check (dismiss_reason in ('price', 'location', 'size', 'type', 'features', 'other')),
  dismissed_by uuid references users(id),
  dismissed_at timestamptz,
  notified_user_id uuid references users(id),
  notified_at timestamptz,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (contact_id, property_id),
  check (status <> 'dismissed' or (dismiss_reason is not null and dismissed_at is not null))
);
create index property_matches_property on property_matches(property_id, status, score desc);
create index property_matches_contact on property_matches(contact_id, status, score desc);

-- ───────────── Siguiente acción recomendada: decisiones humanas ─────────────
-- Las recomendaciones se calculan con reglas deterministas (src/server/sales/nba). Acá quedan las propuestas del
-- sistema (open, creadas por jobs) y las DECISIONES: aceptar (crea una tarea real), descartar o posponer.
-- `fingerprint` = hash de la evidencia: si la situación cambia, la recomendación puede volver a proponerse.
create table sales_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  contact_id uuid not null references contacts(id),
  entity_type text not null check (entity_type in ('contact', 'lead', 'opportunity')),
  entity_id uuid not null,
  rule_key text not null check (rule_key ~ '^[a-z_]{3,40}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  priority text not null check (priority in ('high', 'medium', 'low')),
  title text not null check (length(title) between 2 and 200),
  reason text not null check (length(reason) between 2 and 500),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) <= 4096),
  status text not null check (status in ('open', 'accepted', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  dismiss_note text check (length(dismiss_note) <= 300),
  task_id uuid references tasks(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, rule_key, fingerprint),
  check (status <> 'snoozed' or snoozed_until is not null),
  check (status <> 'accepted' or task_id is not null),
  check (status = 'open' or decided_at is not null)
);
create index sales_recommendations_contact on sales_recommendations(contact_id, status);
create trigger trg_sales_recommendations_updated before update on sales_recommendations
  for each row execute function set_updated_at();

-- ───────────── Vínculo sesión del sitio ↔ contacto ─────────────
-- SOLO se crea cuando la persona envía una consulta desde el sitio (y el navegador no pide Do Not Track / GPC).
-- Permite explicar señales de interés (volvió a la propiedad, hizo el tour…) con los eventos de esa pestaña.
-- Retención alineada con site_events (13 meses, tarea site.events_purge).
create table site_session_links (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  session_key text not null check (session_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  contact_id uuid not null references contacts(id),
  lead_id uuid references leads(id),
  linked_at timestamptz not null default now(),
  unique (session_key, contact_id)
);
create index site_session_links_contact on site_session_links(contact_id);
create index site_session_links_linked on site_session_links(linked_at);

-- ───────────── site_events: allowlist ampliada (eventos de propiedad y de decisión, sin PII ni texto libre) ─────────────
alter table site_events drop constraint site_events_name_check;
alter table site_events add constraint site_events_name_check check (name in (
  'virtual_tour_opened', 'virtual_tour_scene_viewed', 'virtual_tour_hotspot_clicked', 'virtual_tour_floorplan_opened',
  'virtual_tour_guided_started', 'virtual_tour_cta_clicked', 'virtual_tour_closed',
  'property_viewed', 'property_gallery_opened', 'property_qa_asked', 'property_compared', 'concierge_searched',
  'lead_form_opened'));
create index site_events_property_name on site_events(property_id, name, occurred_at) where property_id is not null;

-- ───────────── ai_interactions: funciones de la Fase 2 ─────────────
alter table ai_interactions drop constraint ai_interactions_purpose_check;
alter table ai_interactions add constraint ai_interactions_purpose_check
  check (purpose in ('whatsapp_reply', 'content_copy', 'lead_summary', 'copilot_assistant', 'copilot_analyst',
    'concierge', 'property_qa', 'compare_summary', 'lead_qualification'));
