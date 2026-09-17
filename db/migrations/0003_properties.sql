-- 0003 — Propiedades: tipos con campos dinámicos, ubicaciones jerárquicas, operaciones con precio,
-- historial de precios y estados, características, multimedia, documentos, propietarios, agentes,
-- publicaciones por canal y redirecciones de URLs antiguas.

create table property_types (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  name text not null,
  name_plural text not null,
  category text not null check (category in ('residential', 'land', 'commercial', 'rural', 'development', 'other')),
  -- Definición de campos específicos del tipo (validada en la app): [{key,label,type,unit,options}]
  field_schema jsonb not null default '[]'::jsonb,
  sort_order smallint not null default 100,
  is_active boolean not null default true
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references locations(id),
  kind text not null check (kind in ('country', 'province', 'locality', 'neighborhood', 'gated_community', 'zone')),
  name text not null check (length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9-]{1,140}$'),
  created_at timestamptz not null default now()
);
create unique index locations_unique_child on locations(coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, slug);
create index locations_parent on locations(parent_id);

create sequence property_code_seq start with 1;

create table properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  branch_id uuid references branches(id),
  code integer not null check (code > 0),
  slug text not null check (slug ~ '^[a-z0-9-]{3,160}$'),
  title text not null check (length(title) between 3 and 200),
  description text,
  type_key text not null references property_types(key),
  -- Ciclo de vida comercial (independiente de si está publicada)
  status text not null default 'draft'
    check (status in ('draft', 'available', 'reserved', 'sold', 'rented', 'paused', 'archived')),
  is_published boolean not null default false,
  published_at timestamptz,
  featured boolean not null default false,
  -- Ubicación
  location_id uuid references locations(id),
  address_street text,
  address_number text,
  address_floor text,
  address_unit text,
  hide_exact_address boolean not null default true,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  -- Superficies (m²) y ambientes
  total_area_m2 numeric(12, 2) check (total_area_m2 >= 0),
  covered_area_m2 numeric(12, 2) check (covered_area_m2 >= 0),
  uncovered_area_m2 numeric(12, 2) check (uncovered_area_m2 >= 0),
  land_area_m2 numeric(14, 2) check (land_area_m2 >= 0),
  rooms smallint check (rooms between 0 and 200),
  bedrooms smallint check (bedrooms between 0 and 200),
  bathrooms smallint check (bathrooms between 0 and 200),
  toilets smallint check (toilets between 0 and 200),
  garages smallint check (garages between 0 and 2000),
  age_years smallint check (age_years between 0 and 500),
  orientation text,
  disposition text,
  condition text,
  credit_eligible boolean,
  professional_use boolean,
  allows_pets boolean,
  -- Campos propios del tipo, validados contra property_types.field_schema
  attributes jsonb not null default '{}'::jsonb,
  seo_title text,
  seo_description text,
  -- Trazabilidad de migración / sincronización
  source text not null default 'crm' check (source in ('crm', 'adinco_import')),
  imported_at timestamptz,
  last_synced_at timestamptz,
  manually_verified_at timestamptz,
  manually_verified_by uuid references users(id),
  -- Campos editados por una persona: una reimportación NO los sobrescribe
  protected_fields text[] not null default '{}',
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  unique (organization_id, code),
  unique (slug),
  check (not is_published or status in ('available', 'reserved', 'sold', 'rented')),
  check (not is_published or published_at is not null)
);
create index properties_public on properties(is_published, status, type_key) where deleted_at is null;
create index properties_location on properties(location_id);
create index properties_branch on properties(branch_id);
create index properties_search_trgm on properties
  using gin (f_unaccent(lower(title || ' ' || coalesce(address_street, '') || ' ' || coalesce(description, ''))) gin_trgm_ops);
create trigger trg_properties_updated before update on properties
  for each row execute function set_updated_at();

-- Una propiedad puede ofrecerse en venta y alquiler a la vez: un precio por operación.
create table property_operations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  operation text not null check (operation in ('sale', 'rent', 'temporary_rent')),
  currency text not null check (currency in ('USD', 'ARS')),
  amount numeric(14, 2) check (amount >= 0),
  price_hidden boolean not null default false,
  expenses_amount numeric(14, 2) check (expenses_amount >= 0),
  expenses_currency text check (expenses_currency in ('USD', 'ARS')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, operation),
  check (price_hidden or amount is not null)
);
create index property_operations_search on property_operations(operation, currency, amount) where is_active;
create trigger trg_property_operations_updated before update on property_operations
  for each row execute function set_updated_at();

