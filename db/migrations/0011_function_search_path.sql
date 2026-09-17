-- 0011 — search_path fijo en funciones propias (advisor de Supabase "function_search_path_mutable").
-- Evita que un search_path manipulado en la sesión cambie qué objetos resuelven estas funciones.
-- Todas usan nombres calificados u objetos de pg_catalog, por lo que un search_path mínimo es seguro.
alter function public.f_unaccent(text) set search_path = pg_catalog, pg_temp;
alter function public.set_updated_at() set search_path = pg_catalog, pg_temp;
alter function public.audit_logs_immutable() set search_path = pg_catalog, pg_temp;
alter function public.rent_adjustments_guard() set search_path = pg_catalog, pg_temp;
alter function public.rent_payments_no_delete() set search_path = pg_catalog, pg_temp;
