# Mapa de arquitectura real (auditoría previa al AI Core)

Relevado sobre `main` (commit `60de445`) antes de escribir código de la Fase 1. Para cada pieza: qué hay y qué reutiliza
el AI Core. Nada de esto se reemplazó.

## Línea base (scripts existentes, antes de tocar código)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos (7,5 s) |
| `pnpm typecheck` | OK (`next typegen && tsc --noEmit`, 9,7 s) |
| `pnpm test` | 50 archivos, **437 tests OK** (unit + integración contra Postgres 17 local `llf_test_ai`, 48,8 s) |
| `pnpm build` | OK (15,8 s). First Load JS del CRM: 492–532 KB sin comprimir por ruta (`.next/diagnostics/route-bundle-stats.json`) |

## Mapa

| Área | Estado real | Qué reutiliza el AI Core |
| --- | --- | --- |
| **Framework** | Next 16.3 App Router, React 19.2, Tailwind 4, TypeScript estricto. Monolito modular: `src/app` (UI), `src/server/<módulo>` (dominio). `src/proxy.ts` agrega `x-request-id` y `x-pathname`. | Mismo monolito: `src/server/ai/**`. UI del copiloto como componentes cliente del CRM cargados bajo demanda. |
| **Routing** | Sitio público `(site)`, CRM `/crm/(panel)/**` (layout con menú filtrado por permisos, `nav.ts`), portal `/propietarios`, API `/api/**` (cron, webhooks, health, v1, subidas del CRM). | Panel montado en el layout del CRM; página nueva `/crm/integraciones/ia`. Server Actions en `crm/(panel)/_copilot/actions.ts`. El sitio público no se toca. |
| **Auth** | Propia: argon2id, sesiones hasheadas (`auth/session.ts`), `getActor()` / `requireStaffPage()`; `Actor` = staff/owner/system/anonymous con `organizationId`. `runAction` (Server Actions) y `apiRoute` bloquean mutaciones con cambio de contraseña pendiente. | Toda operación del copiloto recibe el `Actor` autenticado vía `runAction`; `requireStaff` + `requirePermission`. |
| **RBAC** | Tablas `roles`, `permissions`, `role_permissions`, `user_roles`; 7 roles; `can()` (super_admin = todo). Alcance propio/todos en `crm/access.ts` (leads, oportunidades, agenda, tareas) y `conversations/scope.ts`. Loaders con 404 fuera de alcance (`crm/entities.ts`). | Permisos nuevos `ai.copilot` y `ai.read_usage`. Cada herramienta declara permisos; usa `leadScope`/`opportunityScope`/`agendaScope`/`taskScope` y los loaders para el contexto de pantalla. |
| **Datos** | Postgres ≥ 15 + Kysely; migraciones SQL inmutables por bloque (`scripts/db/migrate.ts`, checksum, advisory lock), `_post_migrate.sql` (RLS deny-all, revokes), tipos generados versionados (`db:codegen`, `db:codegen:verify` en CI). Extensiones `pg_trgm`, `unaccent` (`f_unaccent` inmutable), `btree_gist`. `organization_id` en organizations/branches/users/contacts/properties/leads/opportunities/rental_contracts; tareas y citas se atribuyen por usuario. | Migraciones `0500_ai_core.sql` + `0501_ai_core_reference_data.sql` (bloque nuevo 0500–0599 = IA). `tsvector` generado con `f_unaccent`. Todas las consultas filtran por `organization_id` (directo o vía usuario). |
| **Auditoría** | `audit(trx, actor, …)` en `audit_logs` append-only. | El uso de IA se audita en `ai_interactions` (metadatos, sin prompts). Cambios de flags ya auditados por `setFeatureFlag`. |
| **Eventos / jobs** | Outbox `domain_events` + `emitEvent` en la misma transacción; cola `jobs` con lease, reintentos y dead handlers; tareas periódicas (`addScheduledTask`); cron `/api/cron/jobs` cada minuto; motor de automatizaciones TRIGGER → CONDITIONS → ACTIONS. | Eventos `ai.answer.generated`, `ai.feedback.recorded`. Jobs diarios `ai.knowledge_ingest` y `ai.housekeeping`. Ninguna automatización escucha eventos de IA (sin loops). |
| **Flags / settings / rate limit** | `feature_flags` (cache 15 s, apagado = desconocido), editables en Integraciones con auditoría; `settings` jsonb; `rateLimit()` de ventana fija en `rate_limit_buckets`. | Flags `ai_copilot` (encendido) + `ai_concierge`, `ai_matching`, `ai_property_qa`, `ai_visit_brief`, `ai_followup`, `ai_executive`, `ai_automations` (apagados). Settings de ruteo, límites y retención. Límite por usuario con `rateLimit`. |
| **Notificaciones** | `notifications` + `notifyUser`/`notifyRole`. | No se usan en la Fase 1 (la IA no avisa a nadie). |
| **Integraciones** | `callIntegration()` (circuit breaker persistido + `integration_logs` + alerta `integration.failed`), `withTimeout`, `retry`; `awaiting_credentials` sin variables (`integrations/credentials.ts`). Pantalla `/crm/integraciones`. | El proveedor Anthropic pasa por `callModel` → `callIntegration`. La página de uso de IA cuelga de Integraciones. |
| **IA existente** | `ai/client.ts` (SDK 0.126.0, cliente cacheado, `awaiting_credentials`, `callModel` con timeout/reintentos/deadline), `budget.ts` (`ai.daily_budget_usd`, día de Salta), `pricing.ts` (incluye Haiku 4.5: USD 1/5 por MTok), `guards.ts` (grounding post-IA), `whatsapp/*` (agente con herramientas, prompt versionado, reglas deterministas), tabla `ai_interactions` (0006 + 0300). | Todo reutilizado: `AnthropicProvider` envuelve `callModel`; mismo presupuesto y precios; `guards.ts` extendido con rutas del CRM; `ai_interactions` extendida (no se creó otra tabla). El agente de WhatsApp sigue igual. |
| **Visitas (núcleo operativo, PR #9, mergeado durante la fase)** | `src/server/visits/*`: estados en camino/check-in/en curso con trigger, check-ins con geofence, link del cliente, informes, alertas (`visit_alerts`), permisos `visits.operate`/`visits.monitor`, flags `visits_operations`/`client_visit_link`, `/crm/mis-visitas`, `/crm/centro-operativo`, puntos de extensión nulos para IA. | `visits_today` e `visit_incidents` reutilizan `visitScope`, `listMyVisits` y `getOpsBoard`; contexto `/crm/mis-visitas/[id]` con `loadVisit`; guía `knowledge/visits.md`. Extensiones de IA sin implementar (Fase 4). |
| **Storage** | `storage/index.ts`: driver local (dev) o S3 compatible; privados con URL firmada. | No se usa en la Fase 1 (`vision` queda declarada para fases siguientes). |
| **Analítica** | `site_events` first-party sin PII (tours), retención 13 meses. | No se usa ni se modifica. |
| **Tours 360°** | Módulo real (`tours/*`), editor `/crm/propiedades/[id]/tour`, demo pública. | Documentado en `knowledge/virtual-tours.md`; el copiloto enlaza al editor de la propiedad abierta. |
| **Logging / monitoreo** | `log.ts` JSON por línea con redacción de secretos/PII; Sentry opcional; `/api/health`, `/api/ready`. | Logs `ai.*` estructurados; `redact()` reutilizado para minimizar PII antes del modelo. |
| **CI / Vercel** | GitHub Actions: secretos, lint, migraciones dos veces, `db:codegen:verify`, typecheck, tests, build, `pnpm audit`. Vercel `gru1`, cron cada minuto. | Sin cambios en CI. `next.config.ts` agrega `outputFileTracingIncludes` para que el cron lea `knowledge/`. |
| **Variables de entorno** | Ver `.env.example`: núcleo (`DATABASE_URL`, `APP_URL`, `APP_ENV`, `CRON_SECRET`…), storage, Resend, WhatsApp, Meta, `ANTHROPIC_API_KEY` + `AI_MODEL` (WhatsApp), portales, cifrado, Sentry, subida. | No se agrega ninguna variable: solo `ANTHROPIC_API_KEY` (ya existente). Modelos del copiloto por `settings`. |
| **E2E** | Playwright contra `next start` con base aislada copiada (`scripts/e2e.sh`), desktop 1440 + mobile 390, axe. | `tests/e2e/copilot.spec.ts`; `scripts/e2e.sh` ingiere la guía. |

## Hallazgos de la auditoría que afectan a la IA

- No hay `ANTHROPIC_API_KEY` en ningún entorno: todo lo que requiere modelo degrada con estado honesto.
- No existe pantalla de settings (`settings.manage` definido pero sin uso): el ruteo de modelos y límites se cambian en
  la base; la página de uso los muestra en solo lectura.
- `tasks` y `appointments` no tienen `organization_id`: el aislamiento se resuelve por el usuario responsable/autor.
- Inconsistencias del CRM detectadas al escribir la guía (no corregidas en esta fase, fuera de alcance): etiquetas de
  estado de portales distintas entre pantallas, `branchIds` sin uso, `notifyRole("administrador")` no incluye a
  Dirección, eventos perdidos al desactivar una automatización, renovar un contrato finalizado sin UI, entre otras.
  Detalle en el informe de entrega de la Fase 1.
