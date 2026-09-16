# WhatsApp Business + asistente de IA

Integración con la **WhatsApp Business Cloud API oficial de Meta** (nada de WhatsApp Web) y un asistente con Claude
que responde consultas **solo con datos de la base real**. Sin credenciales todo queda construido y en
`awaiting_credentials`: nunca se simula un envío ni una respuesta.

Referencias verificadas el 2026-09-16: Graph API vigente **v26.0** (29-07-2026); webhooks, firma `X-Hub-Signature-256`,
envío de mensajes, ventana de 24 h y códigos de error en
<https://developers.facebook.com/documentation/business-messaging/whatsapp>. Precios de Claude en
<https://platform.claude.com/docs/en/about-claude/pricing>.

## Arquitectura

```
Meta ──POST firmado──▶ /api/webhooks/whatsapp
                        │ 1. cuerpo crudo → HMAC SHA-256 con WHATSAPP_APP_SECRET (tiempo constante)
                        │    inválida → 401 + webhook_events(signature_valid=false, sin contenido) con límite por IP
                        │ 2. un webhook_events por mensaje/estado, unique(provider, external_event_id)
                        │    duplicado → 200 sin reprocesar
                        │ 3. job whatsapp.process_inbound por evento nuevo → 200 enseguida (after() empuja la cola)
                        ▼
              whatsapp.process_inbound (idempotente)
                • contacto único (resolveContactForCapture, phoneIsWhatsapp)
                • conversación por número (channel whatsapp, external_thread_id = wa_id)
                • mensaje por wamid (on conflict do nothing)
                • lead: reutiliza el abierto de WhatsApp del contacto (whatsapp.lead_reuse_days, 30) o captureLead
                • estados sent/delivered/read/failed → conversation_messages.status (solo avanzan)
                • ruteo: modo bot + flag whatsapp_ai_bot → job whatsapp.ai_reply; si no → persona
                        ▼
              whatsapp.ai_reply → runAssistantTurn (src/server/ai/whatsapp/agent.ts)
                        ▼
              conversation_messages (queued) ──▶ whatsapp.send_reply ──▶ Graph API /{PHONE_NUMBER_ID}/messages
```

| Pieza | Archivo |
| --- | --- |
| Webhook (GET verificación / POST eventos) | `src/app/api/webhooks/whatsapp/route.ts` |
| Firma y verificación | `src/server/integrations/whatsapp/signature.ts` |
| Parser del payload | `src/server/integrations/whatsapp/payload.ts` |
| Ingesta y procesamiento | `src/server/integrations/whatsapp/inbound.ts` |
| Cliente de envío (callIntegration + withTimeout + retry) | `src/server/integrations/whatsapp/client.ts` |
| Envío de mensajes de conversación | `src/server/integrations/whatsapp/outbound.ts` |
| Plantillas para la cola genérica `messaging.send` | `src/server/integrations/whatsapp/template-sender.ts` |
| Jobs (`whatsapp.process_inbound`, `whatsapp.ai_reply`, `whatsapp.send_reply`, `whatsapp.flush_held` cada hora) | `src/server/integrations/whatsapp/jobs.ts` |
| Asistente: loop, prompt versionado, herramientas, reglas | `src/server/ai/whatsapp/*` |
| Cliente Claude, presupuesto, costos, guardas | `src/server/ai/{client,budget,pricing,guards}.ts` |
| Tomar / devolver / cerrar / responder / derivar | `src/server/conversations/service.ts` |
| Bandeja y detalle | `src/server/conversations/queries.ts`, `src/app/crm/(panel)/conversaciones/` |
| Migración | `db/migrations/0300_whatsapp_ai.sql` |

### Estados de un mensaje saliente

`queued` → `sending` → `sent` → `delivered` → `read`, o `failed` / `awaiting_credentials`.

- Flag `outbound_whatsapp` apagado: queda `queued` con el motivo visible. Al prenderlo, `whatsapp.flush_held` (cada
  hora) o el botón **Reintentar envío** lo reencolan.
- Sin `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`: `awaiting_credentials` y la integración `whatsapp_cloud` también.
- Ventana de 24 h vencida (control local o error 131047 de Meta): `failed` con la explicación. Solo se puede escribir
  con una plantilla aprobada (`WHATSAPP_REENGAGEMENT_TEMPLATE`, botón **Enviar plantilla aprobada**).
