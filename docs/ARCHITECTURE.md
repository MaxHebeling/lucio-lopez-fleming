# Arquitectura

## Visión

Una sola aplicación Next.js 16 (App Router) sobre PostgreSQL. Tres superficies y un núcleo de dominio compartido:

```
                ┌────────────── Next.js 16 (Vercel) ──────────────┐
 Visitantes ───▶│ (site)        sitio público de marca, buscador   │
 Equipo     ───▶│ /crm          CRM operativo                      │
 Propietarios ─▶│ /propietarios portal privado                     │
 Meta/Portales ▶│ /api/webhooks · /api/cron · /api/health|ready    │
                │                     │                            │
                │            src/server (dominio)                  │
                │  auth · rbac · servicios · auditoría · outbox    │
                │  jobs · automatizaciones · integraciones         │
                └─────────────────────┼────────────────────────────┘
                                      ▼
                  PostgreSQL (fuente de verdad) + Object storage (S3)
                                      │
            Adaptadores con circuit breaker: WhatsApp Cloud API, Claude,
            Resend, Meta Graph, Mercado Libre, Argenprop, Zonaprop, BCRA
```

**Por qué un monolito modular y no microservicios**: una inmobiliaria con un equipo chico necesita algo que se pueda
mantener, desplegar y recuperar sin fricción. Las fronteras están en el código (`src/server/<módulo>`), no en la red.

## Decisiones clave

| Decisión | Motivo |
| --- | --- |
| Postgres como única fuente de verdad (también cola de jobs y outbox) | una sola cosa que respaldar, restaurar y observar; transacciones reales entre el cambio y su evento |
| Kysely + SQL plano en migraciones | constraints, exclusiones y triggers expresados en la base (difíciles de romper desde la app); tipos generados |
| Auth propia (argon2id + sesiones hasheadas) | portable a cualquier Postgres (Supabase, Neon, RDS); sin dependencia de un proveedor de identidad |
| Autorización en servicios (`requirePermission`) + filtros por actor en queries | ocultar botones no es seguridad; el portal filtra por `contactId` del actor |
| Outbox (`domain_events`) + cola (`jobs`) | un cambio de negocio nunca se pierde aunque falle el aviso, el portal o la IA; reintentos y dead-letter visibles |
| Adaptadores con `callIntegration` | timeout, reintentos, circuit breaker persistido, logs por integración y alerta por umbral |
| Feature flags en base | activar/desactivar integraciones y comportamientos sin redeploy |

## Flujos

**Propiedad**: CRM → `properties/service.ts` (transacción + historial + auditoría + evento) → web (lectura directa) →
automatización `property_portal_sync` → job `portals.sync` → portal. Si el portal falla, el dato del CRM queda y la
publicación pasa a `failed/retrying` con reintento.

**Lead**: web/WhatsApp/portal/manual → `leads/capture.ts` (contacto único por email/teléfono normalizado, idempotencia)
→ evento `lead.created` → automatización (aviso + tarea de primer contacto).

**Alquiler**: contrato → obligaciones mensuales → cobros (idempotentes, anulables, nunca borrados) → ajustes por índice
(propuestos, aplicados por una persona) → liquidación al propietario → portal e informe.

**Migración**: sitio anterior (Adinco) → importador idempotente con advertencias → revisión humana → CRM como fuente de verdad.

## Ejecución asíncrona

`/api/cron/jobs` (Vercel Cron, cada minuto) → encola tareas periódicas con dedupe por período → despacha eventos
pendientes a automatizaciones → procesa jobs con lease (`FOR UPDATE SKIP LOCKED`) dentro de un presupuesto de 45 s.
Jobs fallidos reintentan con backoff exponencial + jitter; al agotar intentos pasan a `dead` y avisan a administración.

## Seguridad en capas

1. Headers (CSP, HSTS, frame-ancestors none, nosniff), `X-Robots-Tag: noindex` en CRM y portal.
2. Sesión httpOnly/SameSite=Lax, rotación y revocación; lockout por usuario y rate limit por IP.
3. Permisos en cada servicio y página; tests de IDOR y aislamiento entre propietarios.
4. Base: constraints, exclusiones, triggers de inmutabilidad; RLS deny-all y revoke a `anon`/`authenticated` (si es Supabase).
5. Archivos privados solo por URL firmada o ruta autorizada; validación de firma real de archivos subidos.
6. Secretos solo en variables de entorno; logger con redacción; errores públicos sin SQL ni stack.
