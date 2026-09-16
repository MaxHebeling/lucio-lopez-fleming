-- 0006 — Informes a propietarios, motor de contenido (con aprobación humana), automatizaciones
-- y registro de interacciones con IA (costos, latencia, versión de prompt).

create table owner_reports (
  id uuid primary key default gen_random_uuid(),
  owner_contact_id uuid not null references contacts(id),
  property_id uuid references properties(id),
  period_start date not null,
  period_end date not null,
  status text not null default 'generated' check (status in ('generated', 'queued', 'sent', 'delivered', 'failed')),
  data jsonb not null,
  file_id uuid references files(id),
  generated_by uuid references users(id),
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  check (period_end >= period_start)
);
create unique index owner_reports_unique on owner_reports(
  owner_contact_id, coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end);

create table content_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,60}$'),
  channel text not null check (channel in ('instagram', 'facebook', 'whatsapp', 'email')),
  name text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_content_templates_updated before update on content_templates
  for each row execute function set_updated_at();

create table social_posts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id),
  campaign_id uuid references campaigns(id),
  channel text not null check (channel in ('instagram', 'facebook')),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'rejected')),
  caption text not null,
  template_key text,
  generated_by text not null check (generated_by in ('template', 'ai', 'human')),
  prompt_version text,
  source_event_id bigint references domain_events(id),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  approved_by uuid references users(id),
  approved_at timestamptz,
  rejected_reason text,
  last_error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- No se puede programar ni publicar sin aprobación humana
  check (status not in ('approved', 'scheduled', 'publishing', 'published') or approved_by is not null)
);
create unique index social_posts_one_per_event on social_posts(source_event_id, channel) where source_event_id is not null;
create index social_posts_queue on social_posts(status, scheduled_at);
create trigger trg_social_posts_updated before update on social_posts
  for each row execute function set_updated_at();

create table social_assets (
  id uuid primary key default gen_random_uuid(),
  social_post_id uuid not null references social_posts(id) on delete cascade,
  property_media_id uuid references property_media(id),
  file_id uuid references files(id),
  sort_order integer not null default 0,
  check (property_media_id is not null or file_id is not null)
);

create table automation_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,80}$'),
  name text not null,
  description text,
  trigger_event text not null check (trigger_event ~ '^[a-z_]+\.[a-z_]+$'),
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) > 0),
  is_enabled boolean not null default false,
  is_system boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_definitions_trigger on automation_definitions(trigger_event) where is_enabled;
create trigger trg_automation_definitions_updated before update on automation_definitions
  for each row execute function set_updated_at();

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automation_definitions(id),
  automation_version integer not null,
  trigger_event_id bigint not null references domain_events(id),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  attempt integer not null default 1,
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (automation_id, trigger_event_id)
);
create index automation_runs_failed on automation_runs(started_at desc) where status = 'failed';

create view automation_errors as
  select r.id, d.key as automation_key, r.trigger_event_id, r.attempt, r.error, r.started_at, r.finished_at
    from automation_runs r join automation_definitions d on d.id = r.automation_id
   where r.status = 'failed';

create table ai_interactions (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('whatsapp_reply', 'content_copy', 'lead_summary')),
  conversation_id uuid references conversations(id),
  prompt_version text not null,
  model text not null,
  status text not null check (status in ('ok', 'error', 'timeout', 'invalid_output', 'budget_exceeded', 'fallback')),
  input_tokens integer,
  output_tokens integer,
  cost_usd_micros bigint,
  latency_ms integer,
  tool_calls jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index ai_interactions_day on ai_interactions(created_at);
