-- 0180 — Núcleo operativo de visitas (docs/operations/VISITS.md, docs/operations/PRIVACY_LOCATION.md).
-- Aditivo y compatible con la Agenda existente:
--  · `appointments.status` conserva scheduled/confirmed/completed/cancelled/no_show y suma en_route, checked_in e
--    in_progress. "Reprogramada" NO es un estado: la reprogramación ya modifica la misma cita (vuelve a "scheduled") y
--    queda como evento del timeline; así no se rompen los vínculos (oportunidad, tarea de seguimiento, link del cliente).
--  · La base valida las transiciones (trigger) además de la función pura del servidor (src/server/visits/state.ts).
--  · Las coordenadas crudas SOLO existen en appointment_checkins (con retención acotada). El timeline las rechaza.

-- ───────────────────────────── Estados y marcas de tiempo ─────────────────────────────
alter table appointments drop constraint appointments_status_check;
alter table appointments add constraint appointments_status_check
  check (status in ('scheduled', 'confirmed', 'en_route', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'));

-- Una visita en camino, con check-in o en curso sigue ocupando la franja del agente.
alter table appointments drop constraint appointments_no_overlap;
alter table appointments add constraint appointments_no_overlap exclude using gist (
  assigned_user_id with =,
  tstzrange(starts_at, ends_at, '[)') with &&
) where (status in ('scheduled', 'confirmed', 'en_route', 'checked_in', 'in_progress'));

alter table appointments
  add column en_route_at timestamptz,
  add column checked_in_at timestamptz,
  add column started_at timestamptz,
  add column finished_at timestamptz;

create index appointments_visits_by_start on appointments(starts_at) where kind = 'visit';

create function appointments_status_transition() returns trigger
  language plpgsql
  set search_path = pg_catalog
  as $$
begin
  if new.status is distinct from old.status and not ((old.status, new.status) in (
    ('scheduled', 'confirmed'), ('scheduled', 'en_route'), ('scheduled', 'checked_in'), ('scheduled', 'completed'),
    ('scheduled', 'cancelled'), ('scheduled', 'no_show'),
    ('confirmed', 'scheduled'), ('confirmed', 'en_route'), ('confirmed', 'checked_in'), ('confirmed', 'completed'),
    ('confirmed', 'cancelled'), ('confirmed', 'no_show'),
    ('en_route', 'scheduled'), ('en_route', 'checked_in'), ('en_route', 'completed'), ('en_route', 'cancelled'),
    ('en_route', 'no_show'),
    ('checked_in', 'in_progress'), ('checked_in', 'completed'), ('checked_in', 'cancelled'), ('checked_in', 'no_show'),
    ('in_progress', 'completed'), ('in_progress', 'cancelled')
  )) then
    raise exception 'Transición de estado inválida: % → %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_appointments_status_transition before update of status on appointments
  for each row execute function appointments_status_transition();

-- ───────────────────────────── Timeline (append-only) ─────────────────────────────
create table appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references appointments(id),
  kind text not null check (kind in (
    'scheduled', 'assigned', 'reassigned', 'rescheduled', 'confirmed', 'en_route', 'checked_in', 'checkin_retry',
    'location_problem', 'started', 'finished', 'cancelled', 'no_show',
    'client_link_created', 'client_link_rotated', 'client_link_revoked', 'client_link_opened', 'client_link_expired',
    'report_saved', 'report_confirmed', 'followup_created', 'thanks_saved', 'thanks_marked_sent'
  )),
  actor_user_id uuid references users(id),
  actor_kind text not null check (actor_kind in ('user', 'system', 'client')),
  -- Datos chicos y sin ubicación: nunca coordenadas en el timeline.
  data jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2000
    and not (data ?| array['lat', 'lng', 'latitude', 'longitude', 'coords', 'position'])
  ),
  dedupe_key text unique,
  occurred_at timestamptz not null default now()
);
create index appointment_events_timeline on appointment_events(appointment_id, occurred_at, id);

create function appointment_events_immutable() returns trigger
  language plpgsql
  set search_path = pg_catalog
  as $$
begin
  raise exception 'appointment_events es de solo inserción' using errcode = 'P0001';
end $$;
create trigger trg_appointment_events_immutable before update or delete on appointment_events
  for each row execute function appointment_events_immutable();

