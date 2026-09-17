-- 0500 — AI Core (Fase 1): registro de uso gobernado, memoria de sesión del copiloto, feedback y base de conocimiento
-- (RAG sin embeddings: full-text en español). Bloque 0500–0599 = IA (ver docs/CONVENTIONS.md).
-- Aditiva: el asistente de WhatsApp (0300) sigue escribiendo ai_interactions igual que antes.

-- ───────────── Outbox: tipos de evento con más de un segmento (ai.answer.generated) ─────────────
alter table domain_events drop constraint domain_events_event_type_check;
alter table domain_events add constraint domain_events_event_type_check
  check (event_type ~ '^[a-z_]+(\.[a-z_]+)+$');

-- ───────────── Memoria de sesión del copiloto ─────────────
-- Una conversación por panel abierto. Retención acotada (expires_at, purga diaria ai.housekeeping).
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  mode text not null check (mode in ('assistant', 'analyst')),
  -- Módulo del CRM desde el que se abrió (propiedades, leads…), sin ids ni datos del registro
  module text check (module ~ '^[a-z_]{2,40}$'),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index ai_conversations_user on ai_conversations(user_id, last_message_at desc);
create index ai_conversations_expires on ai_conversations(expires_at);

-- ───────────── ai_interactions: una fila por pedido a la IA (con o sin modelo) ─────────────
-- Se extiende la tabla existente en lugar de crear otra: un único lugar para costo, presupuesto y observabilidad.
-- NUNCA guarda prompts ni respuestas completas: solo metadatos (quién, qué función, modelo, herramientas, resultado).
alter table ai_interactions drop constraint ai_interactions_purpose_check;
alter table ai_interactions add constraint ai_interactions_purpose_check
  check (purpose in ('whatsapp_reply', 'content_copy', 'lead_summary', 'copilot_assistant', 'copilot_analyst'));
alter table ai_interactions drop constraint ai_interactions_status_check;
alter table ai_interactions add constraint ai_interactions_status_check
  check (status in ('ok', 'error', 'timeout', 'invalid_output', 'budget_exceeded', 'fallback', 'unavailable', 'rate_limited', 'blocked'));

alter table ai_interactions
  add column organization_id uuid references organizations(id),
  add column user_id uuid references users(id),
  -- Contexto funcional: copilot.assistant, copilot.analyst… (fases siguientes: concierge, matching…)
  add column feature text check (feature ~ '^[a-z0-9_.]{2,60}$'),
  -- Tarea de ruteo de modelo
  add column task text check (task in ('classify', 'extract', 'answer', 'analyze', 'vision')),
  -- anthropic | deterministic (respuesta armada sin modelo: consultas rápidas, guía sin IA)
  add column provider text check (provider ~ '^[a-z_]{2,30}$'),
  -- Por qué no respondió el modelo (null = respondió o no hacía falta)
  add column fallback_reason text check (fallback_reason in (
    'not_configured', 'flag_disabled', 'budget_exhausted', 'rate_limited', 'provider_error', 'timeout',
    'circuit_open', 'invalid_output', 'guard_blocked', 'governance_blocked')),
  add column retrieval_count smallint check (retrieval_count >= 0),
  add column retrieval_failed boolean not null default false,
  add column tool_failures smallint not null default 0 check (tool_failures >= 0),
  add column request_id text check (length(request_id) <= 100),
  add column ai_conversation_id uuid references ai_conversations(id) on delete set null;

create index ai_interactions_feature on ai_interactions(feature, created_at desc) where feature is not null;
create index ai_interactions_user on ai_interactions(user_id, created_at desc) where user_id is not null;

-- ───────────── Mensajes de la sesión ─────────────
-- content: pregunta (con emails/teléfonos enmascarados) o respuesta mostrada. payload: fuentes, hechos, estado.
create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) <= 8000),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 32768),
  interaction_id uuid references ai_interactions(id) on delete set null,
  -- prompt_id@version con el que se generó (null en respuestas deterministas)
  prompt_ref text check (prompt_ref ~ '^[a-z0-9_.-]{2,60}@[0-9a-z.-]{1,40}$'),
  created_at timestamptz not null default now()
);
create index ai_messages_conversation on ai_messages(conversation_id, created_at);

-- ───────────── Feedback 👍/👎 ─────────────
-- Sobrevive a la purga de la sesión (message_id → null): la calidad se mide en el tiempo.
create table ai_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  message_id uuid references ai_messages(id) on delete set null,
  user_id uuid not null references users(id),
  rating smallint not null check (rating in (-1, 1)),
  comment text check (length(comment) <= 1000),
  feature text check (feature ~ '^[a-z0-9_.]{2,60}$'),
  prompt_ref text,
  interaction_id uuid references ai_interactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);
create index ai_feedback_day on ai_feedback(created_at desc);
create trigger trg_ai_feedback_updated before update on ai_feedback
  for each row execute function set_updated_at();

-- ───────────── Base de conocimiento (guías del CRM en knowledge/*.md) ─────────────
-- organization_id null = guía de la plataforma (compartida). Re-ingesta idempotente por hash.
create table ai_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  path text not null check (path ~ '^knowledge/[a-z0-9-]+\.md$'),
  domain text not null check (domain ~ '^[a-z-]{2,40}$'),
  title text not null check (length(title) between 2 and 200),
  summary text check (length(summary) <= 500),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, path)
);
create trigger trg_ai_knowledge_documents_updated before update on ai_knowledge_documents
  for each row execute function set_updated_at();

create table ai_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references ai_knowledge_documents(id) on delete cascade,
  anchor text not null check (anchor ~ '^[a-z0-9-]{1,120}$'),
  ordinal smallint not null check (ordinal >= 0),
  heading text not null check (length(heading) between 2 and 200),
  body text not null check (length(body) between 1 and 20000),
  -- Pantalla del CRM donde se hace (puede tener [id])
  route text check (route ~ '^/crm(/[A-Za-z0-9_\[\]-]+)*$'),
  -- Alcanza con tener UNO para ver el fragmento; vacío = cualquier usuario del equipo
  permissions text[] not null default '{}',
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Búsqueda en español sin acentos ni signos ("360°" → "360"): el título pesa más que el cuerpo.
  -- La consulta normaliza igual (src/server/ai/knowledge/retrieval.ts).
  search tsvector generated always as (
    setweight(to_tsvector('spanish', regexp_replace(lower(f_unaccent(heading)), '[^a-z0-9]+', ' ', 'g')), 'A') ||
    setweight(to_tsvector('spanish', regexp_replace(lower(f_unaccent(body)), '[^a-z0-9]+', ' ', 'g')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, anchor)
);
create index ai_knowledge_chunks_search on ai_knowledge_chunks using gin (search);
create index ai_knowledge_chunks_heading_trgm on ai_knowledge_chunks using gin (f_unaccent(lower(heading)) gin_trgm_ops);
create trigger trg_ai_knowledge_chunks_updated before update on ai_knowledge_chunks
  for each row execute function set_updated_at();