- Errores transitorios (red, timeout, 5xx, 130429, 131000, 131016…): reintento con backoff; errores definitivos: `failed`.
- `sending` que quedó colgado más de 2 min (worker caído a mitad del envío) pasa a `failed` "estado incierto" y **no**
  se reenvía solo, para no duplicar mensajes: una persona verifica y reintenta.

## Asistente de IA

- Modelo `AI_MODEL` (por defecto `claude-sonnet-5`), sin reintentos del SDK: `callIntegration("anthropic")` +
  `withTimeout(30 s)` + hasta 2 intentos solo en 408/409/429/5xx/conexión.
- Prompt versionado (`PROMPT_VERSION` en `src/server/ai/whatsapp/prompt.ts`). Bloque estático cacheable + contexto
  de la conversación. Salida JSON (`output_config.format`) validada con zod: `reply`, `confidence`, `handoff`,
  `handoff_reason`, `summary`.
- Herramientas contra la base real (solo propiedades **publicadas**; búsqueda solo disponibles/reservadas):
  `search_properties`, `get_property` (sin dirección si `hide_exact_address`, precio "Consultar" si está oculto,
  link `/propiedades/{slug}`), `record_requirements` (en `conversations.collected` y en el lead), `request_visit`
  (crea una **tarea** para un asesor, nunca una cita confirmada) y `handoff_to_human`.
- Registro por turno en `ai_interactions`: tokens (incluida caché), costo estimado en micro-USD, latencia, rondas,
  herramientas usadas, estado (`ok`, `error`, `timeout`, `invalid_output`, `budget_exceeded`, `fallback`),
  motivo de derivación y violaciones de guardas.

### Guardas en código (no solo prompt)

1. **Antes de la IA** (`rules.ts`): pedir una persona, ofertas/negociación, reserva/seña, reclamos, documentación e
   intención de cierre → derivación directa.
2. **Después de la IA** (`guards.ts`): todo código de propiedad, monto (con o sin moneda), superficie, porcentaje,
   link, teléfono o email de la respuesta tiene que haber salido de las herramientas **de ese turno** (los montos
   que dijo el propio cliente se permiten). Si no → la respuesta se descarta, `ai_interactions.status = fallback`,
   derivación `ai_guard` y el cliente recibe solo un aviso fijo sin datos.
3. Confianza baja, `handoff` del modelo, dos fallas seguidas de la IA, presupuesto agotado, sin API key o
   mensajes sin texto (audio, foto, archivo) → derivación.
4. Primer mensaje del asistente siempre se identifica como "asistente virtual de Lucio López Fleming".

### Derivación a humano

`mode = 'human'`, `handoff_at`, `handoff_reason`, auditoría `CONVERSATION_HANDOFF`, evento `conversation.handoff` y
notificación in-app al agente asignado (conversación → lead → contacto) o a administración con nombre, WhatsApp,
propiedad, necesidades, presupuesto, resumen y últimos mensajes. En modo humano la IA no responde. Con el flag
`whatsapp_ai_bot` apagado todo entrante va a una persona (el mensaje siempre se guarda).

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Token de **usuario del sistema** con `whatsapp_business_messaging` (y `whatsapp_business_management`). No usar el token temporal de 24 h. |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business (no el teléfono). Eventos de otro número se ignoran. |
| `WHATSAPP_VERIFY_TOKEN` | Texto aleatorio propio (≥ 32 caracteres) para la verificación del webhook. |
| `WHATSAPP_APP_SECRET` | App Secret de la app de Meta; sin él el webhook responde 503. |
| `WHATSAPP_GRAPH_VERSION` | Opcional, por defecto `v26.0`. |
| `WHATSAPP_REENGAGEMENT_TEMPLATE`, `WHATSAPP_TEMPLATE_LANGUAGE` | Opcional: plantilla aprobada para retomar contacto (idioma por defecto `es_AR`). |
| `ANTHROPIC_API_KEY` | Clave de la API de Claude. |
| `AI_MODEL` | Opcional, por defecto `claude-sonnet-5`. Si se cambia, revisar `src/server/ai/pricing.ts`. |

Settings en base: `ai.daily_budget_usd` (5 por defecto), `whatsapp.lead_reuse_days` (30).
Flags: `whatsapp_ai_bot` (IA responde) y `outbound_whatsapp` (envío real). Ambos nacen **apagados**.

