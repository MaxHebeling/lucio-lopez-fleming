-- 0530 — IA Fase 5 (AI Management) y Fase 6 (AI Automation). Bloque 0530–0549 (ver docs/CONVENTIONS.md). Aditiva:
-- solo agrega columnas con default, tablas nuevas y amplía checks. El código de la versión anterior sigue funcionando
-- con esta migración aplicada (docs/ai/AUTOMATION.md › Despliegue seguro).

-- ───────────── Outbox: causalidad para la protección contra loops ─────────────
-- Un evento emitido mientras corre una automatización (o un job encolado por ella) guarda el evento que lo causó,
-- la raíz de la cadena, la profundidad y la automatización. El motor no dispara automatizaciones sobre eventos más
-- profundos que `ai.events.max_depth` ni vuelve a correr una automatización que ya participó de la misma cadena.
alter table domain_events
  add column causation_id bigint,
  add column correlation_id bigint,
  add column depth smallint not null default 0 check (depth between 0 and 50),
  add column caused_by_automation text check (caused_by_automation ~ '^[a-z0-9_]{2,80}$');
create index domain_events_causation on domain_events(causation_id) where causation_id is not null;

-- Jobs encolados por una automatización heredan la causa (el runner la restaura al ejecutar el handler).
alter table jobs
  add column causation_event_id bigint,
  add column causation_depth smallint check (causation_depth between 0 and 50),
  add column caused_by_automation text check (caused_by_automation ~ '^[a-z0-9_]{2,80}$');

-- ───────────── Tareas sugeridas: `sales_recommendations` generalizada ─────────────
-- Decisión (docs/ai/MANAGEMENT.md › Modelo de datos): NO se crea `ai_recommendations`. La tabla de la Fase 2 ya tiene
-- el ciclo completo (propuesta → aceptar con tarea real / descartar con nota / posponer), la huella de evidencia y la
-- unicidad por (entidad, regla, huella). Se generaliza con un ORIGEN, un responsable y el estado `expired` (la
-- situación que la originó desapareció). Las filas de la Fase 2 quedan con origen `sales_nba` y su contacto.
alter table sales_recommendations
  add column source text not null default 'sales_nba'
    check (source in ('sales_nba', 'visit', 'property_quality', 'marketing', 'ops_alert', 'assignment', 'anomaly')),
  add column assigned_user_id uuid references users(id),
  add column link text check (link ~ '^/crm(/[A-Za-z0-9_./#?=&%-]*)?$' and length(link) <= 300),
  -- { kind, title, dueInHours, priority } de la tarea que se crea al aceptar (sin datos personales)
  add column task_template jsonb check (task_template is null or (jsonb_typeof(task_template) = 'object' and pg_column_size(task_template) <= 1024)),
  add column last_seen_at timestamptz,
  add column resolved_at timestamptz;
alter table sales_recommendations alter column contact_id drop not null;
alter table sales_recommendations add constraint sales_recommendations_contact_for_sales check (source <> 'sales_nba' or contact_id is not null);
alter table sales_recommendations drop constraint sales_recommendations_entity_type_check;
alter table sales_recommendations add constraint sales_recommendations_entity_type_check
  check (entity_type in ('contact', 'lead', 'opportunity', 'property', 'appointment', 'organization'));
alter table sales_recommendations drop constraint sales_recommendations_status_check;
alter table sales_recommendations add constraint sales_recommendations_status_check
  check (status in ('open', 'accepted', 'dismissed', 'snoozed', 'expired'));
alter table sales_recommendations drop constraint sales_recommendations_check2;
alter table sales_recommendations add constraint sales_recommendations_decided check (status in ('open', 'expired') or decided_at is not null);
alter table sales_recommendations add constraint sales_recommendations_expired check (status <> 'expired' or resolved_at is not null);
create index sales_recommendations_inbox on sales_recommendations(organization_id, status, assigned_user_id);
create index sales_recommendations_source on sales_recommendations(source, status);

-- ───────────── Anomalías (detección prudente, deduplicada y con evidencia) ─────────────
create table ai_anomalies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  kind text not null check (kind in ('lead_uncontacted', 'visit_without_followup', 'property_inquiry_drop', 'data_contradiction', 'job_failure_spike', 'ai_failure_spike')),
  entity_type text not null check (entity_type in ('lead', 'appointment', 'property', 'organization')),
  entity_id uuid,
  -- kind:entidad:huella → una fila por situación; se resuelve sola y se reabre si vuelve
  dedupe_key text not null unique check (length(dedupe_key) <= 200),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null check (length(title) between 2 and 200),
  -- [{ label, value }] sin datos personales ni texto libre de clientes
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) <= 4096),
  assigned_user_id uuid references users(id),
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz,
  check ((entity_type = 'organization') = (entity_id is null))
);
create index ai_anomalies_open on ai_anomalies(organization_id, severity) where resolved_at is null;
create index ai_anomalies_assigned on ai_anomalies(assigned_user_id) where resolved_at is null;

-- ───────────── «Resumen de hoy»: cache por usuario y día (Salta) ─────────────
create table ai_daily_briefs (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  organization_id uuid not null references organizations(id),
  -- conteos con definición y link (sin datos personales)
  facts jsonb not null check (jsonb_typeof(facts) = 'object' and pg_column_size(facts) <= 16384),
  facts_hash text not null check (facts_hash ~ '^[0-9a-f]{16,64}$'),
  -- redacción con IA (solo con clave): { facts: string, interpretation: string[] } validada contra los conteos
  narrative jsonb check (narrative is null or (jsonb_typeof(narrative) = 'object' and pg_column_size(narrative) <= 4096)),
  narrative_hash text check (narrative_hash ~ '^[0-9a-f]{16,64}$'),
  narrative_prompt text check (length(narrative_prompt) <= 80),
  ai_attempts smallint not null default 0 check (ai_attempts between 0 and 100),
  computed_at timestamptz not null default now(),
  stale boolean not null default false,
  primary key (user_id, day)
);
create index ai_daily_briefs_day on ai_daily_briefs(day);

-- ───────────── Perfil del comprador: nuevo origen «informe de visita» (siempre SUGERIDO) ─────────────
alter table client_preferences drop constraint client_preferences_source_check;
alter table client_preferences add constraint client_preferences_source_check
  check (source in ('form', 'concierge', 'conversation', 'agent', 'lead_message', 'visit_report'));
