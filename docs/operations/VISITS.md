# Núcleo operativo de visitas

Portal del agente («Mis visitas»), máquina de estados de la visita, check-in geolocalizado con geofence, link temporal
premium para el cliente, informe post-visita, agradecimiento, seguimiento y centro operativo. Es la parte **no-LLM** de
la Fase 4: deja puntos de extensión para la IA (§11) pero no la implementa. Privacidad de ubicación:
[PRIVACY_LOCATION.md](./PRIVACY_LOCATION.md).

Principios: lo dirigen personas (nada se envía a clientes sin acción humana), sin rastreo de empleados, aditivo sobre la
Agenda existente y todo cambio de estado auditado, con timeline y evento de dominio en la misma transacción.

## Línea base (2026-09-17, rama `feat/visits-operations` sobre `main` @ 60de445)

Comandos existentes, sin cambios en el código, contra `llf_dev_ops` / `llf_test_ops`:

| Comando | Resultado | Duración |
| --- | --- | --- |
| `pnpm lint` | OK (0 errores, 0 avisos) | 8 s |
| `pnpm typecheck` | OK | 11 s |
| `pnpm db:codegen:verify` | OK (tipos al día) | 2 s |
| `pnpm test` | 50 archivos, 437 tests, 437 OK | 50 s |
| `pnpm build` | OK | 15 s |

## 1. Qué se reutilizó y qué es nuevo

| Reutilizado | Cómo |
| --- | --- |
| `appointments` (0004) | estados extendidos, marcas de tiempo nuevas; misma fila de principio a fin |
| Exclusión `appointments_no_overlap` | recreada incluyendo en camino / check-in / en curso; la reasignación la usa tal cual |
| `src/server/agenda/service.ts` | `rescheduleAppointment` para reasignar; `applyVisitCompleted` (extraído) para cerrar desde Agenda o portal |
| `tasks` + `createTask` | tarea de seguimiento con clave idempotente `visit-followup:<id>` y `appointments.follow_up_task_id` |
| Auditoría, outbox `domain_events`, jobs (`addScheduledTask`), notificaciones, flags, settings, rate limit | sin cambios de contrato; el scheduler suma el período `every_5_minutes` |
| `whatsappHref`, `telHref`, `publicStreet`, `publicMediaUrl`, `loadSiteInfo`, `crmImageSource`, `ContactButtons` | contacto autorizado, dirección oculta, fotos y llamadas/WhatsApp del agente |
| Tokens (`newToken`/`hashToken`) | token de 32 bytes base64url, en base solo SHA-256 |
| Automatización `visit_followup` | condición nueva: no crea la tarea automática cuando la visita se cierra desde el portal (`followUpMode = manual`) |

Nuevo: `src/server/visits/*`, `src/components/visits/*`, `/crm/mis-visitas`, `/crm/centro-operativo`, `/visita/[token]`,
`/api/visita/[token]`, migraciones 0180–0181.

## 2. Estados

```
PROGRAMADA (scheduled | confirmed) ──► EN CAMINO (en_route) ──► CHECK-IN (checked_in) ──► EN CURSO (in_progress) ──► FINALIZADA (completed)
        │   └──────────────► CHECK-IN (llegó sin marcar «salgo»)            │                    │
        ├──► CANCELADA (cancelled) ◄────────────────────────────────────────┴────────────────────┘
        └──► NO SE PRESENTÓ (no_show) ◄── en camino / check-in
```

- **Compatibilidad**: se conservan `scheduled/confirmed/completed/cancelled/no_show`; se agregan `en_route`, `checked_in`,
  `in_progress`. Las consultas existentes (agenda, tablero, informes a propietarios) se actualizaron para contarlos.
- **Reprogramada no es un estado**: la Agenda ya reprogramaba moviendo la misma fila (vuelve a `scheduled`). Crear una
  fila nueva rompería los vínculos (oportunidad, seguimiento, link del cliente). Queda como evento `rescheduled` del
  timeline (y `reassigned` si cambia el agente). Se puede reprogramar hasta «en camino»; después de llegar, no.
- **Validación doble**: función pura `src/server/visits/state.ts` (`canTransition`) + trigger
  `appointments_status_transition` con la misma matriz (una actualización SQL inválida falla con P0001).
