# Lucio López Fleming — Plataforma digital

Sistema operativo digital de **Lucio López Fleming Inmobiliaria** (Salta, desde 1974): sitio público de marca, CRM
inmobiliario, alquileres y liquidaciones, portal de propietarios, captura multicanal con WhatsApp + IA, portales,
motor de contenido y automatizaciones — sobre una sola base de datos que es la fuente de verdad.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL + Kysely (migraciones SQL) · auth propia
(argon2id) · cola de jobs y outbox en Postgres · Vercel · S3 compatible · Vitest + Playwright · GitHub Actions.

## Empezar

```bash
pnpm install
createdb llf_dev                                   # Postgres 15+ local
cp .env.example .env.local                         # completar DATABASE_URL, TEST_DATABASE_URL
pnpm db:migrate
SEED_ADMIN_EMAIL=vos@ejemplo.com SEED_ADMIN_PASSWORD='algo-largo-2026' pnpm db:seed
pnpm import:adinco --limit 20                      # opcional: inventario real del sitio anterior
pnpm dev                                           # http://localhost:3000 · CRM en /crm
pnpm jobs:run --loop                               # worker local (avisos, automatizaciones)
```

Verificación completa: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Documentación

| Tema | Archivo |
| --- | --- |
| Convenciones de código (leer primero) | docs/CONVENTIONS.md |
| Arquitectura | docs/ARCHITECTURE.md |
| Base de datos | docs/DATABASE.md |
| Experiencia web y dirección creativa | docs/WEB_EXPERIENCE.md |
| Migración desde Adinco | docs/MIGRATION.md |
| Entornos y variables | docs/ENVIRONMENT.md |
| Despliegue / rollback | docs/DEPLOYMENT.md · docs/ROLLBACK.md |
| Backups y restore | docs/BACKUP_RESTORE.md |
| Monitoreo / incidentes / runbook | docs/MONITORING.md · docs/INCIDENT_RESPONSE.md · docs/RUNBOOK.md |
| Seguridad | docs/SECURITY.md |
| Integraciones | docs/INTEGRATIONS.md · docs/INTEGRATIONS_WHATSAPP_AI.md |
| Auditorías y Reliability Score | docs/audit/ |
