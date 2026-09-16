-- 0004 — CRM comercial: fuentes, leads, pipelines configurables, oportunidades con historial,
-- tareas, agenda/visitas y conversaciones multicanal.

create table lead_sources (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  channel text not null check (channel in ('web', 'whatsapp', 'instagram', 'facebook', 'email', 'portal', 'manual', 'campaign', 'phone', 'walk_in')),
  is_active boolean not null default true
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  channel text not null,
  utm_campaign text unique,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'finished')),
  starts_at timestamptz,
  ends_at timestamptz,
  budget_amount numeric(14, 2) check (budget_amount >= 0),
  budget_currency text check (budget_currency in ('USD', 'ARS')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();

create table conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'instagram', 'facebook', 'email', 'web')),
  external_thread_id text not null,
  contact_id uuid references contacts(id),
  -- bot: la IA atiende · human: derivada a una persona · closed
  mode text not null default 'bot' check (mode in ('bot', 'human', 'closed')),
  assigned_user_id uuid references users(id),
  handoff_at timestamptz,
  handoff_reason text,
  summary text,
  collected jsonb not null default '{}'::jsonb,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_thread_id)
);
create index conversations_human_queue on conversations(assigned_user_id, last_message_at desc) where mode = 'human';
create trigger trg_conversations_updated before update on conversations
  for each row execute function set_updated_at();

create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_kind text not null check (sender_kind in ('contact', 'bot', 'user', 'system')),
  sender_user_id uuid references users(id),
  body text,
  payload jsonb not null default '{}'::jsonb,
  external_message_id text,
  status text not null default 'received'
    check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create unique index conversation_messages_external on conversation_messages(conversation_id, external_message_id)
  where external_message_id is not null;
create index conversation_messages_conv on conversation_messages(conversation_id, created_at);

create table leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  contact_id uuid not null references contacts(id),
  source_key text not null references lead_sources(key),
  property_id uuid references properties(id),
  campaign_id uuid references campaigns(id),
  conversation_id uuid references conversations(id),
  branch_id uuid references branches(id),
  operation_interest text check (operation_interest in ('sale', 'rent', 'temporary_rent', 'appraisal', 'sell_my_property', 'other')),
  message text,
  utm jsonb not null default '{}'::jsonb,
  external_id text,
  -- Evita duplicar el mismo envío (doble click, reintento de webhook, reimportación)
  idempotency_key text unique,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'discarded')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_user_id uuid references users(id),
  assigned_at timestamptz,
  first_response_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index leads_inbox on leads(status, created_at desc) where deleted_at is null;
create index leads_assigned on leads(assigned_user_id, status) where deleted_at is null;
create index leads_contact on leads(contact_id);
create index leads_property on leads(property_id);
create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();

create table pipelines (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  kind text not null check (kind in ('sales', 'rentals', 'acquisition')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index pipelines_one_default_per_kind on pipelines(kind) where is_default;

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  sort_order smallint not null,
  outcome text not null default 'open' check (outcome in ('open', 'won', 'lost', 'paused')),
  is_active boolean not null default true,
  unique (pipeline_id, key),
  unique (pipeline_id, sort_order)
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_id uuid references leads(id),
  contact_id uuid not null references contacts(id),
  property_id uuid references properties(id),
  pipeline_id uuid not null references pipelines(id),
  stage_id uuid not null references pipeline_stages(id),
  operation text check (operation in ('sale', 'rent', 'temporary_rent')),
  title text not null,
  budget_min numeric(14, 2) check (budget_min >= 0),
  budget_max numeric(14, 2) check (budget_max >= 0),
  budget_currency text check (budget_currency in ('USD', 'ARS')),
  requirements jsonb not null default '{}'::jsonb,
  value_amount numeric(14, 2) check (value_amount >= 0),
  value_currency text check (value_currency in ('USD', 'ARS')),
  assigned_user_id uuid references users(id),
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'paused')),
  lost_reason text,
  expected_close_date date,
  stage_entered_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index opportunities_board on opportunities(pipeline_id, stage_id) where deleted_at is null;
create index opportunities_assigned on opportunities(assigned_user_id, status) where deleted_at is null;
create trigger trg_opportunities_updated before update on opportunities
  for each row execute function set_updated_at();

create table opportunity_stage_history (
  id bigint generated always as identity primary key,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  from_stage_id uuid references pipeline_stages(id),
  to_stage_id uuid not null references pipeline_stages(id),
  changed_by uuid references users(id),
  note text,
  changed_at timestamptz not null default now()
);
create index opportunity_stage_history_opp on opportunity_stage_history(opportunity_id, changed_at desc);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 2 and 200),
  description text,
  kind text not null default 'task' check (kind in ('task', 'call', 'meeting', 'follow_up', 'email', 'whatsapp')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  assigned_user_id uuid references users(id),
  entity_type text check (entity_type in ('contact', 'property', 'lead', 'opportunity', 'rental_contract', 'appointment')),
  entity_id uuid,
  dedupe_key text unique,
  created_by uuid references users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((entity_type is null) = (entity_id is null))
);
create index tasks_open_by_user on tasks(assigned_user_id, due_at) where status = 'open';
create trigger trg_tasks_updated before update on tasks
  for each row execute function set_updated_at();

-- Agenda: visitas, llamadas, reuniones y seguimientos.
create extension if not exists btree_gist;

create table appointments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('visit', 'call', 'meeting', 'follow_up')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  property_id uuid references properties(id),
  contact_id uuid references contacts(id),
  opportunity_id uuid references opportunities(id),
  lead_id uuid references leads(id),
  assigned_user_id uuid not null references users(id),
  location text,
  notes text,
  result text,
  cancel_reason text,
  follow_up_task_id uuid references tasks(id),
  idempotency_key text unique,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (kind <> 'visit' or property_id is not null),
  -- Un agente no puede tener dos citas activas superpuestas
  constraint appointments_no_overlap exclude using gist (
    assigned_user_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('scheduled', 'confirmed'))
);
create index appointments_calendar on appointments(assigned_user_id, starts_at);
create index appointments_property on appointments(property_id, starts_at desc);
create trigger trg_appointments_updated before update on appointments
  for each row execute function set_updated_at();