- **Idempotencia**: repetir la transición al mismo estado devuelve `{ changed: false }`; una acción de un estado ya
  superado responde un conflicto claro («actualizá la pantalla»).
- **Presencia** (salgo, check-in, problema de ubicación, iniciar): solo el agente asignado, solo dentro de la franja
  (± `visits.checkin_window_minutes`). Finalizar, link, informe, seguimiento y agradecimiento: el agente o quien ve todas.

## 3. Check-in y geofence

1. «Confirmar llegada» abre un diálogo que explica el propósito (una lectura, sin seguimiento, el cliente no ve la
   ubicación, retención). Recién con «Usar mi ubicación» se llama `getCurrentPosition` (alta precisión, timeout 15 s,
   `maximumAge: 0`). No se usa `watchPosition`.
2. El servidor calcula la distancia haversine a `properties.latitude/longitude` y guarda un intento en
   `appointment_checkins` (máx. 3): agente, hora de servidor y de dispositivo, lat/lng/precisión, distancia, radio y tope
   usados, `verification_status` y motivo.
3. Reglas (`src/server/visits/geofence.ts`):
   - `verified` si `distancia ≤ radio + min(precisión, tope)`;
   - `needs_review / low_accuracy` si la precisión es peor que el tope;
   - `needs_review / outside_radius` si queda fuera;
   - `needs_review / property_without_coordinates` si la propiedad no tiene coordenadas (o tiene 0,0 importado).
4. **Fallback**: GPS denegado, sin señal, timeout o sin soporte → «Reportar problema de ubicación» (motivo + detalle,
   obligatorio en «otro») registra `no_location` sin coordenadas. Nunca bloquea: la visita pasa a check-in igual.
5. Con check-in no verificado se puede reintentar (hasta 3 intentos) o iniciar la visita; queda alerta para revisión.
6. UI: «Check-in verificado · aprox. 20 m de la propiedad» / «Check-in requiere revisión» + motivo / «Llegada registrada
   sin ubicación».

Configuración (`settings`): `visits.geofence_radius_m` (150), `visits.geofence_max_accuracy_m` (200),
`visits.checkin_window_minutes` (120), `visits.location_retention_days` (30).

## 4. Link temporal del cliente

- **Token**: 32 bytes aleatorios base64url (43 caracteres). En `appointment_public_links` solo el hash SHA-256; ni en
  auditoría, ni en eventos, ni en logs. Se muestra una vez al agente; si se pierde, se **rota** (el anterior deja de
  funcionar en el acto). Un solo link activo por visita (índice único parcial).
- **Ruta** `/visita/[token]`: `noindex, nofollow, noarchive`, `Cache-Control: private, no-store`, `Referrer-Policy:
  no-referrer` (el token no viaja a wa.me/tel), fuera del sitemap y `Disallow` en robots de producción.
- **Respuesta idéntica**: formato inválido, inexistente, revocado, rotado, vencido, rate limit o flags apagados → el
  mismo 404 «Este enlace no está disponible» (siempre se hace la búsqueda por hash).
- **Rate limit** por IP (clave con hash): 120 pedidos / 10 min (página + polling) y 20 fallos / hora; superado el de
  fallos, ni un token válido responde desde esa IP. Sin IP confiable la clave es compartida (×10).
- **Contenido**: nombre de pila, fecha y horario, estado, propiedad (título, portada, zona; calle solo si
  `hide_exact_address = false`), nombre y apellido del asesor, contacto autorizado (WhatsApp/teléfono del asesor solo si
  `users.public_profile`; si no, WhatsApp general `SITE_WHATSAPP_E164` y teléfono de la sede principal). No hay foto del
  asesor: `users` no tiene ese dato (no se inventa).
- **Tiempo real**: el proyecto no usa Supabase Realtime. Polling a `GET /api/visita/[token]` cada 12 s con `ETag` /
  `If-None-Match` (304 sin cuerpo), pausado con la pestaña oculta, backoff exponencial hasta 2 min. La respuesta solo
  trae la etapa y la hora de llegada confirmada.
- **Cierre**: finalizada, cancelada o no se presentó → sin estado en vivo; la página muestra la tarjeta «Esta visita ha
  finalizado. Gracias por confiar en Lucio López Fleming.» y, si una persona guardó el agradecimiento, el mensaje, el
  asesor y el contacto autorizado.
