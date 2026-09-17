-- 0520 — AI Property (Fase 3) + IA de visitas (Fase 4b). Bloque 0520–0529 (docs/CONVENTIONS.md, docs/ai/PROPERTY.md).
-- Aditiva: ninguna tabla existente cambia de forma salvo el check de `ai_interactions.purpose` (formato en lugar de lista).
-- Nada de esto modifica propiedades, fotos ni visitas: guarda informes, métricas, etiquetas, propuestas y borradores.

-- ───────────── ai_interactions.purpose: de lista cerrada a formato ─────────────
-- Cada fase agrega funciones (calidad, visión, marketing, visitas…). Con una lista cerrada, dos ramas que la amplían en
-- paralelo se pisan al mergear; el formato conserva la integridad (texto corto snake_case) sin ese acoplamiento.
alter table ai_interactions drop constraint ai_interactions_purpose_check;
alter table ai_interactions add constraint ai_interactions_purpose_check check (purpose ~ '^[a-z][a-z_]{1,39}$');

-- ───────────── Calidad de la publicación (un informe vigente por propiedad) ─────────────
-- Lo recalcula el job `ai.property_quality` (evento property.* y nocturno). `input_hash` = hash de TODO lo que usa el
-- cálculo: si no cambió, el job no reescribe (idempotente). Nunca modifica la propiedad.
create table property_quality_reports (
  property_id uuid primary key references properties(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  -- Score final 0–100 (completitud ponderada menos penalizaciones documentadas en docs/ai/PROPERTY.md)
  score smallint not null check (score between 0 and 100),
  completeness_score smallint not null check (completeness_score between 0 and 100),
  -- [{key,label,weight,ok,applies,href}]
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array' and pg_column_size(criteria) <= 32768),
  -- [{code,severity,title,detail,href,mediaIds?}] — detecciones (faltantes, inconsistencias, descripción, fotos)
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array' and pg_column_size(findings) <= 65536),
  -- {images, stored, analyzed, external, duplicates, dark, blurry}
  media_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(media_summary) = 'object'),
  missing_count smallint not null default 0 check (missing_count >= 0),
  warning_count smallint not null default 0 check (warning_count >= 0),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  rules_version text not null check (rules_version ~ '^[0-9a-z.-]{1,40}$'),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index property_quality_reports_org_score on property_quality_reports(organization_id, score);
create trigger trg_property_quality_reports_updated before update on property_quality_reports
  for each row execute function set_updated_at();

-- ───────────── Métricas de imagen (solo medios guardados en NUESTRO storage) ─────────────
-- Fotos `source_only`/`verified` (URL del sitio anterior) no se descargan ni se analizan: se informan como externas.
-- `checksum_sha256` del archivo analizado: si el archivo cambia, se vuelve a analizar.
create table property_media_analysis (
  media_id uuid primary key references property_media(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  file_id uuid not null references files(id),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  algorithm_version text not null check (algorithm_version ~ '^[0-9a-z.-]{1,40}$'),
  width integer check (width > 0),
  height integer check (height > 0),
  -- Hash perceptual de diferencias (dHash 8×8 = 64 bits en hex)
  dhash text not null check (dhash ~ '^[0-9a-f]{16}$'),
  luminance_mean numeric(6, 2) not null check (luminance_mean between 0 and 255),
  luminance_p95 numeric(6, 2) not null check (luminance_p95 between 0 and 255),
  dark_pixel_ratio numeric(5, 4) not null check (dark_pixel_ratio between 0 and 1),
  -- Nitidez: varianza del Laplaciano y varianza de luminancia a 512 px (su cociente no depende de la exposición)
  laplacian_variance numeric(12, 2) not null check (laplacian_variance >= 0),
  luminance_variance numeric(12, 2) not null check (luminance_variance >= 0),
  analyzed_at timestamptz not null default now()
);
create index property_media_analysis_property on property_media_analysis(property_id);

-- ───────────── Ambiente de cada foto (AI Photo Director) ─────────────
-- `room`: etiqueta vigente (manual o sugerencia de IA aceptada por una persona). `suggested_*`: propuesta de la IA
-- pendiente de revisión; nunca se usa como dato hasta que alguien la acepta.
create table property_media_rooms (
  media_id uuid primary key references property_media(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  room text check (room in ('fachada', 'living', 'cocina', 'comedor', 'dormitorio', 'bano', 'jardin', 'piscina', 'exterior', 'plano', 'otro')),
  room_source text check (room_source in ('manual', 'ai_accepted')),
  room_confidence numeric(4, 3) check (room_confidence between 0 and 1),
  tagged_by uuid references users(id),
  tagged_at timestamptz,
  suggested_room text check (suggested_room in ('fachada', 'living', 'cocina', 'comedor', 'dormitorio', 'bano', 'jardin', 'piscina', 'exterior', 'plano', 'otro')),
  suggested_confidence numeric(4, 3) check (suggested_confidence between 0 and 1),
  suggested_at timestamptz,
  suggestion_status text check (suggestion_status in ('pending', 'accepted', 'dismissed')),
  suggestion_prompt text check (suggestion_prompt ~ '^[a-z0-9_.-]{2,60}@[0-9a-z.-]{1,40}$'),
  -- Archivo sobre el que se sugirió: no se vuelve a pedir visión para la misma imagen
  suggestion_checksum text check (suggestion_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((room is null) = (room_source is null)),
  check ((room is null) = (tagged_at is null)),
  check ((suggested_room is null) = (suggested_at is null)),
  check ((suggested_room is null) = (suggestion_status is null))
);
create index property_media_rooms_property on property_media_rooms(property_id);
create index property_media_rooms_pending on property_media_rooms(property_id) where suggestion_status = 'pending';
create trigger trg_property_media_rooms_updated before update on property_media_rooms
  for each row execute function set_updated_at();

-- ───────────── Borradores de marketing por propiedad (AI Marketing Director) ─────────────
-- Instagram y Facebook NO van acá: usan `social_posts` (misma cola, revisión, aprobación y publicación de siempre).
-- Acá quedan los canales sin cola propia: SEO del sitio, WhatsApp, email y guion de Reel. Un borrador abierto por canal.
create table property_marketing_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  property_id uuid not null references properties(id) on delete cascade,
  channel text not null check (channel in ('site_seo', 'whatsapp', 'email', 'reel_script')),
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 32768),
  generated_by text not null check (generated_by in ('template', 'ai', 'human')),
  prompt_version text check (prompt_version ~ '^[a-z0-9_.-]{2,60}@[0-9a-z.-]{1,40}$'),
  rules_version text not null check (rules_version ~ '^[0-9a-z.-]{1,40}$'),
  -- Hash de los datos reales usados: regenerar con los mismos datos no crea nada nuevo
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  applied_by uuid references users(id),
  applied_at timestamptz,
  discarded_by uuid references users(id),
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'applied') = (applied_at is not null)),
  check ((status = 'discarded') = (discarded_at is not null))
);
create unique index property_marketing_drafts_one_open on property_marketing_drafts(property_id, channel) where status = 'draft';
create index property_marketing_drafts_property on property_marketing_drafts(property_id, created_at desc);
create trigger trg_property_marketing_drafts_updated before update on property_marketing_drafts
  for each row execute function set_updated_at();

