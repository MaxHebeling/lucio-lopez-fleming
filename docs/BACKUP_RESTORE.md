# Backups y restauración

| Qué | Cómo | Frecuencia | Retención | Cifrado |
| --- | --- | --- | --- | --- |
| Base (esquema public) | `scripts/backup.sh` (pg_dump custom) vía workflow "Backup nocturno" | diaria 03:15 (Salta) | 30 días (artefactos de GitHub) | `age` con clave pública en secreto `BACKUP_AGE_RECIPIENT` |
| Base (proveedor) | PITR / backups automáticos del proveedor de Postgres | continuo | según plan | del proveedor |
| Archivos | bucket S3 con versionado activado | continuo | 30 días de versiones | del proveedor |
| Código y migraciones | GitHub | cada commit | permanente | — |

## Simulacro de restauración (obligatorio)

Un backup no es confiable hasta que se restaura. El workflow nocturno **restaura cada backup en un Postgres efímero**,
corre las migraciones (deben ser no-op) y compara tablas, propiedades y triggers contra el manifiesto; si no coincide, falla.

Manual: `scripts/restore-drill.sh backups/llf-AAAAMMDDTHHMMSSZ.dump [postgres://admin/postgres]`.
Última prueba local (2026-09-16): 80/80 tablas, 366/366 propiedades, trigger de auditoría presente, 1 s.

## Restaurar producción

1. Declarar incidente (INCIDENT_RESPONSE.md). Poner `public_lead_capture` en off si hay riesgo de escribir sobre datos malos.
2. Descargar el artefacto, `age -d -i clave.txt backup.dump.age > backup.dump`.
3. Crear base nueva, restaurar como en el simulacro, validar conteos y una muestra de fichas.
4. Cambiar `DATABASE_URL` en Vercel → redeploy → smoke.
5. Datos creados entre el backup y el incidente: recuperar de la base anterior si sigue accesible.

**Activar**: generar par de claves `age-keygen -o llf-backup.key`; guardar la privada fuera de GitHub (gestor de
contraseñas de la dirección); cargar secretos `PROD_DATABASE_URL` y `BACKUP_AGE_RECIPIENT` en el repo.
