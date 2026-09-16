#!/usr/bin/env bash
# E2E completos contra un build de producción y una base AISLADA copiada de la de desarrollo (con el inventario importado).
# Uso: scripts/e2e.sh   (requiere Postgres local, pnpm build previo, y el admin de desarrollo en llf_dev)
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL=postgres://localhost:5432/llf_e2e
export APP_URL=http://localhost:3106 APP_ENV=development
export CRON_SECRET=${CRON_SECRET:-e2e-cron-secret-0123456789abcdef0123456789}
export WHATSAPP_APP_SECRET=${WHATSAPP_APP_SECRET:-e2e-wa-app-secret} WHATSAPP_VERIFY_TOKEN=${WHATSAPP_VERIFY_TOKEN:-e2e-verify}
export UPLOAD_SIGNING_SECRET=${UPLOAD_SIGNING_SECRET:-e2e-upload-secret-0123456789abcdef0123456789}
lsof -ti tcp:3106 | xargs -r kill 2>/dev/null || true
psql -qd postgres -c "drop database if exists llf_e2e with (force)" -c "create database llf_e2e template ${E2E_TEMPLATE_DB:-llf_dev}"
pnpm db:migrate >/dev/null
pnpm exec playwright test "$@"