-- ───────────── IA de visitas: propuestas (brief previo, informe estructurado, agradecimiento) ─────────────
-- Una fila vigente por (visita, tipo). `status`: proposed (a revisar) → applied / dismissed. Nunca es un hecho del
-- informe: el informe real sigue en appointment_reports y lo confirma el agente.
create table visit_ai_outputs (
  appointment_id uuid not null references appointments(id) on delete cascade,
  kind text not null check (kind in ('brief', 'report_proposal', 'thanks_draft')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 32768),
  generated_by text not null check (generated_by in ('rules', 'ai')),
  prompt_version text check (prompt_version ~ '^[a-z0-9_.-]{2,60}@[0-9a-z.-]{1,40}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'dismissed')),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (appointment_id, kind)
);
create trigger trg_visit_ai_outputs_updated before update on visit_ai_outputs
  for each row execute function set_updated_at();

-- ───────────── Captación de propietarios: fotos opcionales ─────────────
-- Subidas anónimas en espera (privadas) que se vinculan al lead cuando se envía el formulario. Vencen a las 24 h y se
-- purgan (objeto + fila). El navegador recibe un token aleatorio: en la base queda solo su SHA-256.
create table owner_capture_uploads (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  check (expires_at > created_at),
  check ((lead_id is null) or (claimed_at is not null))
);
create index owner_capture_uploads_expires on owner_capture_uploads(expires_at) where claimed_at is null;

create table lead_attachments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  file_id uuid not null references files(id),
  kind text not null check (kind in ('owner_photo')),
  created_at timestamptz not null default now(),
  unique (lead_id, file_id)
);
create index lead_attachments_file on lead_attachments(file_id);
