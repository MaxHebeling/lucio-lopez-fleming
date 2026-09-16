-- 0350 — Integraciones: credenciales rotativas cifradas, control de copia de multimedia,
-- unicidad de assets por post y rastro de contenedores de Instagram (idempotencia del publicador).

-- Tokens que el proveedor ROTA (p. ej. Mercado Libre: el refresh_token es de un solo uso y cada renovación
-- devuelve uno nuevo). No pueden vivir solo en variables de entorno: se guardan cifrados con AES-256-GCM
-- usando INTEGRATIONS_ENCRYPTION_KEY (que sí vive solo en el entorno). La base nunca ve el secreto en claro.
create table integration_credentials (
  integration_key text primary key references integrations(key),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  access_expires_at timestamptz,
  rotated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_integration_credentials_updated before update on integration_credentials
  for each row execute function set_updated_at();

-- Copia de multimedia a storage propio: intentos acotados para no reintentar para siempre un origen roto.
alter table property_media add column copy_attempts smallint not null default 0 check (copy_attempts between 0 and 100);
create index property_media_copy_queue on property_media(last_checked_at nulls first)
  where status in ('source_only', 'verified') and file_id is null and deleted_at is null and kind = 'image';

-- Un mismo medio no se repite dentro de un post.
create unique index social_assets_unique_media on social_assets(social_post_id, property_media_id) where property_media_id is not null;

-- Instagram publica en dos pasos (contenedor → media_publish). Guardar el contenedor permite, ante un corte,
-- consultar su estado en lugar de publicar dos veces.
alter table social_posts add column external_container_id text;
create index social_posts_due on social_posts(scheduled_at) where status = 'scheduled';

create index property_publications_retry on property_publications(sync_status, updated_at)
  where sync_status in ('pending', 'retrying', 'awaiting_credentials');
