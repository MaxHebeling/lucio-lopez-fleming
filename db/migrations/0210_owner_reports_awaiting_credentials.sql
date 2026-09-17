-- 0210 — Informes a propietarios: el estado refleja cuando el email quedó esperando credenciales del proveedor
-- (antes quedaba "queued" para siempre y no se podía reenviar).
alter table owner_reports drop constraint owner_reports_status_check;
alter table owner_reports add constraint owner_reports_status_check
  check (status in ('generated', 'queued', 'sent', 'delivered', 'failed', 'awaiting_credentials'));
