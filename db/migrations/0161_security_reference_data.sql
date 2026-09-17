-- 0161 — Permisos del endurecimiento de seguridad (idempotente; se recarga junto con los datos de referencia).

-- Asignar agentes (responsable/apoyo) de una propiedad: define quién recibe sus leads. No es "editar datos".
insert into permissions(key, module, description) values
  ('properties.assign_agents', 'properties', 'Asignar el agente responsable y de apoyo de propiedades')
on conflict (key) do nothing;

insert into role_permissions(role_key, permission_key)
  select r, 'properties.assign_agents' from unnest(array['super_admin', 'direccion', 'administrador']) r
on conflict do nothing;