create table property_price_history (
  id bigint generated always as identity primary key,
  property_id uuid not null references properties(id) on delete cascade,
  operation text not null,
  previous_currency text,
  previous_amount numeric(14, 2),
  new_currency text not null,
  new_amount numeric(14, 2),
  changed_by uuid references users(id),
  source text not null check (source in ('crm', 'import', 'api')),
  reason text,
  changed_at timestamptz not null default now()
);
create index property_price_history_property on property_price_history(property_id, changed_at desc);

create table property_status_history (
  id bigint generated always as identity primary key,
  property_id uuid not null references properties(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references users(id),
  reason text,
  changed_at timestamptz not null default now()
);
create index property_status_history_property on property_status_history(property_id, changed_at desc);

create table features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,80}$'),
  name text not null,
  grp text not null check (grp in ('service', 'amenity', 'characteristic', 'building_service', 'building_amenity', 'ambient')),
  sort_order smallint not null default 100
);

create table property_features (
  property_id uuid not null references properties(id) on delete cascade,
  feature_id uuid not null references features(id),
  primary key (property_id, feature_id)
);
create index property_features_feature on property_features(feature_id);

create table property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'floor_plan', 'virtual_tour')),
  file_id uuid references files(id),
  source_url text,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  alt_text text,
  width integer,
  height integer,
  -- source_only: se sirve desde la URL de origen hasta copiarse a storage propio
  status text not null default 'pending' check (status in ('pending', 'source_only', 'verified', 'stored', 'failed')),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (file_id is not null or source_url is not null)
);
create unique index property_media_source on property_media(property_id, source_url) where source_url is not null and deleted_at is null;
create unique index property_media_one_cover on property_media(property_id) where is_cover and deleted_at is null;
create index property_media_property on property_media(property_id, sort_order) where deleted_at is null;
create trigger trg_property_media_updated before update on property_media
  for each row execute function set_updated_at();

create table property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  file_id uuid not null references files(id),
  kind text not null check (kind in ('deed', 'plan', 'tax', 'authorization', 'appraisal', 'contract', 'other')),
  title text not null,
  visible_to_owner boolean not null default false,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table property_owners (
  property_id uuid not null references properties(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  share_pct numeric(5, 2) check (share_pct > 0 and share_pct <= 100),
  is_primary boolean not null default false,
  since date,
  until date,
  created_at timestamptz not null default now(),
  primary key (property_id, contact_id)
);
create index property_owners_contact on property_owners(contact_id);

create table property_agents (
  property_id uuid not null references properties(id) on delete cascade,
  user_id uuid not null references users(id),
  role text not null default 'lead' check (role in ('lead', 'support')),
  created_at timestamptz not null default now(),
  primary key (property_id, user_id)
);
create unique index property_agents_one_lead on property_agents(property_id) where role = 'lead';
create index property_agents_user on property_agents(user_id);

-- Canales de publicación (web propia, portales, redes) y estado de sincronización por propiedad.
create table publication_channels (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  kind text not null check (kind in ('web', 'portal', 'social')),
  integration_key text references integrations(key),
  is_enabled boolean not null default false
);

create table property_publications (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  channel_key text not null references publication_channels(key),
  desired_state text not null check (desired_state in ('published', 'unpublished')),
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'synced', 'failed', 'retrying', 'awaiting_credentials', 'disabled')),
  external_id text,
  external_url text,
  last_payload_hash text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, channel_key)
);
create index property_publications_status on property_publications(channel_key, sync_status);
create trigger trg_property_publications_updated before update on property_publications
  for each row execute function set_updated_at();

-- URLs antiguas (p. ej. /luciolopez-3021) y slugs anteriores → ficha actual (301). Preserva SEO.
create table property_redirects (
  path text primary key check (path ~ '^/[A-Za-z0-9/_.-]{1,200}$'),
  property_id uuid not null references properties(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index property_redirects_property on property_redirects(property_id);
