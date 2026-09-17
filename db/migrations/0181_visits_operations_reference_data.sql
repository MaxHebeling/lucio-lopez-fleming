-- 0181 — Núcleo operativo de visitas: permisos, flags, configuración (idempotente; también lo recargan los tests).

insert into permissions(key, module, description) values
  ('visits.operate', 'visits', 'Operar sus visitas: en camino, check-in, informe, link del cliente y seguimiento'),
  ('visits.monitor', 'visits', 'Ver el centro operativo de visitas, alertas y reasignar agentes')
on conflict (key) do nothing;

insert into role_permissions(role_key, permission_key)
  select r, 'visits.operate' from unnest(array['super_admin', 'direccion', 'administrador', 'agente']) r
on conflict do nothing;

insert into role_permissions(role_key, permission_key)
  select r, 'visits.monitor' from unnest(array['super_admin', 'direccion', 'administrador']) r
on conflict do nothing;

insert into feature_flags(key, enabled, description) values
  ('visits_operations', true, 'Núcleo operativo de visitas: Mis visitas, check-in, informe, seguimiento y centro operativo'),
  ('client_visit_link', true, 'Link temporal del cliente para seguir su visita (/visita/…)')
on conflict (key) do nothing;

insert into settings(key, value) values
  ('visits.geofence_radius_m', '150'),
  ('visits.geofence_max_accuracy_m', '200'),
  ('visits.checkin_window_minutes', '120'),
  ('visits.location_retention_days', '30'),
  ('visits.client_link_grace_hours', '48'),
  ('visits.alert_upcoming_hours', '24'),
  ('visits.alert_no_checkin_minutes', '15'),
  ('visits.alert_overrun_minutes', '60'),
  ('visits.alert_not_finished_minutes', '120'),
  ('visits.alert_report_hours', '12')
on conflict (key) do nothing;

-- Con el portal de visitas el seguimiento lo confirma una persona («Crear tarea de seguimiento»): la automatización
-- existente no crea la tarea automática cuando la visita se cierra desde el portal (payload.followUpMode = manual).
-- Cerrar una visita desde la Agenda sigue igual que antes.
update automation_definitions
   set conditions = '[{"path":"event.payload.followUpMode","op":"neq","value":"manual"}]'::jsonb, version = version + 1
 where key = 'visit_followup' and conditions = '[]'::jsonb;
