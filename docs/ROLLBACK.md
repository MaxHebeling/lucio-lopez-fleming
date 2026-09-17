# Rollback

## Código (minutos)

1. Vercel → Deployments → último deployment sano → **Promote to Production** (o `vercel rollback <url>`), o
   `git revert <commit>` + merge (queda trazado en la historia).
2. `scripts/smoke.sh https://<dominio>`.
3. Registrar en el incidente qué versión quedó activa.

Como las migraciones son aditivas (expand/contract), volver a la versión anterior del código no requiere tocar la base.

## Base de datos

- **Nunca** editar ni borrar migraciones aplicadas. Para deshacer un cambio de esquema: nueva migración inversa.
- Corrupción o borrado de datos: restaurar backup en una base nueva (`scripts/restore-drill.sh` muestra el procedimiento),
  validar, y apuntar `DATABASE_URL` a la base restaurada; o copiar solo las filas afectadas desde la restaurada.
  Datos financieros (pagos, liquidaciones) nunca se borran: se anulan con motivo.

## Funcionalidad sin redeploy

Feature flags (CRM → Integraciones): apagar `whatsapp_ai_bot`, `portal_sync`, `social_publishing`, `outbound_email`,
`outbound_whatsapp`, `public_lead_capture`, `owner_portal`, `media_copy` corta el comportamiento en ≤ 15 s.

## Last known good

La última etiqueta `v*` con smoke verde. `git tag --sort=-creatordate | head` y comparar con el commit desplegado
(`/api/health` devuelve `commit`).
