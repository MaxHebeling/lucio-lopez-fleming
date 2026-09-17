#!/usr/bin/env bash
# E2E completos contra un build de producción y una base AISLADA copiada de la de desarrollo (con el inventario importado).
# Uso: scripts/e2e.sh   (requiere Postgres local, pnpm build previo, y el admin de desarrollo en llf_dev)
set -euo pipefail
cd "$(dirname "$0")/.."
# E2E_PORT y E2E_DB permiten correr en paralelo desde otro worktree (por defecto 3106 y llf_e2e).
E2E_PORT=${E2E_PORT:-3106}
E2E_DB=${E2E_DB:-llf_e2e}
export E2E_PORT
export DATABASE_URL=postgres://localhost:5432/${E2E_DB}
export APP_URL=http://localhost:${E2E_PORT} APP_ENV=development
export CRON_SECRET=${CRON_SECRET:-e2e-cron-secret-0123456789abcdef0123456789}
export WHATSAPP_APP_SECRET=${WHATSAPP_APP_SECRET:-e2e-wa-app-secret} WHATSAPP_VERIFY_TOKEN=${WHATSAPP_VERIFY_TOKEN:-e2e-verify}
export UPLOAD_SIGNING_SECRET=${UPLOAD_SIGNING_SECRET:-e2e-upload-secret-0123456789abcdef0123456789}
lsof -ti tcp:${E2E_PORT} | xargs -r kill 2>/dev/null || true
psql -qd postgres -c "drop database if exists ${E2E_DB} with (force)" -c "create database ${E2E_DB} template ${E2E_TEMPLATE_DB:-llf_dev}"
# La caché de datos del sitio (unstable_cache) persiste en .next/cache entre corridas: se descarta para que el sitio lea
# la base recién copiada y no datos de una corrida anterior.
rm -rf .next/cache/fetch-cache
pnpm db:migrate >/dev/null
# Guía del CRM para el «✦ Asistente IA» (idempotente): la necesita tests/e2e/copilot.spec.ts.
pnpm ai:knowledge:ingest >/dev/null
# Demo del tour 360° (idempotente): la necesitan tests/e2e/tour*.spec.ts.
pnpm seed:demo-tour >/dev/null 2>&1
pnpm exec playwright test "$@"
