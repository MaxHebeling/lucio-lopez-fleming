-- 0420 — Analítica first-party mínima del sitio público (hoy: tours virtuales).
-- Sin IP, sin user agent, sin cookies ni datos personales: `session_key` es un valor aleatorio por pestaña que genera el
-- navegador y no se vincula con nada más. Retención: 13 meses (tarea site.events_purge).
-- Tabla append-only de alto volumen: PK bigint y sin FK (una propiedad borrada no bloquea ni borra su historial).
create table site_events (
  id bigint generated always as identity primary key,
  name text not null check (name in (
    'virtual_tour_opened', 'virtual_tour_scene_viewed', 'virtual_tour_hotspot_clicked', 'virtual_tour_floorplan_opened',
    'virtual_tour_guided_started', 'virtual_tour_cta_clicked', 'virtual_tour_closed')),
  session_key text not null check (session_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  property_id uuid,
  tour_id uuid,
  scene_id uuid,
  scene_slug text check (scene_slug ~ '^[a-z0-9-]{1,60}$'),
  hotspot_id uuid,
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 1024),
  occurred_at timestamptz not null default now()
);
create index site_events_tour_name on site_events(tour_id, name, occurred_at);
create index site_events_tour_scene on site_events(tour_id, scene_slug) where name = 'virtual_tour_scene_viewed';
create index site_events_session on site_events(session_key, tour_id);
create index site_events_occurred on site_events(occurred_at);
