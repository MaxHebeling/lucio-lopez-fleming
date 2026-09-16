-- 0007 — Migración desde el sitio actual (Adinco): corridas, estado por registro (pipeline
-- DISCOVERED → … → PUBLISHED) y advertencias para revisión humana. Nada se "corrige" en silencio.

create table migration_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source ~ '^[a-z0-9_]{2,40}$'),
  status text not null default 'running' check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  options jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  triggered_by text not null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table migration_records (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  last_run_id uuid not null references migration_runs(id),
  stage text not null check (stage in ('discovered', 'extracted', 'normalized', 'validated', 'imported',
    'media_verified', 'review_required', 'verified', 'published', 'failed', 'skipped_protected')),
  raw_hash text,
  raw jsonb,
  normalized jsonb,
  property_id uuid references properties(id),
  error text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index migration_records_stage on migration_records(source, stage);
create trigger trg_migration_records_updated before update on migration_records
  for each row execute function set_updated_at();

create table migration_warnings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references migration_runs(id),
  source text not null,
  external_id text not null,
  property_id uuid references properties(id),
  code text not null check (code ~ '^[a-z_]{3,60}$'),
  field text not null,
  value_a text,
  value_b text,
  message text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- La misma advertencia no se duplica en cada corrida
  unique (source, external_id, code, field)
);
create index migration_warnings_open on migration_warnings(severity, created_at desc) where status = 'open';
