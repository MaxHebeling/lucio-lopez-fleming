-- 0005 — Alquileres: contratos, partes, índices de ajuste, ajustes históricos inmutables,
-- obligaciones (cuotas), pagos anulables (nunca borrados), liquidaciones a propietarios y mensajes salientes.

create table adjustment_indices (
  key text primary key check (key ~ '^[A-Z_]{2,30}$'),
  name text not null,
  source text not null,
  -- daily: el valor se publica por día (ICL) · monthly: por mes (IPC)
  granularity text not null check (granularity in ('daily', 'monthly', 'none'))
);

create table index_values (
  index_key text not null references adjustment_indices(key),
  period_date date not null,
  value numeric(20, 8) not null check (value > 0),
  source text not null check (source in ('bcra_api', 'manual', 'import')),
  entered_by uuid references users(id),
  fetched_at timestamptz not null default now(),
  primary key (index_key, period_date)
);

create table rental_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code text not null unique check (code ~ '^[A-Z0-9-]{3,40}$'),
  property_id uuid not null references properties(id),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'ended', 'terminated', 'renewed')),
  start_date date not null,
  end_date date not null,
  currency text not null check (currency in ('USD', 'ARS')),
  initial_rent numeric(14, 2) not null check (initial_rent > 0),
  current_rent numeric(14, 2) not null check (current_rent > 0),
  payment_due_day smallint not null default 10 check (payment_due_day between 1 and 28),
  deposit_amount numeric(14, 2) check (deposit_amount >= 0),
  deposit_currency text check (deposit_currency in ('USD', 'ARS')),
  commission_amount numeric(14, 2) check (commission_amount >= 0),
  -- Honorario de administración que se descuenta al propietario en cada liquidación
  management_fee_pct numeric(5, 2) not null default 0 check (management_fee_pct between 0 and 100),
  adjustment_index_key text references adjustment_indices(key),
  adjustment_period_months smallint check (adjustment_period_months between 1 and 36),
  next_adjustment_date date,
  late_fee_daily_pct numeric(6, 4) check (late_fee_daily_pct between 0 and 5),
  renewal_of_contract_id uuid references rental_contracts(id),
  notes text,
  terminated_at timestamptz,
  termination_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date),
  check ((adjustment_index_key is null) = (adjustment_period_months is null))
);
create index rental_contracts_property on rental_contracts(property_id);
create index rental_contracts_active_end on rental_contracts(end_date) where status = 'active';
create index rental_contracts_next_adjustment on rental_contracts(next_adjustment_date) where status = 'active';
-- Una propiedad no puede tener dos contratos activos superpuestos
alter table rental_contracts add constraint rental_contracts_no_overlap exclude using gist (
  property_id with =,
  daterange(start_date, end_date, '[)') with &&
) where (status = 'active');
create trigger trg_rental_contracts_updated before update on rental_contracts
  for each row execute function set_updated_at();

create table rental_contract_parties (
  contract_id uuid not null references rental_contracts(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  role text not null check (role in ('owner', 'tenant', 'guarantor')),
  share_pct numeric(5, 2) check (share_pct > 0 and share_pct <= 100),
  primary key (contract_id, contact_id, role)
);
create index rental_contract_parties_contact on rental_contract_parties(contact_id, role);

create table rent_adjustments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references rental_contracts(id),
  effective_date date not null,
  previous_amount numeric(14, 2) not null check (previous_amount > 0),
  new_amount numeric(14, 2) not null check (new_amount > 0),
  index_key text references adjustment_indices(key),
  index_start_date date,
  index_start_value numeric(20, 8),
  index_end_date date,
  index_end_value numeric(20, 8),
  factor numeric(14, 8) not null check (factor > 0),
  method text not null check (method in ('index', 'manual')),
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'rejected')),
  calculated_at timestamptz not null default now(),
  calculated_by uuid references users(id),
  applied_at timestamptz,
  applied_by uuid references users(id),
  note text,
  unique (contract_id, effective_date)
);

-- Un ajuste aplicado es historia: no se modifica ni se borra.
create or replace function rent_adjustments_guard() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'applied' then
      raise exception 'Un ajuste aplicado no puede borrarse' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status in ('applied', 'rejected') then
    raise exception 'Un ajuste % no puede modificarse', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_rent_adjustments_guard before update or delete on rent_adjustments
  for each row execute function rent_adjustments_guard();

create table rent_obligations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references rental_contracts(id),
  period_start date not null check (extract(day from period_start) = 1),
  concept text not null default 'rent' check (concept in ('rent', 'expenses', 'tax', 'other')),
  due_date date not null,
  currency text not null check (currency in ('USD', 'ARS')),
  amount numeric(14, 2) not null check (amount >= 0),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'partially_paid', 'paid', 'overdue', 'waived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, period_start, concept)
);
create index rent_obligations_due on rent_obligations(due_date) where status in ('pending', 'partially_paid', 'overdue');
create trigger trg_rent_obligations_updated before update on rent_obligations
  for each row execute function set_updated_at();

create table rent_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references rental_contracts(id),
  obligation_id uuid not null references rent_obligations(id),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency in ('USD', 'ARS')),
  paid_on date not null,
  method text not null check (method in ('cash', 'transfer', 'check', 'deposit', 'other')),
  reference text,
  idempotency_key text not null unique,
  received_by uuid references users(id),
  voided_at timestamptz,
  voided_by uuid references users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  check ((voided_at is null) = (void_reason is null))
);
create index rent_payments_obligation on rent_payments(obligation_id) where voided_at is null;

create or replace function rent_payments_no_delete() returns trigger
  language plpgsql as $$
begin
  raise exception 'Los pagos no se borran: se anulan (voided_at)' using errcode = 'P0001';
end $$;
create trigger trg_rent_payments_no_delete before delete on rent_payments
  for each row execute function rent_payments_no_delete();

create table owner_settlements (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references rental_contracts(id),
  owner_contact_id uuid not null references contacts(id),
  period_start date not null check (extract(day from period_start) = 1),
  currency text not null check (currency in ('USD', 'ARS')),
  gross_collected numeric(14, 2) not null check (gross_collected >= 0),
  management_fee_amount numeric(14, 2) not null check (management_fee_amount >= 0),
  other_deductions numeric(14, 2) not null default 0 check (other_deductions >= 0),
  net_amount numeric(14, 2) not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'cancelled')),
  generated_by uuid references users(id),
  generated_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  cancelled_reason text,
  check (net_amount = gross_collected - management_fee_amount - other_deductions)
);
create unique index owner_settlements_unique_active on owner_settlements(contract_id, owner_contact_id, period_start)
  where status <> 'cancelled';
create index owner_settlements_owner on owner_settlements(owner_contact_id, period_start desc);

create table settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references owner_settlements(id) on delete cascade,
  kind text not null check (kind in ('payment', 'management_fee', 'deduction')),
  description text not null,
  amount numeric(14, 2) not null,
  payment_id uuid references rent_payments(id)
);

-- Mensajes salientes (email / WhatsApp) con idempotencia: un aviso no se manda dos veces.
create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'whatsapp')),
  to_address text not null,
  template_key text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled', 'awaiting_credentials')),
  dedupe_key text not null unique,
  entity_type text,
  entity_id uuid,
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index outbound_messages_pending on outbound_messages(status, created_at) where status in ('queued', 'failed');
create trigger trg_outbound_messages_updated before update on outbound_messages
  for each row execute function set_updated_at();
