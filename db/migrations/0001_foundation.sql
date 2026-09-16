-- 0001 — Fundación: organización, sucursales, usuarios, RBAC, sesiones, auditoría, archivos,
-- configuración, feature flags, notificaciones, outbox de eventos, jobs, webhooks e integraciones.
-- Convenciones: uuid como PK de entidades, text + CHECK en lugar de enums (evolucionan sin locks),
-- timestamptz siempre, soft delete (deleted_at) en entidades de negocio.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() no es IMMUTABLE; este wrapper sí, para poder usarlo en índices.
-- El esquema de la extensión varía (public en Postgres local, extensions en Supabase): se resuelve acá.
do $$
declare ext_schema text;
begin
  select n.nspname into ext_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'unaccent';
  execute format(
    'create or replace function f_unaccent(text) returns text language sql immutable parallel safe strict
       as $f$ select %1$I.unaccent(%2$L::regdictionary, $1) $f$',
    ext_schema, ext_schema || '.unaccent');
end $$;

create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────────── Organización ─────────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  legal_name text,
  founded_year smallint check (founded_year between 1800 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_organizations_updated before update on organizations
  for each row execute function set_updated_at();

create table branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null check (length(name) between 2 and 200),
  slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  address_street text,
  address_number text,
  city text,
  province text,
  phone text,
  email text,
  schedule text,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  is_main boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
create unique index branches_one_main on branches(organization_id) where is_main;
create trigger trg_branches_updated before update on branches
  for each row execute function set_updated_at();

-- ───────────────────────────── Usuarios y RBAC ─────────────────────────────
create table roles (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  description text not null
);

create table role_permissions (
  role_key text not null references roles(key) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

-- kind = staff (equipo de la inmobiliaria) | owner (propietario con acceso al portal).
-- Un propietario se vincula a su ficha de contacto (FK agregada en 0002).
create table users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null default 'staff' check (kind in ('staff', 'owner')),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (length(full_name) between 2 and 200),
  phone text,
  whatsapp_e164 text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  public_profile boolean not null default false,
  password_hash text,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  failed_logins integer not null default 0 check (failed_logins >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  contact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index users_email_unique on users(email) where deleted_at is null;
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_key text not null references roles(key),
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

create table user_branches (
  user_id uuid not null references users(id) on delete cascade,
  branch_id uuid not null references branches(id),
  primary key (user_id, branch_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  user_agent text,
  ip inet,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions(user_id) where revoked_at is null;

create table login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip inet,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_email on login_attempts(email, created_at desc);
create index login_attempts_ip on login_attempts(ip, created_at desc);

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── Auditoría (append-only) ─────────────────────────────
create table audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references users(id),
  actor_kind text not null check (actor_kind in ('user', 'owner', 'system', 'integration', 'anonymous')),
  action text not null check (action ~ '^[A-Z_]{3,60}$'),
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  request_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_logs_entity on audit_logs(entity_type, entity_id, occurred_at desc);
create index audit_logs_actor on audit_logs(actor_user_id, occurred_at desc);

create or replace function audit_logs_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'audit_logs es de solo inserción' using errcode = 'P0001';
end $$;
create trigger trg_audit_logs_immutable before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

-- ───────────────────────────── Configuración ─────────────────────────────
create table settings (
  key text primary key check (key ~ '^[a-z0-9_.]{2,80}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

create table feature_flags (
  key text primary key check (key ~ '^[a-z0-9_.]{2,80}$'),
  enabled boolean not null default false,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

-- ───────────────────────────── Archivos (metadatos; bytes en object storage) ─────────────────────────────
create table files (
  id uuid primary key default gen_random_uuid(),
  storage_driver text not null check (storage_driver in ('local', 's3')),
  bucket text not null,
  storage_key text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum_sha256 text check (checksum_sha256 is null or length(checksum_sha256) = 64),
  visibility text not null check (visibility in ('public', 'private')),
  original_name text,
  width integer,
  height integer,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (storage_driver, bucket, storage_key)
);

-- ───────────────────────────── Notificaciones in-app ─────────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text check (link is null or link ~ '^/'),
  entity_type text,
  entity_id text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_unread on notifications(user_id, created_at desc) where read_at is null;

-- ───────────────────────────── Outbox de eventos de dominio ─────────────────────────────
-- Se inserta en la MISMA transacción que el cambio de negocio: si el commit falla, no hay evento;
-- si el commit se hace, el evento existe aunque el proceso muera después.
create table domain_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references users(id),
  dedupe_key text unique,
  occurred_at timestamptz not null default now(),
  dispatched_at timestamptz,
  dispatch_attempts integer not null default 0,
  last_error text
);
create index domain_events_pending on domain_events(id) where dispatched_at is null;
create index domain_events_aggregate on domain_events(aggregate_type, aggregate_id, id desc);

-- ───────────────────────────── Jobs (cola durable con lease) ─────────────────────────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type ~ '^[a-z_]+\.[a-z_]+$'),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled')),
  priority smallint not null default 100,
  run_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 50),
  timeout_ms integer not null default 30000 check (timeout_ms between 1000 and 900000),
  dedupe_key text,
  locked_by text,
  lease_expires_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
-- Un mismo dedupe_key no puede tener dos jobs vivos (queued/running/failed-reintentable).
create unique index jobs_dedupe_active on jobs(dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running', 'failed');
create index jobs_ready on jobs(priority, run_at) where status in ('queued', 'failed');
create index jobs_running_lease on jobs(lease_expires_at) where status = 'running';
create trigger trg_jobs_updated before update on jobs
  for each row execute function set_updated_at();

-- ───────────────────────────── Webhooks entrantes (idempotentes) ─────────────────────────────
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9_]{2,40}$'),
  external_event_id text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

-- ───────────────────────────── Integraciones ─────────────────────────────
create table integrations (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  category text not null check (category in ('messaging', 'portal', 'social', 'email', 'ai', 'storage', 'data', 'monitoring')),
  status text not null default 'awaiting_credentials'
    check (status in ('disabled', 'awaiting_credentials', 'active', 'degraded', 'error')),
  config jsonb not null default '{}'::jsonb, -- nunca secretos: los secretos viven en variables de entorno
  consecutive_failures integer not null default 0,
  circuit_open_until timestamptz,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table integration_logs (
  id bigint generated always as identity primary key,
  integration_key text not null references integrations(key),
  operation text not null,
  entity_type text,
  entity_id text,
  request_id text,
  status text not null check (status in ('ok', 'error', 'skipped', 'retry')),
  http_status integer,
  duration_ms integer,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index integration_logs_key on integration_logs(integration_key, created_at desc);

-- Referencias externas genéricas: clave de idempotencia de importaciones y sincronizaciones.
create table external_refs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source ~ '^[a-z0-9_]{2,40}$'),
  external_type text not null,
  external_id text not null,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source, external_type, external_id)
);
create index external_refs_entity on external_refs(entity_type, entity_id);
