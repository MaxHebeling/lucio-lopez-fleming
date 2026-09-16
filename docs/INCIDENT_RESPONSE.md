# Respuesta a incidentes

## Severidades

| Sev | Ejemplo | Respuesta |
| --- | --- | --- |
| 1 | sitio caído, datos corruptos, filtración, pagos duplicados | inmediata, todo el equipo técnico |
| 2 | CRM sin poder cargar leads, cron detenido, integración clave caída | < 2 h |
| 3 | un portal no sincroniza, error visual acotado | próximo día hábil |

## Pasos

1. **Detectar y declarar**: quién, qué se ve, desde cuándo (`/api/health`, `/api/ready`, Sentry, Vercel logs).
2. **Contener**: feature flag off (ROLLBACK.md), promover el deployment anterior, rotar credenciales si hubo exposición.
3. **Preservar evidencia**: requestId, logs, filas de `audit_logs`, `webhook_events`, `jobs`.
4. **Recuperar**: rollback de código; restauración de datos si hace falta (BACKUP_RESTORE.md); reintentar jobs desde CRM → Sistema → Jobs.
5. **Comunicar**: a la dirección de la inmobiliaria; si hubo datos personales comprometidos, evaluar obligaciones de la
   Ley 25.326 (Argentina) con su asesor legal.
6. **Post-mortem** (sin culpas) en 48 h: causa raíz, test de regresión que lo reproduce, acción preventiva.

## Filtración o credencial expuesta

Rotar en el proveedor → actualizar variable en Vercel → redeploy → revocar sesiones si aplica
(`update sessions set revoked_at = now() where revoked_at is null`) → revisar `audit_logs` e `integration_logs`.