-- ───────────────────────────── Check-in geolocalizado ─────────────────────────────
-- Una fila por intento (máx. 3 por visita). Coordenadas crudas con retención acotada (visits.location_retention):
-- al vencer se anulan latitude/longitude/accuracy_m y queda solo estado, motivo y distancia.
create table appointment_checkins (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id),
  user_id uuid not null references users(id),
  attempt smallint not null check (attempt between 1 and 3),
  server_at timestamptz not null default now(),
  device_at timestamptz,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  accuracy_m numeric(9, 1) check (accuracy_m >= 0 and accuracy_m <= 1000000),
  distance_m integer check (distance_m >= 0),
  radius_m integer not null check (radius_m between 10 and 5000),
  max_accuracy_m integer not null check (max_accuracy_m between 10 and 5000),
  verification_status text not null check (verification_status in ('verified', 'needs_review', 'no_location')),
  reason text not null check (reason in (
    'within_radius', 'outside_radius', 'low_accuracy', 'property_without_coordinates',
    'permission_denied', 'position_unavailable', 'timeout', 'unsupported', 'other'
  )),
  reason_detail text check (length(reason_detail) <= 500),
  coords_purged_at timestamptz,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  unique (appointment_id, attempt),
  check ((latitude is null) = (longitude is null)),
  check (verification_status <> 'verified' or (reason = 'within_radius' and distance_m is not null)),
  check (verification_status <> 'no_location' or (latitude is null and accuracy_m is null and distance_m is null)),
  check (coords_purged_at is null or (latitude is null and accuracy_m is null))
);
create index appointment_checkins_by_appointment on appointment_checkins(appointment_id, attempt desc);
create index appointment_checkins_retention on appointment_checkins(server_at) where latitude is not null or accuracy_m is not null;

-- ───────────────────────────── Link temporal del cliente ─────────────────────────────
-- En la base solo el hash SHA-256 del token (el token viaja una vez al agente). Un link activo por visita.
create table appointment_public_links (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  revoke_reason text check (revoke_reason in ('rotated', 'manual')),
  last_opened_at timestamptz,
  open_count integer not null default 0 check (open_count >= 0),
  expired_recorded_at timestamptz,
  check (expires_at > created_at),
  check ((revoked_at is null) = (revoke_reason is null))
);
create unique index appointment_public_links_one_active on appointment_public_links(appointment_id) where revoked_at is null;
create index appointment_public_links_expiry on appointment_public_links(expires_at) where revoked_at is null and expired_recorded_at is null;

-- ───────────────────────────── Informe post-visita ─────────────────────────────
create table appointment_reports (
  appointment_id uuid primary key references appointments(id),
  author_user_id uuid not null references users(id),
  body text not null check (length(body) between 3 and 10000),
  interest text check (interest in ('low', 'medium', 'high')),
  positives text check (length(positives) <= 2000),
  objections text check (length(objections) <= 2000),
  next_step text check (length(next_step) <= 500),
  follow_up_at timestamptz,
  dictated boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'confirmed') = (confirmed_at is not null and confirmed_by is not null))
);
create trigger trg_appointment_reports_updated before update on appointment_reports
  for each row execute function set_updated_at();

-- ───────────────────────────── Agradecimiento ─────────────────────────────
-- Texto por plantilla, editable. Nada se envía solo: "marcado como enviado" lo registra una persona.
create table appointment_thanks (
  appointment_id uuid primary key references appointments(id),
  message text not null check (length(message) between 10 and 1000),
  updated_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  marked_sent_at timestamptz,
  marked_sent_by uuid references users(id),
  sent_channel text check (sent_channel in ('whatsapp', 'copy', 'other')),
  check ((marked_sent_at is null) = (sent_channel is null))
);
create trigger trg_appointment_thanks_updated before update on appointment_thanks
  for each row execute function set_updated_at();

-- ───────────────────────────── Alertas del centro operativo ─────────────────────────────
-- Una fila por (visita, tipo): se detecta, se resuelve sola si la condición desaparece y se notifica una sola vez.
create table visit_alerts (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id),
  kind text not null check (kind in ('unassigned_upcoming', 'no_checkin', 'checkin_needs_review', 'overrun', 'not_finished', 'no_report', 'no_followup')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 1000),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz,
  unique (appointment_id, kind)
);
create index visit_alerts_open on visit_alerts(detected_at desc) where resolved_at is null;
