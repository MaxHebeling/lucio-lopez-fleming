-- 0201 — Motor de alquileres: detalle de cálculo de ajustes, rechazo con motivo y recálculo,
-- aviso de ajuste pendiente por falta de índices, documentos privados de contratos e índices de consulta.

-- Ajustes: se guarda el detalle completo del cálculo (fechas pedidas/usadas, valores, meses) para auditoría.
alter table rent_adjustments add column calculation jsonb not null default '{}'::jsonb;
alter table rent_adjustments add column rejected_reason text;
alter table rent_adjustments add column rejected_by uuid references users(id);
alter table rent_adjustments add column rejected_at timestamptz;
alter table rent_adjustments add constraint rent_adjustments_rejected_reason
  check (status <> 'rejected' or (rejected_reason is not null and length(rejected_reason) >= 3));

-- Un ajuste rechazado no bloquea recalcular la misma fecha (p. ej. tras corregir un índice cargado a mano):
-- solo puede haber uno propuesto o aplicado por contrato y fecha efectiva.
alter table rent_adjustments drop constraint rent_adjustments_contract_id_effective_date_key;
create unique index rent_adjustments_one_live on rent_adjustments(contract_id, effective_date) where status <> 'rejected';
create index rent_adjustments_contract on rent_adjustments(contract_id, effective_date desc);

-- Índices mensuales (IPC, CASA_PROPIA): `value` guarda el coeficiente del mes = 1 + variación mensual / 100
-- (siempre > 0) con period_date = día 1 del mes. Índices diarios (ICL, CER): valor publicado del día.
comment on column index_values.value is
  'Diarios (ICL/CER): valor publicado del día. Mensuales (IPC/CASA_PROPIA): coeficiente 1 + variación mensual/100, period_date = día 1.';

-- Aviso visible en la ficha cuando el ajuste vence y no se puede calcular (faltan valores de índice).
alter table rental_contracts add column adjustment_pending_note text;
alter table rental_contracts add column adjustment_checked_at timestamptz;
alter table rental_contracts add column ended_reason text;

-- Documentos privados del contrato (contrato firmado, garantías, inventario...). Los bytes van a storage privado.
create table rental_contract_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references rental_contracts(id),
  file_id uuid not null references files(id),
  kind text not null check (kind in ('contract', 'addendum', 'guarantee', 'inventory', 'receipt', 'other')),
  title text not null check (length(title) between 2 and 200),
  visible_to_owner boolean not null default false,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index rental_contract_documents_contract on rental_contract_documents(contract_id) where deleted_at is null;

create index rent_payments_contract_paid on rent_payments(contract_id, paid_on) where voided_at is null;
create index rent_obligations_contract on rent_obligations(contract_id, period_start);
create index settlement_lines_payment on settlement_lines(payment_id) where payment_id is not null;
create index owner_reports_owner on owner_reports(owner_contact_id, period_start desc);
create index leads_property_created on leads(property_id, created_at) where property_id is not null and deleted_at is null;
