-- 0160 — Endurecimiento de seguridad sobre datos (auditoría 2026-09).

-- 1) Búsqueda de texto del sitio público: con `hide_exact_address` la calle NO participa (el importador dejó la altura
--    embebida en `address_street`, p. ej. "Caseros 468"). Mismo texto que `publicTextSearchCondition` en
--    src/server/properties/public.ts. El índice properties_search_trgm (con la calle) queda para la búsqueda del CRM.
create index if not exists properties_public_search_trgm on properties
  using gin (f_unaccent(lower(title || ' ' || case when hide_exact_address then '' else coalesce(address_street, '') end || ' ' || coalesce(description, ''))) gin_trgm_ops);

-- 2) Capturas anónimas / de canales no verificados sobre un contacto que ya existía: el email o teléfono enviado NO se
--    agrega a la ficha (evita que un tercero "cuelgue" su email del propietario); queda en el lead para revisión humana.
alter table leads
  add column submitted_email text check (submitted_email is null or length(submitted_email) <= 254),
  add column submitted_phone text check (submitted_phone is null or length(submitted_phone) <= 40);
create index leads_unverified_contact_data on leads(created_at desc)
  where (submitted_email is not null or submitted_phone is not null) and deleted_at is null;

-- 3) Multimedia borrada: el objeto del bucket público se elimina después de la baja lógica. Marca de borrado físico
--    para reintentar los que fallaron.
alter table files add column storage_removed_at timestamptz;
create index files_public_pending_removal on files(deleted_at)
  where deleted_at is not null and visibility = 'public' and storage_removed_at is null;