- **Expiración por tiempo**: `max(fin programado, fin real) + visits.client_link_grace_hours` (48 h), con tope absoluto
  `expires_at` = creación + 30 días (cubre reprogramaciones). El job `visits.links_expire` deja constancia
  (timeline + `client_link.expired`).
- **Aperturas**: `open_count`/`last_opened_at` una vez por minuto como máximo; los previsualizadores (WhatsApp, redes,
  bots) no cuentan. El primer «abrió el link» va al timeline.
- **Posición en vivo del agente**: **no implementada** a propósito (ver §11). Solo se comparte el estado.

## 5. Informe, agradecimiento y seguimiento

- **Informe** (`appointment_reports`): comentario escrito o dictado (Web Speech API del navegador como entrada de texto;
  la app no graba ni envía audio), interés bajo/medio/alto, aspectos positivos, objeciones, siguiente paso y fecha
  sugerida. Borrador o confirmado (autor, quién y cuándo confirmó). Editar uno confirmado lo vuelve a borrador. Al
  confirmar, si la cita no tenía `result`, se copia el comentario (la Agenda lo muestra).
- **Seguimiento**: sugerencia determinista alto → 24 h, medio o sin dato → 48 h, bajo → 7 días (redondeo a 5 min),
  editable. «Crear tarea de seguimiento» solo con informe confirmado y por acción humana; reutiliza `tasks`
  (tipo seguimiento, asignada al agente de la visita, vinculada a la cita) y completa `follow_up_task_id`.
- **Agradecimiento** (`appointment_thanks`): texto por plantilla (cliente, asesor, propiedad, empresa), editable. Acciones
  humanas: «Copiar mensaje», «Abrir WhatsApp con el mensaje» (`wa.me` con texto) y «Marcar como enviado» (timeline). No
  hay envío automático: `outbound_whatsapp`/`outbound_email` siguen apagados y sin credenciales.

## 6. Centro operativo (`/crm/centro-operativo`, permiso `visits.monitor`)

Tablero del día (navegación por fecha, filtro por agente): conteos por etapa + incidencias, alertas abiertas (ordenadas
por severidad), tabla con agente, propiedad, cliente, estado, llegada (verificación, distancia, horarios de salida y
llegada), cierre (informe/seguimiento) y acciones «Ver» (detalle con timeline) y «Reasignar» (hasta «en camino»; valida
superposición con la exclusión existente, vuelve a «Programada» y avisa al nuevo agente).

### Alertas (job `visits.alerts`, cada 5 minutos)

| Tipo | Condición | Severidad | Notifica |
| --- | --- | --- | --- |
| `unassigned_upcoming` | visita activa dentro de `alert_upcoming_hours` (24 h) cuyo agente está inactivo o borrado | crítica | admin + dirección |
| `no_checkin` | programada/en camino `alert_no_checkin_minutes` (15) después del inicio | crítica | agente + admin + dirección |
| `checkin_needs_review` | check-in o en curso con último intento no verificado | advertencia | agente + admin + dirección |
| `overrun` | en curso más allá de la duración planificada + `alert_overrun_minutes` (60) | advertencia | no (tablero) |
| `not_finished` | activa (no en curso) `alert_not_finished_minutes` (120) después del fin | advertencia | agente + admin + dirección |
| `no_report` | finalizada sin informe confirmado tras `alert_report_hours` (12 h) | info | no |
| `no_followup` | informe confirmado sin tarea de seguimiento tras el mismo plazo | info | no |

Sin spam: una fila por (visita, tipo) (`unique`), se resuelve sola cuando la condición desaparece y se reabre si vuelve,
pero `notified_at` no se borra (una notificación por visita y tipo, además de `dedupe_key` en `notifications`).

## 7. Jobs

| Job | Frecuencia | Qué hace |
| --- | --- | --- |
| `visits.alerts` | cada 5 min | calcula, abre, resuelve y notifica alertas (no-op con el flag apagado) |
| `visits.links_expire` | horaria | registra links vencidos (timeline + evento, una sola vez) |
| `visits.location_retention` | diaria (06:00 Salta) | anula lat/lng/precisión de check-ins más viejos que la retención; quedan estado, motivo y distancia |

## 8. Eventos de dominio

