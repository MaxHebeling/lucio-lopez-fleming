# Convenciones de código

Guía corta para cualquiera que toque este repo (personas o agentes). Si algo acá contradice el código, manda el código: corregí este archivo.

## Capas

```
src/app/            UI y rutas (Next 16, App Router). Sin SQL ni reglas de negocio.
  (site)/           sitio público (experiencia de marca)
  crm/              CRM operativo (equipo)
  propietarios/     portal privado de propietarios
  api/              route handlers (webhooks, cron, health, API v1)
src/server/         dominio y servicios. Todo acceso a datos y toda autorización vive acá.
  db/               cliente Kysely + tipos generados (pnpm db:codegen, versionados)
  auth/             sesiones, contraseñas, Actor y permisos
  <módulo>/         service.ts (mutaciones), queries.ts (lecturas), schema.ts (zod)
  jobs/             cola durable, runner, tareas periódicas, registro de handlers
  automation/       motor TRIGGER → CONDITIONS → ACTIONS sobre el outbox
  integrations/     adaptadores externos (WhatsApp, IA, portales, email, Meta, BCRA)
db/migrations/      SQL numerado e inmutable (una vez aplicado no se edita: se crea otro)
tests/unit          lógica pura
tests/integration   servicios contra Postgres real (base llf_test recreada por corrida)
tests/e2e           Playwright
```

## Reglas de servicio (no negociables)

1. **Toda función de servicio recibe `(db, actor, input)`** y lo primero que hace es `requirePermission(actor, "<permiso>")`.
   Ocultar un botón no es seguridad.
2. **Validar la entrada con zod** dentro del servicio (no confiar en la UI).
3. **Mutaciones en transacción**, con `forUpdate()` cuando se lee para modificar.
4. **Auditar** cada operación sensible con `audit(trx, actor, { action, entityType, entityId, before, after })` en la misma transacción.
5. **Emitir evento de dominio** con `emitEvent(trx, ...)` en la misma transacción cuando otros módulos deban reaccionar.
   Nunca llamar a servicios externos dentro de la transacción: se encola un job.
6. **Idempotencia**: todo lo que pueda repetirse (webhooks, jobs, reintentos, dobles clics) usa `dedupe_key`/`idempotency_key` + `on conflict do nothing`.
7. **Errores**: lanzar `AppError` (mensaje seguro para el usuario). Cualquier otro error se muestra genérico y se loguea.
   Prohibido `catch {}` vacío: o se maneja, o se loguea con `log.error`, o se relanza.
8. **Datos privados** (documentos, DNI, teléfonos privados, notas, contratos, montos) nunca salen en DTO públicos.
   Las consultas públicas seleccionan columnas explícitas, nunca `selectAll()`.
9. **Integraciones externas**: `callIntegration()` (circuit breaker + integration_logs) + `withTimeout` + `retry` solo para errores reintentables.
   Sin credenciales → estado `awaiting_credentials`, nunca una respuesta simulada.
10. **Nada inventado**: ni métricas, ni testimonios, ni precios, ni integraciones falsas, ni botones sin función.

## Server Actions y API

- Server Actions: `runAction(nombre, schema, input, (data, actor) => servicio(...))` devuelve `{ ok, data | error, fieldErrors }`.
- Route handlers: `apiRoute(nombre, handler)` agrega request id, errores seguros y logging.
- Páginas del CRM: `const actor = await requireStaffPage("permiso")`. Portal: `requireOwnerPage()`.

## Migraciones

- Numeración por bloque para evitar choques entre ramas: núcleo `0001–0099`, CRM `0100–0199`, alquileres/portal `0200–0299`,
  integraciones `0300–0399`, sitio público `0400–0499`.
- Tras crear una migración: `pnpm db:migrate && pnpm db:codegen` y versionar `src/server/db/generated.ts`.
- `db/_post_migrate.sql` corre siempre: activa RLS y revoca a `anon`/`authenticated` (Supabase).

## Jobs y automatizaciones

- Registrar handlers con `registerJobHandler("modulo.accion", handler)` e importarlos en `src/server/jobs/handlers.ts`.
- Tareas periódicas: `addScheduledTask({ type, every })`.
- Acciones de automatización: `registerAction("tipo", handler)`; deben ser idempotentes usando `ctx.dedupeBase`.

## UI

- **Sitio público**: experiencia editorial de marca (ver docs/WEB_EXPERIENCE.md). Movimiento solo con `transform`/`opacity`,
  contenido visible sin JS, `prefers-reduced-motion` respetado.
- **CRM**: operativo, no cinematográfico. Tablas, filtros, formularios claros, estados vacíos/carga/error, usable en celular.
- Copy en español rioplatense (vos: "buscá", "contactanos").
- Tokens en `src/app/globals.css` (`bg-paper`, `text-ink`, `text-brick`, `font-display`...). No inventar colores sueltos.

## Comandos

```
pnpm dev                 desarrollo
pnpm db:recreate         (solo local) borra y recrea la base de .env.local
pnpm db:migrate          aplica migraciones
pnpm db:codegen          regenera tipos
pnpm test                unit + integración (requiere Postgres local)
pnpm lint && pnpm typecheck && pnpm build
pnpm jobs:run [--loop]   worker local
```
