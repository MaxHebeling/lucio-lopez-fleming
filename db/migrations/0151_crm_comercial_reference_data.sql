-- 0151 — Permisos del CRM comercial (idempotente; se recarga junto con los datos de referencia).
insert into permissions(key, module, description) values
  ('tasks.read_all', 'tasks', 'Ver y gestionar las tareas de todo el equipo'),
  ('opportunities.assign', 'opportunities', 'Asignar oportunidades a agentes')
on conflict (key) do nothing;

insert into role_permissions(role_key, permission_key)
  select r, p from unnest(array['super_admin', 'direccion', 'administrador']) r,
                   unnest(array['tasks.read_all', 'opportunities.assign']) p
on conflict do nothing;

insert into role_permissions(role_key, permission_key) values ('solo_lectura', 'tasks.read_all')
on conflict do nothing;