`appointment.created`, `appointment.assigned` (alta y reasignación), `appointment.en_route`, `agent.checked_in`
(verificación, motivo, distancia; nunca coordenadas), `appointment.started`, `appointment.finished`,
`appointment.cancelled`, `appointment.no_show`, `client_link.created` (id del link, nunca el token),
`client_link.expired`, `followup.created`. Se conservan `visit.scheduled` y `visit.completed` (este último con
`followUpMode: "manual"` desde el portal). Con el flag apagado la Agenda emite exactamente lo mismo que antes.

## 9. Timeline (`appointment_events`, append-only)

programada, asignada/reasignada, reprogramada, confirmada, en camino, check-in (con resultado), reintento, problema de
ubicación, iniciada, finalizada, cancelada, no se presentó, link generado/rotado/revocado/abierto/vencido, informe
guardado/confirmado, seguimiento creado, agradecimiento preparado/marcado como enviado. Un `CHECK` impide guardar claves
de ubicación en `data`.

## 10. Permisos, flags y rutas

- `visits.operate`: super_admin, dirección, administrador, agente. `visits.monitor`: super_admin, dirección, administrador.
  Alcance total también con `agenda.read_all`. Solo lectura, marketing y alquileres no acceden.
- Flags: `visits_operations` (portal, centro, jobs, eventos nuevos de la Agenda) y `client_visit_link` (link). Apagados:
  la Agenda queda idéntica, los accesos desaparecen del menú y `/visita/*` responde 404.
- `Permissions-Policy`: `geolocation=(self), microphone=(self)` solo en `/crm/mis-visitas/*`; el resto del sitio sigue
  con `geolocation=(), microphone=()`.

| Ruta | Qué |
| --- | --- |
| `/crm/mis-visitas` | Hoy / Próximas (15 días), Mías / Equipo para quien ve todas |
| `/crm/mis-visitas/[id]` | detalle y acciones (también lo usa el centro operativo) |
| `/crm/centro-operativo` | tablero, alertas y reasignación |
| `/visita/[token]` | link del cliente |
| `GET /api/visita/[token]` | estado para el polling (ETag) |

Server Actions: `src/app/crm/(panel)/mis-visitas/actions.ts` (todas con `runAction` + servicio con `requirePermission`).

## 11. Puntos de extensión (fase de IA y siguientes)

`src/server/visits/ai-extension.ts` define `structureVisitReport(text)`, `buildVisitBrief({ appointmentId })` y
`draftThankYouMessage(...)` con implementación nula (`registerVisitAi` para conectar la real). La UI ya los consulta:

- detalle de la visita: tarjeta «Antes de la visita» si `buildVisitBrief` devuelve algo;
- informe en borrador: panel «Revisá y confirmá» (`ProposalReview`) si `structureVisitReport` devuelve una propuesta; el
  agente decide qué aplicar y confirma con el mismo servicio;
- agradecimiento: `draftThankYouMessage` puede reemplazar la plantilla como sugerencia editable.

Otras extensiones documentadas y no construidas: posición en vivo del agente (opt-in por visita, solo en camino,
≥ 30 s, redondeo ~100 m, borrado al llegar/finalizar), imagen OG de la tarjeta, envío automático por WhatsApp Cloud /
Resend (requiere credenciales y siempre confirmación humana).

## 12. Pruebas

- Unitarias `tests/unit/visits-rules.test.ts`: estados, geofence, tokens, expiración, plantillas, seguimiento, alertas, settings.
- Integración `tests/integration/visits-operations.test.ts` (Postgres real): flujo completo, transiciones inválidas
  (servicio y trigger), ventana de presencia, geofence y fallback, IDOR en cada servicio, organización ajena, presencia
  solo del asignado, reasignación con superposición, token solo como hash, rotar/revocar/adivinado/vencido/flag/rate
  limit, dirección oculta, contacto autorizado, aperturas, cierre sin datos en vivo, alertas deduplicadas, vencimiento,
  retención, compatibilidad de la Agenda con el flag apagado.
- E2E `tests/e2e/visits.mobile.spec.ts` (390) y `tests/e2e/visits.spec.ts` (1440): ver `scripts/e2e.sh`. Capturas
  opcionales con `VISITS_SHOTS_DIR=/ruta`.
