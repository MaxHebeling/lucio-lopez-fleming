# Confiabilidad

| Momento | Reliability Score | Detalle |
| --- | --- | --- |
| Inicio (2026-09-16) | **16/100** | docs/audit/INITIAL_AUDIT.md |
| Entrega del código (2026-09-16) | **72/100** | docs/audit/FINAL_AUDIT.md |
| Primer despliegue a producción (2026-09-17) | **78/100** | producción en Vercel (gru1) + Supabase (sa-east-1), `main` protegida con CI, smoke 14/14, cron activo, tag `v2026.09.17-1` |
| Esperado con acciones externas completas | ~87/100 | staging, backup activo con simulacro real, Sentry + uptime, claves S3 y versionado del bucket |

## Garantías implementadas

- **Ninguna consulta se pierde**: captura idempotente con contacto único; evento en la misma transacción; avisos y tareas
  por automatización con dedupe; formularios que conservan lo escrito ante errores.
- **Nada se duplica**: claves de idempotencia en leads, cobros, webhooks, jobs, mensajes y publicaciones; efectos
  externos inciertos nunca se reintentan solos.
- **Nada se corrompe en silencio**: constraints y exclusiones en la base; auditoría inmutable; pagos anulables y nunca
  borrados; ajustes aplicados inmutables; migración con advertencias en lugar de correcciones.
- **Todo falla visible**: jobs muertos notifican; integraciones con circuit breaker, estados y alertas; `/api/ready`
  con heartbeat del cron; logs estructurados con request id; Sentry listo.
- **Todo se recupera**: backup cifrado nocturno con simulacro de restore; rollback de código por Vercel; flags sin redeploy.

## Producción (2026-09-17)

| Pieza | Estado |
| --- | --- |
| Sitio | https://lucio-lopez-fleming.vercel.app (APP_ENV=staging → noindex hasta el cambio de DNS) |
| Vercel | equipo iKingdom Clients (Pro), proyecto `lucio-lopez-fleming`, región `gru1`, deploy desde `main` |
| Base | Supabase `lucio-lopez-fleming` (ref `szilqjstgpueoxxbakhl`, sa-east-1, org MAX), 24 migraciones, RLS deny-all, `anon` sin acceso |
| Storage | buckets `llf-public` / `llf-private` creados; faltan claves S3 |
| Datos | 366 propiedades importadas (355 publicadas, 11 en revisión), 11 agentes sin acceso, 1 super_admin invitado |
| Last known good | `v2026.09.17-1` |

## Pendientes para subir el puntaje

1. Staging (proyecto Supabase aparte) para validar cambios antes de producción.
2. Secretos de GitHub `PROD_DATABASE_URL` (pooler modo sesión) y `BACKUP_AGE_RECIPIENT` → primer backup y simulacro reales.
3. `SENTRY_DSN` y monitor de uptime sobre `/api/health` y `/api/ready`.
4. Claves S3 de Supabase Storage (`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`) y versionado/backup del storage.
5. Al cambiar el DNS: `APP_ENV=production`, `APP_URL=https://www.luciolopezfleming.com.ar`.
