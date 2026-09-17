# Confiabilidad

| Momento | Reliability Score | Detalle |
| --- | --- | --- |
| Inicio (2026-09-16) | **16/100** | docs/audit/INITIAL_AUDIT.md |
| Entrega del código (2026-09-16) | **72/100** | docs/audit/FINAL_AUDIT.md |
| Esperado con acciones externas completas | ~87/100 | producción + staging, deploy protegido, backup activo con simulacro real, Sentry + uptime, versionado del bucket |

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

## Pendientes para subir el puntaje

1. Base de producción y staging separadas; migraciones con `MIGRATION_DATABASE_URL`.
2. Proyecto en Vercel (Pro por el cron de 1 minuto) con variables por entorno; `main` protegida con CI obligatorio.
3. Secretos `PROD_DATABASE_URL` y `BACKUP_AGE_RECIPIENT` → primer backup y simulacro reales.
4. `SENTRY_DSN` y monitor de uptime sobre `/api/health` y `/api/ready`.
5. Versionado activado en los buckets S3.
6. Primer despliegue → smoke → tag de release (last known good).
