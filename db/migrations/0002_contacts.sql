-- 0002 — Contactos únicos (personas/empresas) con emails y teléfonos normalizados para deduplicar.
-- Un contacto puede tener varios roles: propietario, comprador, interesado, inquilino, garante, proveedor.

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null default 'person' check (kind in ('person', 'company')),
  first_name text,
  last_name text,
  company_name text,
  display_name text not null check (length(display_name) between 1 and 200),
  document_type text check (document_type in ('dni', 'cuit', 'cuil', 'passport', 'other')),
  document_number text,
  source text not null default 'manual',
  assigned_user_id uuid references users(id),
  merged_into_id uuid references contacts(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (merged_into_id is null or merged_into_id <> id)
);
create index contacts_display_trgm on contacts using gin (f_unaccent(lower(display_name)) gin_trgm_ops);
create index contacts_assigned on contacts(assigned_user_id) where deleted_at is null;
create unique index contacts_document_unique on contacts(organization_id, document_type, document_number)
  where document_number is not null and deleted_at is null and merged_into_id is null;
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

alter table users add constraint users_contact_fk foreign key (contact_id) references contacts(id);
create unique index users_owner_contact on users(contact_id) where contact_id is not null and deleted_at is null;
alter table users add constraint users_owner_needs_contact check (kind <> 'owner' or contact_id is not null);

create table contact_emails (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  email text not null,
  email_normalized text not null check (email_normalized = lower(email_normalized)),
  label text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contact_id, email_normalized)
);
create index contact_emails_normalized on contact_emails(email_normalized);
create unique index contact_emails_one_primary on contact_emails(contact_id) where is_primary;

create table contact_phones (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  phone_raw text not null,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label text,
  is_whatsapp boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index contact_phones_unique on contact_phones(contact_id, coalesce(phone_e164, phone_raw));
create index contact_phones_e164 on contact_phones(phone_e164) where phone_e164 is not null;
create unique index contact_phones_one_primary on contact_phones(contact_id) where is_primary;

create table contact_addresses (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  label text,
  street text,
  number text,
  city text,
  province text,
  country text default 'Argentina',
  postal_code text,
  created_at timestamptz not null default now()
);

create table contact_roles (
  contact_id uuid not null references contacts(id) on delete cascade,
  role text not null check (role in ('owner', 'buyer', 'prospect', 'tenant', 'guarantor', 'supplier', 'other')),
  created_at timestamptz not null default now(),
  primary key (contact_id, role)
);
create index contact_roles_role on contact_roles(role);

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 60),
  color text
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (contact_id, tag_id)
);

-- Duplicados probables: nunca se fusionan solos; una persona decide.
create table contact_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  contact_a uuid not null references contacts(id) on delete cascade,
  contact_b uuid not null references contacts(id) on delete cascade,
  reason text not null check (reason in ('same_email', 'same_phone', 'similar_name_and_phone', 'same_document')),
  score numeric(4, 3) not null check (score between 0 and 1),
  status text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (contact_a < contact_b),
  unique (contact_a, contact_b)
);

-- Notas y actividad genéricas (timeline de cualquier entidad).
create table notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('contact', 'property', 'lead', 'opportunity', 'rental_contract', 'appointment')),
  entity_id uuid not null,
  body text not null check (length(body) between 1 and 10000),
  author_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index notes_entity on notes(entity_type, entity_id, created_at desc) where deleted_at is null;
create trigger trg_notes_updated before update on notes
  for each row execute function set_updated_at();

create table activities (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  kind text not null,
  summary text not null,
  actor_user_id uuid references users(id),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index activities_entity on activities(entity_type, entity_id, occurred_at desc);
