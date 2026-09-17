-- 0100 — CRM núcleo: original saneado de cada foto (la versión optimizada queda en file_id)
-- e índices para los listados operativos (auditoría, jobs, notificaciones, advertencias de migración).

-- Original rotado y sin EXIF/GPS (privado). file_id apunta a la versión optimizada webp (pública).
alter table property_media add column original_file_id uuid references files(id);

-- Auditoría: listado general por fecha y filtro por acción.
create index audit_logs_occurred on audit_logs(occurred_at desc);
create index audit_logs_action on audit_logs(action, occurred_at desc);

-- Panel de jobs: por estado y actividad reciente.
create index jobs_status_updated on jobs(status, updated_at desc);

-- Bandeja de notificaciones (leídas y no leídas).
create index notifications_user on notifications(user_id, created_at desc);

-- Revisión de migración: filtros por estado/código.
create index migration_warnings_status on migration_warnings(status, severity, created_at desc);
create index migration_records_property on migration_records(property_id) where property_id is not null;

-- Tokens de restablecimiento/invitación por usuario (reenvío de invitaciones, estado "invitación pendiente").
create index password_reset_tokens_user on password_reset_tokens(user_id, created_at desc);

-- Leads del tablero (sin responder) y propiedades por agente.
create index if not exists leads_unanswered on leads(created_at desc) where first_response_at is null and deleted_at is null;
