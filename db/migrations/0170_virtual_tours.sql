-- 0170 — Tours virtuales 360° de propiedades y propiedad demo.
-- Diseño (docs/VIRTUAL_TOURS.md):
--  · "Sin tour" = no existe fila en virtual_tours (un tour por propiedad).
--  · Tour propio (internal): escenas equirectangulares + hotspots + plano. Tour externo (external): Matterport/Kuula/3DVista/otro.
--  · Los archivos subidos desde el CRM viven en `files` (storage existente); los assets estáticos del repo (demo) se
--    referencian por URL local `/tours/...`. Nunca ambos vacíos.
--  · Una propiedad demo (is_demo) jamás puede publicarse: lo garantiza la base, no solo la app.

alter table properties add column is_demo boolean not null default false;
alter table properties add constraint properties_demo_never_published check (not (is_demo and is_published));
create index properties_demo on properties(id) where is_demo;

-- URL de asset: estático del repo (/tours/...) o https absoluto. Nunca javascript:, data:, http: ni rutas relativas.
create function is_tour_asset_url(u text) returns boolean
  language sql immutable
  set search_path = pg_catalog
  as $$ select u is null or u ~ '^(/tours/[A-Za-z0-9/_.-]+|https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[^\s"''<>]*)(\?v=[a-f0-9]{8,64})?$' and length(u) <= 2000 and position('..' in u) = 0 $$;

create table virtual_tours (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references properties(id) on delete cascade,
  kind text not null check (kind in ('internal', 'external')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  provider text check (provider in ('matterport', 'kuula', '3dvista', 'other')),
  external_url text check (external_url ~ '^https://[^\s"''<>]{4,}$' and length(external_url) <= 2000),
  embed_url text check (embed_url ~ '^https://[^\s"''<>]{4,}$' and length(embed_url) <= 2000),
  cover_url text check (is_tour_asset_url(cover_url)),
  cover_file_id uuid references files(id),
  floor_plan_url text check (is_tour_asset_url(floor_plan_url)),
  floor_plan_file_id uuid references files(id),
  floor_plan_width integer check (floor_plan_width between 1 and 20000),
  floor_plan_height integer check (floor_plan_height between 1 and 20000),
  start_scene_id uuid,
  guided_scene_ids uuid[] not null default '{}' check (cardinality(guided_scene_ids) <= 60),
  is_demo boolean not null default false,
  published_at timestamptz,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Externo: proveedor y URL obligatorios. Propio: sin proveedor ni URLs externas.
  constraint virtual_tours_external_fields check (
    (kind = 'external' and provider is not null and external_url is not null)
    or (kind = 'internal' and provider is null and external_url is null and embed_url is null)
  ),
  constraint virtual_tours_published_at check (status <> 'published' or published_at is not null),
  constraint virtual_tours_plan_size check ((floor_plan_width is null) = (floor_plan_height is null))
);
create trigger trg_virtual_tours_updated before update on virtual_tours
  for each row execute function set_updated_at();

create table virtual_tour_scenes (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references virtual_tours(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9-]{1,60}$'),
  panorama_url text check (is_tour_asset_url(panorama_url)),
  panorama_file_id uuid references files(id),
  preview_url text check (is_tour_asset_url(preview_url)),
  preview_file_id uuid references files(id),
  thumbnail_url text check (is_tour_asset_url(thumbnail_url)),
  thumbnail_file_id uuid references files(id),
  width integer not null check (width between 256 and 16384),
  height integer not null check (height between 128 and 8192),
  initial_yaw double precision not null default 0 check (initial_yaw > -pi() and initial_yaw <= pi()),
  initial_pitch double precision not null default 0 check (initial_pitch >= -pi() / 2 and initial_pitch <= pi() / 2),
  sort_order integer not null default 0,
  is_published boolean not null default true,
  plan_x double precision check (plan_x between 0 and 1),
  plan_y double precision check (plan_y between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tour_id, slug),
  unique (tour_id, id),
  constraint virtual_tour_scenes_panorama check (panorama_url is not null or panorama_file_id is not null),
  -- Equirectangular 2:1 con tolerancia de 1 %.
  constraint virtual_tour_scenes_ratio check (abs(width::numeric / height - 2) <= 0.02),
  constraint virtual_tour_scenes_plan check ((plan_x is null) = (plan_y is null))
);
create index virtual_tour_scenes_tour on virtual_tour_scenes(tour_id, sort_order);
create trigger trg_virtual_tour_scenes_updated before update on virtual_tour_scenes
  for each row execute function set_updated_at();

-- Escena inicial: pertenece al mismo tour (FK compuesta). Se anula si la escena se borra.
alter table virtual_tours add constraint virtual_tours_start_scene_fk
  foreign key (id, start_scene_id) references virtual_tour_scenes(tour_id, id) on delete set null (start_scene_id)
  deferrable initially deferred;

create table virtual_tour_hotspots (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references virtual_tour_scenes(id) on delete cascade,
  kind text not null check (kind in ('scene', 'info', 'cta')),
  target_scene_id uuid references virtual_tour_scenes(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  content text check (length(content) <= 600),
  yaw double precision not null check (yaw > -pi() and yaw <= pi()),
  pitch double precision not null check (pitch >= -pi() / 2 and pitch <= pi() / 2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint virtual_tour_hotspots_target check ((kind = 'scene') = (target_scene_id is not null)),
  constraint virtual_tour_hotspots_not_self check (target_scene_id is null or target_scene_id <> scene_id)
);
create index virtual_tour_hotspots_scene on virtual_tour_hotspots(scene_id, sort_order);
create index virtual_tour_hotspots_target on virtual_tour_hotspots(target_scene_id) where target_scene_id is not null;
create trigger trg_virtual_tour_hotspots_updated before update on virtual_tour_hotspots
  for each row execute function set_updated_at();

-- El destino de un hotspot de navegación es una escena del MISMO tour.
create function virtual_tour_hotspot_same_tour() returns trigger
  language plpgsql
  set search_path = public, pg_catalog
  as $$
begin
  if new.target_scene_id is not null and not exists (
    select 1 from virtual_tour_scenes s join virtual_tour_scenes t on t.tour_id = s.tour_id
     where s.id = new.scene_id and t.id = new.target_scene_id
  ) then
    raise exception 'El destino del hotspot tiene que ser una escena del mismo tour';
  end if;
  return new;
end $$;
create trigger trg_virtual_tour_hotspots_same_tour before insert or update of scene_id, target_scene_id on virtual_tour_hotspots
  for each row execute function virtual_tour_hotspot_same_tour();

-- El tour de una propiedad demo queda marcado como demo (y viceversa): no se mezclan.
create function virtual_tour_demo_matches_property() returns trigger
  language plpgsql
  set search_path = public, pg_catalog
  as $$
begin
  if new.is_demo is distinct from (select p.is_demo from properties p where p.id = new.property_id) then
    raise exception 'is_demo del tour debe coincidir con el de la propiedad';
  end if;
  return new;
end $$;
create trigger trg_virtual_tours_demo before insert or update of is_demo, property_id on virtual_tours
  for each row execute function virtual_tour_demo_matches_property();
