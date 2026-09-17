-- 0360 — Confiabilidad de integraciones y de la cola.

-- enqueueScheduled busca por dedupe_key en cada pasada del cron (también jobs terminados): sin índice era Seq Scan.
create index if not exists jobs_dedupe_key on jobs(dedupe_key) where dedupe_key is not null;

-- ensureWhatsAppLead cuenta los leads de la conversación en cada mensaje entrante.
create index if not exists leads_conversation on leads(conversation_id) where conversation_id is not null;

-- Sincronización con portales:
-- - sync_locked_until: exclusión entre workers que NO pisa markPublications (que reescribe sync_status al
--   publicar/despublicar mientras un job está hablando con el portal).
-- - remote_write_started_at: se marca antes de una escritura remota (crear/actualizar/pausar) y se limpia solo con un
--   resultado definitivo. Si quedó marcada, el resultado anterior es incierto: antes de crear se busca el aviso
--   existente por referencia propia en lugar de crear otro.
alter table property_publications
  add column sync_locked_until timestamptz,
  add column remote_write_started_at timestamptz;

-- Retención (system.housekeeping).
create index if not exists webhook_events_retention on webhook_events(received_at) where status in ('processed', 'ignored');
create index if not exists integration_logs_created on integration_logs(created_at);