## Configurar en Meta

1. **Business Manager verificado** (Business Verification) de la inmobiliaria.
2. App de tipo *Business* en developers.facebook.com con el producto **WhatsApp**; asociar la cuenta de WhatsApp
   Business (WABA).
3. **Número propio verificado** (SMS/llamada) y nombre visible aprobado. Si el número hoy se usa en la app de
   WhatsApp, hay que migrarlo o usar uno nuevo.
4. Usuario del sistema con token permanente y permisos `whatsapp_business_messaging` + `whatsapp_business_management`
   → `WHATSAPP_ACCESS_TOKEN`. Copiar el **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID` y el **App Secret** →
   `WHATSAPP_APP_SECRET`.
5. WhatsApp → Configuración → Webhook: URL `https://<dominio>/api/webhooks/whatsapp`, token de verificación =
   `WHATSAPP_VERIFY_TOKEN`. Suscribir el campo **messages**.
6. Método de pago en la WABA (las plantillas y algunas conversaciones se cobran por Meta).
7. Crear y aprobar plantillas (p. ej. `retomar_consulta`, recordatorios de alquiler) en español (es_AR).
8. Pasar la app a modo **Live** (en desarrollo solo llegan mensajes de números de prueba).
9. Recién con todo probado: prender `outbound_whatsapp` y luego `whatsapp_ai_bot` desde el panel/SQL.

Política de Meta vigente desde 15-01-2026: no se permiten asistentes de IA de **propósito general** en la API; un
asistente acotado a la atención comercial de la empresa (como este) está permitido.

## Cómo probar

- Automático: `pnpm test` (unit + integración con Postgres local). HTTP de Meta y SDK de Anthropic mockeados en tests;
  en runtime nunca hay respuestas simuladas. Cubre firma inválida, webhook duplicado, mensaje repetido, procesamiento
  en paralelo, estados fuera de orden, ventana de 24 h, 5xx con reintento, IA que alucina un precio o código (deriva),
  presupuesto agotado, sin credenciales, visitas como tarea y permisos.
- Verificación del webhook: `curl "https://<dominio>/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123"` → `123`.
- Con credenciales de prueba de Meta: mandar un mensaje desde un número de prueba, correr `pnpm jobs:run` en local
  (o esperar al cron) y revisar `/crm/conversaciones`.

## Límites y costos

- **Meta**: cobro por plantilla entregada según categoría y país (tarifa de Argentina en la lista de precios de Meta);
  respuestas de servicio dentro de la ventana de 24 h sin costo de plantilla. Límites de throughput por número
  (error 130429) y de mensajes a un mismo usuario (131056): se reintentan.
- **Claude** (`claude-sonnet-5`): USD 2 / millón de tokens de entrada, USD 10 / millón de salida, lectura de caché
  USD 0,20. Un turno típico con una búsqueda (≈2 rondas, ≈3–5 mil tokens de entrada con caché, ≈300 de salida)
  cuesta, como estimación, alrededor de USD 0,01 (el costo real de cada turno queda en `ai_interactions.cost_usd_micros`). El presupuesto diario corta la IA y deriva a personas al alcanzarse.
- Historial enviado al modelo: últimos 20 mensajes; hasta 4 rondas de herramientas por turno; 3 propiedades por respuesta.
- Mensajes entrantes sin texto (audio, foto, documento) no se interpretan: van a una persona.

## Pendientes / riesgos conocidos

- Faltan credenciales reales, número verificado, Business Verification, plantillas aprobadas y app en modo Live.
- Plantillas de la cola genérica (`outbound_messages`): al integrar con la rama de mensajería registrar
  `registerWhatsAppTemplateSender(sendWhatsAppTemplate)`; cada `templateKey` debe coincidir con una plantilla
  aprobada (o indicar `payload.whatsappTemplate.name` y `bodyParameters`).
- Las guardas no validan cantidades pequeñas sin unidad (p. ej. "3 dormitorios"): las sigue cubriendo el prompt.
- Un timeout de red al enviar puede producir un duplicado si Meta sí entregó (se prioriza no perder el mensaje).
- Si un teléfono coincide con más de un contacto existente, la captura central crea un contacto nuevo y un candidato
  a duplicado (comportamiento del módulo de contactos); la conversación queda fija a su contacto.
