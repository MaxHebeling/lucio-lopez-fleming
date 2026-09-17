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
| Visitas (operación) | appointment_events, appointment_checkins, appointment_public_links, appointment_reports, appointment_thanks, visit_alerts; `appointments` con en_route/checked_in/in_progress y marcas de tiempo | transiciones de estado validadas por **trigger**; timeline **append-only** que rechaza claves de ubicación; coordenadas solo en check-ins, con retención (`visits.location_retention`); link: solo hash SHA-256 y **un activo por visita**; alertas `unique(appointment_id, kind)`. Ver docs/operations/VISITS.md |
| Alquileres | adjustment_indices, index_values, rental_contracts, rental_contract_parties, rent_adjustments, rent_obligations, rent_payments, owner_settlements, settlement_lines, outbound_messages | **exclusión**: un inmueble no tiene dos contratos activos superpuestos; pagos no se borran (se anulan); ajuste aplicado inmutable; neto = bruto − honorarios − deducciones (CHECK) |
| Propietarios y marketing | owner_reports, content_templates, social_posts, social_assets, ai_interactions | un post no puede quedar aprobado/programado/publicado sin `approved_by` (CHECK) |
| Tours virtuales 360° | virtual_tours, virtual_tour_scenes, virtual_tour_hotspots; `properties.is_demo` | un tour por propiedad; externo exige proveedor + https; escena inicial y destino de cada punto del mismo tour (FK compuesta + trigger); 2:1 y ángulos en rango (checks); URLs de assets seguras (`is_tour_asset_url`); **una demo nunca se publica** (`properties_demo_never_published`). Ver docs/VIRTUAL_TOURS.md |
| Analítica del sitio | site_events | append-only sin FK; allowlist de eventos (check); **sin IP, user agent ni datos personales**; `props` ≤ 1 KB; retención 13 meses (`site.events_purge`) |
| Migración | migration_runs, migration_records, migration_warnings, external_refs | `unique(source, external_id)`; advertencias no se duplican entre corridas |
| IA (0500–0501) | ai_interactions (extendida), ai_conversations, ai_messages, ai_feedback, ai_knowledge_documents, ai_knowledge_chunks | `ai_interactions` sin prompts ni respuestas (solo metadatos, `fallback_reason` con check); sesiones con `expires_at` (purga diaria); feedback único por (mensaje, usuario) y sobrevive a la purga; guías `unique nulls not distinct (organization_id, path)`, secciones `unique(document_id, anchor)` con hash, `tsvector` generado en español sin acentos (GIN) y permisos por sección. Ver docs/ai/AI_CORE.md |
| AI Property e IA de visitas (0520–0521) | property_quality_reports, property_media_analysis, property_media_rooms, property_marketing_drafts, visit_ai_outputs, owner_capture_uploads, lead_attachments; `ai_interactions.purpose` por formato | informe único por propiedad con `input_hash` (idempotente); métricas por archivo analizado con versión del algoritmo; etiqueta y sugerencia con checks de coherencia; **un borrador abierto por (propiedad, canal)** (índice único parcial) con applied/discarded coherentes; propuestas de visita únicas por (visita, tipo); subidas anónimas con token solo como SHA-256 y vencimiento. Ver docs/ai/PROPERTY.md |

| IA Gestión y Automatización (0530–0531) | ai_anomalies, ai_daily_briefs; `sales_recommendations` generalizada (Tareas sugeridas); causalidad en domain_events y jobs; `client_preferences.source` + visit_report | sugerencia única por (entidad, regla, huella) con origen en lista cerrada, `expired` ⇒ `resolved_at`, ventas ⇒ contacto; anomalía única por `dedupe_key`, organización ⇔ sin entidad, evidencia ≤ 4 KB; resumen por (usuario, día) con hashes de hechos y redacción; `depth` 0–50. Ver docs/ai/MANAGEMENT.md y docs/ai/AUTOMATION.md |

| IA Ventas (0510–0511) | client_preferences, property_matches, sales_recommendations, site_session_links; site_events (allowlist ampliada) | preferencias: lista cerrada de campos (check), `unique(contact_id, field)` parcial para confirmado y para sugerido, confianza 0–1, decidido ⇒ `decided_at`; coincidencias `unique(contact_id, property_id)` con versión de algoritmo y descarte con motivo obligatorio; recomendaciones `unique(entity_type, entity_id, rule_key, fingerprint)`, aceptada ⇒ `task_id`, pospuesta ⇒ `snoozed_until`; vínculo de sesión `unique(session_key, contact_id)` con retención de 13 meses. Ver docs/ai/SALES.md |

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
La app se conecta con el rol dueño (bypassea RLS).

Conexiones en Vercel: la app usa el **pooler en modo transacción** (Supabase: puerto 6543) — el código no depende de
estado de sesión (solo locks transaccionales `pg_advisory_xact_lock` y `set_config(..., true)`), pool de 3 conexiones por
instancia con 5 s de inactividad y `attachDatabasePool`. Migraciones y backups usan `MIGRATION_DATABASE_URL` (conexión
directa o pooler en modo sesión, puerto 5432) porque toman un advisory lock de sesión. La conexión directa de Supabase es
solo IPv6: desde runners sin IPv6 (GitHub Actions) usar el pooler en modo sesión.

## Cambios

1. Crear `db/migrations/NNNN_descripcion.sql` (nunca editar uno aplicado).
2. `pnpm db:migrate && pnpm db:codegen` y versionar `src/server/db/generated.ts` (CI verifica que coincidan).
   Si cambió `knowledge/`, además `pnpm ai:knowledge:ingest` (idempotente).
3. Migraciones destructivas: backup verificado antes (ver BACKUP_RESTORE.md) y plan de reversión escrito en el PR.
