-- Se ejecuta después de CADA corrida de migraciones (idempotente).
-- Si la base es Supabase, la API REST (PostgREST) expone el esquema public a los roles anon/authenticated.
-- Esta app NO usa PostgREST: se cierra todo y se habilita RLS sin políticas (deny-all) como segunda capa.
-- El rol de la app es dueño de las tablas, por lo que RLS no lo afecta.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke execute on all functions in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke execute on all functions in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from authenticated';
  end if;
  -- Las funciones propias nacen con EXECUTE para PUBLIC (invisible en role_routine_grants).
  -- Se excluyen las de extensiones (unaccent, pg_trgm, btree_gist): no son nuestras.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;
