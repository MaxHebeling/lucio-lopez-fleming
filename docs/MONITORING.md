# Monitoreo y alertas

| Señal | Fuente | Alerta |
| --- | --- | --- |
| Vida del proceso | `GET /api/health` | monitor externo (Better Stack / UptimeRobot) cada 1 min → 2 fallas seguidas |
| Base y cola | `GET /api/ready` (con `Authorization: Bearer $HEALTH_TOKEN` trae cron, jobs 24 h, jobs muertos 24 h por tipo, backlog de la cola, eventos pendientes más viejos, integraciones) | 503 → alerta; jobs `dead` > 0 → aviso |
| Cron | `settings['cron.last_run_at']` (lo escribe cada corrida de `/api/cron/jobs`) | en producción `/api/ready` → 503 si supera `CRON_STALE_MINUTES` (10) |
| Errores de servidor | `src/instrumentation.ts` → log estructurado + Sentry (`SENTRY_DSN`) | nuevo issue en Sentry |
| Jobs muertos | runner → notificación in-app a administración + log `job.dead` | inmediato |
| Integraciones | `callIntegration` → `integration_logs`, circuit breaker, evento `integration.failed` al superar el umbral | notificación a administración |
| Automatizaciones | `automation_runs` (vista `automation_errors`) | CRM → Automatizaciones |
| Migración | `migration_runs`, `migration_warnings` | CRM → Migración |
| Logs | Vercel Runtime Logs (JSON por línea, con `requestId`, sin secretos ni PII) | búsquedas por `msg` |
| Auditoría | `audit_logs` (append-only) | CRM → Auditoría |

Mensajes de log clave: `api.failed`, `action.failed`, `request.unhandled_error`, `job.dead`, `job.retry`,
`integration.call_failed`, `cron.jobs_failed`, `migration.import_failed`, `db.pool_error`.

Pendiente de activar (acción externa): proyecto Sentry + `SENTRY_DSN`; monitor de uptime sobre `/api/health` y `/api/ready`.
