# Despliegue

## Flujo

```
rama feat/* → PR → CI verde (lint, migraciones, tipos, tests, build, secretos, auditoría) → merge a main
   → Vercel despliega Production desde main → migraciones → smoke → tag de release
```

- `main` protegida: sin push directo, CI obligatorio, revisión.
- Cada PR obtiene un Preview de Vercel (usa la base de **staging**, nunca la de producción).
- Releases etiquetadas `vYYYY.MM.DD-N`; la última etiqueta con smoke verde es el **last known good** (ver ROLLBACK.md).

## Pasos de un despliegue a producción

1. Backup previo si hay migraciones: `DATABASE_URL=<prod> scripts/backup.sh` (o correr el workflow "Backup nocturno" a mano).
2. Migraciones **antes** de que el código nuevo reciba tráfico: `DATABASE_URL=<prod> DATABASE_SSL=require pnpm db:migrate`.
   Si cambió `knowledge/` (guía del Asistente IA): `DATABASE_URL=<prod> DATABASE_SSL=require pnpm ai:knowledge:ingest`
   (idempotente; si se omite, el job diario `ai.knowledge_ingest` la actualiza).
   Las migraciones son aditivas y compatibles hacia atrás (expand → migrate → contract en PRs separados), de modo que
   el código anterior sigue funcionando si hay que volver atrás.
3. Merge a `main` → Vercel construye y publica.
4. Smoke: `scripts/smoke.sh https://<dominio> $HEALTH_TOKEN` (debe salir 0).
5. Etiquetar: `git tag v2026.09.20-1 && git push --tags`.

## Primer despliegue (una sola vez)

1. Crear Postgres de producción y de staging (Supabase/Neon; ver decisiones pendientes) → `pnpm db:migrate` en ambas.
2. `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed` (administrador inicial) o `pnpm user:invite`.
3. Crear buckets público y privado en el storage S3 compatible → variables `STORAGE_*`.
4. Vercel: importar repo, variables por entorno, verificar Cron (`vercel.json`: cada minuto requiere plan Pro; en Hobby
   solo diario → los avisos y automatizaciones tardarían hasta 24 h).
5. Importar inventario: `pnpm import:adinco --verify-media` contra staging, revisar advertencias, luego producción.
6. Dominio: agregar `www.luciolopezfleming.com.ar` en Vercel; cambiar DNS **solo** con la inmobiliaria presente y con el
   sitio nuevo validado (las URLs antiguas `/luciolopez-{código}` redirigen 301).
