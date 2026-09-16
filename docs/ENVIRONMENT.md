# Entornos y variables

| Entorno | Dónde | Base | Uso |
| --- | --- | --- | --- |
| development | local (`pnpm dev`) | Postgres local `llf_dev` | desarrollo |
| test | local/CI | `llf_test` (se recrea en cada corrida) | tests de integración |
| staging | Vercel (entorno Preview con rama `staging` o proyecto separado) | Postgres propio de staging | QA, corridas de migración, demo |
| production | Vercel (Production) | Postgres de producción | clientes |

**Nunca** apuntar staging o desarrollo a la base de producción. `APP_ENV` (no `NODE_ENV`) decide indexación y comportamiento por entorno.

Variables: ver `.env.example` (cada una documentada). Reglas:

- Secretos solo en el gestor del entorno (Vercel → Settings → Environment Variables), nunca en el repo ni en logs.
- Al cargar con CLI usar `printf "%s" "$VALOR" | vercel env add NOMBRE production` (evita el salto de línea de `echo`).
- `CRON_SECRET` ≥ 32 caracteres aleatorios (`openssl rand -base64 48`).
- Integraciones sin credenciales quedan en `awaiting_credentials` (visible en CRM → Integraciones), no fallan en silencio.

Mínimo para que producción funcione: `DATABASE_URL`, `DATABASE_SSL`, `APP_URL`, `APP_ENV=production`, `CRON_SECRET`,
`STORAGE_*` (driver s3). Recomendado desde el día 1: `HEALTH_TOKEN`, `SENTRY_DSN`, `RESEND_API_KEY` + `EMAIL_FROM` +
`EMAIL_INTERNAL_TO` (sin email no llegan invitaciones ni recuperación de contraseña).
