-- 0150 — CRM comercial: claves de idempotencia para altas desde formularios (doble envío, reintentos)
-- e índices de las consultas operativas (ficha de contacto, bandeja de leads, agenda y tareas por entidad).

alter table contacts add column idempotency_key text;
create unique index contacts_idempotency_key on contacts(idempotency_key) where idempotency_key is not null;

alter table opportunities add column idempotency_key text;
create unique index opportunities_idempotency_key on opportunities(idempotency_key) where idempotency_key is not null;

alter table notes add column idempotency_key text;
create unique index notes_idempotency_key on notes(idempotency_key) where idempotency_key is not null;

-- Una oportunidad por lead (convertir dos veces el mismo lead no duplica).
create unique index opportunities_one_per_lead on opportunities(lead_id)
  where lead_id is not null and deleted_at is null;

create index opportunities_contact on opportunities(contact_id) where deleted_at is null;
create index appointments_contact on appointments(contact_id, starts_at desc) where contact_id is not null;
create index appointments_opportunity on appointments(opportunity_id) where opportunity_id is not null;
create index tasks_entity on tasks(entity_type, entity_id) where entity_id is not null;
create index leads_unanswered on leads(created_at desc) where first_response_at is null and deleted_at is null;
create index contact_duplicate_candidates_open on contact_duplicate_candidates(created_at desc) where status = 'open';
create index contact_emails_trgm on contact_emails using gin (email_normalized gin_trgm_ops);
