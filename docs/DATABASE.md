# Base de datos

PostgreSQL ≥ 15 (probado en 17). Migraciones SQL en `db/migrations/NNNN_nombre.sql`, aplicadas por `scripts/db/migrate.ts`
(transacción por archivo, checksum inmutable, advisory lock). `db/_post_migrate.sql` corre siempre al final.

## Mapa de módulos

| Módulo | Tablas principales | Notas de integridad |
| --- | --- | --- |
| Organización y acceso | organizations, branches, users, roles, permissions, role_permissions, user_roles, user_branches, sessions, login_attempts, password_reset_tokens | email único (activos), token de sesión solo como sha256, propietario (`kind=owner`) exige `contact_id` |
| Auditoría | audit_logs | **append-only** por trigger (UPDATE/DELETE fallan) |
| Configuración | settings, feature_flags, integrations, integration_logs | secretos nunca en base |
| Asincronía | domain_events (outbox), jobs, webhook_events, automation_definitions, automation_runs, rate_limit_buckets | dedupe_key únicos, `unique(provider, external_event_id)`, `unique(automation_id, trigger_event_id)` |
| Contactos | contacts, contact_emails, contact_phones, contact_addresses, contact_roles, tags, contact_tags, contact_duplicate_candidates, notes, activities | email normalizado, teléfono E.164 + índice por número nacional (ignora el 9), documento único por tipo |
| Propiedades | properties, property_types (field_schema), locations (jerárquicas), property_operations, property_price_history, property_status_history, features, property_features, property_media, property_documents, property_owners, property_agents, publication_channels, property_publications, property_redirects | código único por organización, slug único, publicada ⇒ estado comercial válido, una portada, un agente principal |
| CRM comercial | lead_sources, campaigns, leads, pipelines, pipeline_stages, opportunities, opportunity_stage_history, tasks, appointments, conversations, conversation_messages | lead idempotente por `idempotency_key`; **exclusión**: un agente no puede tener dos citas activas superpuestas |
| Alquileres | adjustment_indices, index_values, rental_contracts, rental_contract_parties, rent_adjustments, rent_obligations, rent_payments, owner_settlements, settlement_lines, outbound_messages | **exclusión**: un inmueble no tiene dos contratos activos superpuestos; pagos no se borran (se anulan); ajuste aplicado inmutable; neto = bruto − honorarios − deducciones (CHECK) |
| Propietarios y marketing | owner_reports, content_templates, social_posts, social_assets, ai_interactions | un post no puede quedar aprobado/programado/publicado sin `approved_by` (CHECK) |
| Migración | migration_runs, migration_records, migration_warnings, external_refs | `unique(source, external_id)`; advertencias no se duplican entre corridas |

## Convenciones

- PK `uuid` (`gen_random_uuid()`), salvo tablas de alto volumen/append-only (`bigint identity`).
- `timestamptz` siempre; fechas de negocio sin hora (vencimientos, períodos) como `date` y en la app como `YYYY-MM-DD`.
- Estados como `text` + `CHECK` (evolucionan sin reescribir enums).
- Soft delete con `deleted_at` en entidades de negocio; datos financieros nunca se borran.
- `updated_at` mantenido por trigger `set_updated_at()`.
- Búsqueda: `pg_trgm` + `f_unaccent()` (wrapper IMMUTABLE que resuelve el esquema de la extensión).

## Supabase

Si la base es Supabase, `_post_migrate.sql` habilita RLS sin políticas en todas las tablas y revoca privilegios de
`anon`/`authenticated` (incluido `EXECUTE` de funciones propias a `PUBLIC`): la API REST automática no expone nada.
La app se conecta con el rol dueño (bypassea RLS). Usar conexión directa o pooler en modo sesión.

## Cambios

1. Crear `db/migrations/NNNN_descripcion.sql` (nunca editar uno aplicado).
2. `pnpm db:migrate && pnpm db:codegen` y versionar `src/server/db/generated.ts` (CI verifica que coincidan).
3. Migraciones destructivas: backup verificado antes (ver BACKUP_RESTORE.md) y plan de reversión escrito en el PR.
