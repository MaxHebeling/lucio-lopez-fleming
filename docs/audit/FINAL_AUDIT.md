# Auditoría final 360° — 2026-09-16

Rama auditada: `feat/lucio-platform` (PR #1). Método: tres auditorías independientes en modo solo lectura
(seguridad/atacante, confiabilidad/SRE, performance-SEO-accesibilidad-QA) con evidencia reproducible, corrección en
cuatro frentes con test de regresión por hallazgo, integración y re-verificación completa.

## 1. Verificación final (comandos reales)

| Verificación | Resultado |
| --- | --- |
| `pnpm lint` | 0 errores, 0 avisos |
| `pnpm typecheck` | OK |
| `pnpm test` (unit + integración contra Postgres 17 real) | **47 archivos, 378 tests, 378 OK** |
| `bash scripts/e2e.sh` (Playwright, build de producción, base aislada con inventario real) | **19/19** (desktop + mobile, axe incluido) |
| `pnpm build` | OK |
| `pnpm db:codegen:verify` | tipos al día con las migraciones |
| `bash scripts/check-secrets.sh` | sin secretos |
| `pnpm audit --prod --audit-level high` | sin vulnerabilidades |
| `scripts/smoke.sh` contra build de producción | 13/13 |
| CI GitHub Actions (PR #1) | verde (3 m 38 s) |
| Simulacro de restore (dump Postgres plano y dump estilo Supabase) | OK ambos |

## 2. Hallazgos de las auditorías y estado

### Confiabilidad (25 hallazgos: 4 críticos, 6 altos, 7 medios, 8 bajos)

| Hallazgo | Estado |
| --- | --- |
| Worker marcaba fallido un job por timeout mientras seguía corriendo → efectos duplicados (demostrado) | **Corregido**: jobs de a uno si su timeout entra en el presupuesto; timeout no reintenta, completa si termina; lease perdido registrado |
| Recordatorios de alquiler e informes a propietarios fallaban siempre (payload ≠ plantilla) | **Corregido** + test que renderiza lo realmente encolado |
| Mensajes/avisos externos duplicados ante timeout tras aceptación (WhatsApp, Mercado Libre, Meta) | **Corregido**: POST no idempotentes sin reintento; resultado incierto → verificación manual; ML busca por referencia antes de crear; Meta consulta el contenedor |
| Backup nocturno nunca se guardaba con Supabase (demostrado) | **Corregido**: drill detecta esquema `extensions`; backup cifrado se sube antes del simulacro |
| IA de WhatsApp podía no responder ni derivar | **Corregido**: turno acotado + derivación por `onDead` |
| Carrera liquidación vs anulación de cobro (demostrada) | **Corregido**: mismo orden de locks |
| Importador despublicaba ignorando decisiones humanas y sin propagar a portales | **Corregido** |
| Portal: aviso activo tras despublicar / `syncing` trabado | **Corregido** (lock propio + relectura de estado deseado + recupero de `syncing` vencido) |
| Refresh token rotativo de ML perdido por timeout | **Corregido** |
| Jobs muertos por lease sin aviso; readiness ciego al cron | **Corregido** (aviso + `onDead`; heartbeat del cron → 503) |
| Circuit breaker abierto por errores de datos | **Corregido** |
| Tareas diarias a las 21:00 de Salta | **Corregido** (fecha de Salta, desde 06:00) |
| Segunda conexión dentro de transacción (pool) | **Corregido** |
| Pool en Vercel / pooler | **Corregido** (`attachDatabasePool`, idle 5 s, `MIGRATION_DATABASE_URL`) |
| Borradores de redes sin fotos tras reintento; fallback de ajustes; informe trabado; alerta de integración única; índices faltantes; retención | **Corregidos** |
| Backup no cubre archivos del storage | **Riesgo residual** (ver §4) |
| Republicar el mismo día fuera del CRM no emite `property.published` (dedupe diario) | **Riesgo residual bajo**: portales se sincronizan por la reanudación horaria; el sitio por caché ≤ 5 min |

### Seguridad (2 altos, 5 medios, 12 bajos)

| Hallazgo | Estado |
| --- | --- |
| Agentes importados sin contraseña podían tomar la cuenta por "olvidé mi contraseña" | **Corregido** (staff y propietarios) + tiempos constantes |
| Captura anónima contaminaba contactos existentes (vía a invitación al portal de otra persona) | **Corregido**: datos no verificados quedan en el lead; invitación exige email explícito |
| Búsqueda pública revelaba altura oculta; ML y portales sin API recibían la altura | **Corregido** |
| Sin forma de cortar acceso de un propietario | **Corregido** (desactivar / cambiar email, revoca sesiones) |
| Cualquier agente podía asignarse como agente principal | **Corregido** (permiso `properties.assign_agents`) |
| Conversaciones sin alcance propio; `must_change_password` solo en páginas; IP por `X-Forwarded-For`; fotos borradas públicas; subida directa sin tope previo; PDF de informe antes de enviarse; tokens en payload tras fallo | **Corregidos** |
| CSP con `script-src 'unsafe-inline'` (sin nonce) | **Riesgo residual** aceptado (Next sin nonce; mitigado por ausencia de HTML de usuarios sin escapar) |
| Bloqueo de cuenta tras 5 intentos permite bloquear cuentas ajenas | **Riesgo aceptado** (compromiso estándar contra fuerza bruta) |
| Fotos de propiedades no publicadas en bucket público (URL UUID no adivinable) | **Riesgo aceptado documentado** |

### Performance, SEO, accesibilidad y QA (2 altos, 12 medios, 14 bajos)

| Hallazgo | Estado |
| --- | --- |
| Formularios perdían lo escrito ante rechazo del servidor (lead perdido) | **Corregido** + E2E |
| Lista de propiedades del CRM bajaba 8,7 MB de originales | **Corregido**: 8.972 → 45 KiB |
| Sitio público sin caché | **Corregido**: caché con etiquetas + invalidación inmediata desde CRM y eventos |
| Consultas repetidas en home; facetas con resultados 0; titulares repetidos; SEO de listados filtrados; galería y pipeline con foco roto; contraste; tablas no enfocables; redirects 302; robots | **Corregidos** (0 violaciones axe en CRM, logins y sitio; 355/355 fichas con título único; 0 títulos > 60) |
| LCP del listado en mobile ~3,4 s (simulación 4G lento + CPU 4×) | **Pendiente**: limitado por hidratación de JS; desktop 0,7 s |
| Fotos del hero de 1024 px (origen Adinco) | **Pendiente de material**: pedir originales en alta a la inmobiliaria |
| Textos legales provisorios publicados | **Decisión de la inmobiliaria** (revisión legal) |

Lighthouse final (mediana de 3, build local): home 93/100/100/100 mobile · 100/100/100/100 desktop; ficha 95 mobile ·
100 desktop; listado 91 mobile · 100 desktop (Performance/Accesibilidad/Buenas prácticas/SEO).

## 3. Reliability Score

Misma escala y dimensiones que la auditoría inicial (0–10 por dimensión). Se evalúa el sistema entregado: **código,
datos migrados, pruebas y operación preparada**. Lo que depende de acciones externas pendientes (base de producción,
deploy, secretos) no se cuenta como hecho.

| Dimensión | Inicial | Final | Motivo del puntaje final |
| --- | --- | --- | --- |
| Arquitectura / propiedad del sistema | 3 | 9 | monolito modular propio, documentado, sin lock-in |
| Dependencias | 3 | 8 | lockfile, versiones exactas, audit limpio |
| Testing | 0 | 8 | 378 tests contra Postgres real + 19 E2E; sin pruebas de carga |
| CI/CD | 0 | 6 | CI obligatorio verde; falta deploy automatizado, staging y protección de `main` |
| Seguridad | 4 | 8 | auditoría con hallazgos altos corregidos; residuales documentados |
| Base de datos / fuente de verdad | 3 | 9 | constraints, exclusiones, auditoría inmutable, migraciones verificadas |
| Backups | 1 | 5 | scripts + workflow cifrado listos y probados; no activados (sin base de producción) |
| Restore | 0 | 7 | simulacro automatizado probado (Postgres y estilo Supabase); no ejercitado en producción |
| Observabilidad | 2 | 6 | logs estructurados, health/ready con heartbeat, Sentry listo; faltan DSN y monitor de uptime |
| Rollback | 1 | 6 | documentado, flags sin redeploy, migraciones aditivas; no ejercitado |
| Configuración | 3 | 8 | variables documentadas, flags, estados de integración visibles |
| Documentación | 0 | 9 | arquitectura, base, operación, runbooks, integraciones, auditorías |
| Disaster recovery | 1 | 5 | plan y simulacros; storage sin copia verificada; no ejercitado |
| **Total** | **21/130 → 16/100** | **94/130 → 72/100** | |

Con las acciones externas de §5 completadas (base de producción + staging, deploy con protección de `main`, backup
activado y un simulacro real, Sentry + uptime, versionado del bucket) el puntaje esperado es **~87/100**.

## 4. Riesgos residuales (sin ocultar)

1. **No hay entorno de producción ni staging**: nada está desplegado. Todo lo verificado corre local y en CI.
2. **Integraciones sin credenciales**: WhatsApp, Claude, Resend, Meta, Mercado Libre y storage S3 están construidos y
   probados con dobles, en `awaiting_credentials`. Su primer uso real puede revelar diferencias de contrato con el proveedor.
3. **Argenprop y Zonaprop** no tienen API pública: requieren acuerdo comercial (Argenprop da de baja los avisos activos al habilitarla).
4. **Fotos** servidas desde el CDN de Adinco hasta copiarlas a storage propio; ese CDN bloquea ráfagas por IP.
5. **Backup del storage** (fotos/documentos) depende del versionado del bucket del proveedor: no hay copia propia verificada.
6. **Datos migrados**: 11 fichas en revisión (precios por hectárea, precio implausible, superficie absurda); ubicaciones
   genéricas "Salta" en 275 fichas; propietarios, consultas históricas y contratos **no** están en el sitio público de
   Adinco y no se migraron.
7. **Cron cada minuto requiere Vercel Pro**; en Hobby los avisos y automatizaciones tardarían hasta 24 h.
8. **LCP mobile del listado** ~3,4 s en simulación lenta.
9. **Textos a confirmar** con la inmobiliaria (servicios, legales, claims históricos) antes de lanzar.
10. **Tiles de OpenStreetMap**: su política no admite tráfico comercial intenso; migrar a proveedor propio si crece.

## 5. Acciones externas y decisiones requeridas

Ver el informe de entrega (resumen en `docs/RELIABILITY.md`).
