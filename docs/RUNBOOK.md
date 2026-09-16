# Runbook operativo

| Síntoma | Diagnóstico | Acción |
| --- | --- | --- |
| `/api/ready` 503 | `database.error` en el JSON (con token) | verificar estado del proveedor de Postgres, `DATABASE_URL`/SSL, conexiones (pool `max` 3 en Vercel) |
| Leads web no llegan al CRM | flag `public_lead_capture`; logs `action.failed`; `rate_limit_buckets` | reactivar flag; revisar rate limit; el formulario muestra teléfono alternativo si está apagado |
| Avisos/tareas automáticas no aparecen | cron (`/api/cron/jobs` 200 en logs de Vercel), `domain_events` sin despachar, `jobs` en `failed/dead` | verificar `CRON_SECRET` y plan de Vercel; CRM → Sistema → Jobs → reintentar |
| Job en `dead` | `last_error` del job | corregir causa (credencial, dato) → reintentar desde el panel |
| Integración en `degraded`/`error` | CRM → Integraciones (logs), `circuit_open_until` | credenciales/cuotas del proveedor; el circuito se reabre solo a los 5 min |
| WhatsApp no responde | flags `whatsapp_ai_bot`/`outbound_whatsapp`, `webhook_events` con `signature_valid=false`, presupuesto IA diario | ver docs/INTEGRATIONS_WHATSAPP_AI.md |
| Portal no sincroniza | `property_publications.sync_status/last_error` | CRM → Portales → reintentar; `awaiting_credentials` = faltan credenciales |
| Importación con fallas | salida JSON (`failed`, `aborted`), `migration_records.error` | si `aborted` por bloqueo del origen: esperar y reintentar (es incremental) |
| Usuario bloqueado | `users.locked_until`, `login_attempts` | esperar 15 min o restablecer contraseña |
| Propietario ve datos ajenos (reporte) | Sev 1 | apagar `owner_portal`, preservar evidencia, revisar queries del portal y tests de aislamiento |

## Tareas periódicas del equipo técnico

- Semanal: revisar jobs muertos, integraciones degradadas, advertencias de migración abiertas.
- Mensual: `pnpm audit`, actualizar dependencias en PR aislado (test → build → staging → producción), simulacro de restore manual.
- Trimestral: rotar `CRON_SECRET`/`HEALTH_TOKEN`, revisar usuarios activos y roles.
