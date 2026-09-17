# AI Real Estate OS · Índice

Plataforma de Lucio López Fleming (Salta). La empresa la dirigen personas: la IA asiste, organiza, explica, detecta,
recomienda, resume y prepara borradores. **Nunca envía mensajes a clientes, nunca publica y nunca confirma datos sola.**
Todo funciona hoy **sin clave de IA** (capa determinista completa y testeada); con la clave se suma redacción y análisis.

## Fases

| Fase | Qué hace | Documento | Pantallas principales |
| --- | --- | --- | --- |
| Mapa previo | Auditoría de arquitectura antes del AI Core | [ARCHITECTURE_MAP.md](./ARCHITECTURE_MAP.md) | — |
| 1 · AI Core | Proveedor, ruteo por tarea, registro de herramientas con permiso y capability (sin `execute`), prompts versionados, PII, anti-injection, `ai_interactions`, presupuesto, copiloto «✦ Asistente IA» (Asistente + Analista), base de conocimiento | [AI_CORE.md](./AI_CORE.md) · [GOVERNANCE.md](./GOVERNANCE.md) | Copiloto (Ctrl + I), `/crm/integraciones/ia` |
| 2 · Ventas | Concierge del sitio, preguntas a la propiedad, comparador, perfil del comprador, coincidencias y match inverso, señales de interés, calificación de leads, siguiente acción, «Ponme al día» | [SALES.md](./SALES.md) | sitio, ficha de contacto/lead |
| 3 · Propiedades | Calidad de la publicación, director de fotos, borradores de marketing, inventario, guía del tour, captación paso a paso | [PROPERTY.md](./PROPERTY.md) · [VIRTUAL_STAGING.md](./VIRTUAL_STAGING.md) | ficha de propiedad, `/crm/propiedades/inventario` |
| 4 · Visitas | Núcleo operativo (estados, check-in, link del cliente, centro operativo) + brief, propuesta de informe, agradecimiento y seguimiento sugerido | [../operations/VISITS.md](../operations/VISITS.md) · [VISITS_AI.md](./VISITS_AI.md) | `/crm/mis-visitas`, `/crm/centro-operativo` |
| 5 · Gestión | «Resumen de hoy», preguntas de dirección con hechos definidos, anomalías, «Tareas sugeridas», Centro de comando | [MANAGEMENT.md](./MANAGEMENT.md) | Tablero, `/crm/tareas-sugeridas`, `/crm/centro-de-comando` |
| 6 · Automatización | Catálogo de eventos, reacciones de IA idempotentes con protección contra loops y despliegue seguro | [AUTOMATION.md](./AUTOMATION.md) · [EVENTS.md](./EVENTS.md) | `/crm/automatizaciones`, Uso de IA |

Guías para el equipo (las usa el copiloto): `knowledge/*.md` (24 guías). Ingesta: `pnpm ai:knowledge:ingest`.

## Flags de IA (Integraciones → Feature flags, sin redeploy)

| Flag | Estado por defecto | Fase |
| --- | --- | --- |
| `ai_copilot` | encendido | 1 |
| `ai_concierge`, `ai_matching`, `ai_property_qa`, `site_compare` | encendidos | 2 |
| `ai_property_quality`, `ai_photo_director`, `ai_marketing_director`, `ai_tour_guide`, `owner_capture_steps` | encendidos | 3 |
| `owner_capture_photos` | **apagado** (requiere storage S3) | 3 |
| `ai_visit_brief`, `ai_followup` (+ `visits_operations`, `client_visit_link`) | encendidos | 4 |
| `ai_daily_brief`, `ai_task_center`, `ai_executive` | encendidos | 5 |
| `ai_automations` | encendido; las reacciones las activa el código nuevo (AUTOMATION.md) | 6 |

Apagar un flag deja el CRM y el sitio como antes de esa función (las tablas quedan, sin uso).

## Permisos de IA

`ai.copilot` (todos los roles del equipo), `ai.read_usage` (super_admin, dirección, administración), `ai.executive`
(super_admin, dirección, administración). El resto usa los permisos de cada módulo (leads, visitas, tareas, propiedades).

## Cómo activar la clave del proveedor

1. Crear la API key en la consola de Anthropic (organización de la inmobiliaria) con límite de gasto.
2. Vercel → `ANTHROPIC_API_KEY` en Production (y otra clave en Preview/Staging):
   `printf "%s" "$KEY" | vercel env add ANTHROPIC_API_KEY production` y redeploy.
3. Revisar `ai.daily_budget_usd` (5), `ai.public.daily_budget_usd` (1), `ai.copilot.requests_per_hour` (60),
   `ai.daily_brief.max_ai_per_day` (6).
4. Verificar en Uso de IA: la integración `anthropic` pasa a «Activa»; costos, latencia, respaldos y guardas por función.
5. Si algo sale mal: apagar el flag de la función (o quitar la variable). Todo vuelve a la capa determinista.

## Qué cambia con la clave

Copiloto: respuestas redactadas y Analista con herramientas · Sitio: interpretación del concierge, Q&A y resumen del
comparador redactados · Leads: extracción del perfil desde la consulta · Propiedades: ambientes de fotos (visión) y
borradores redactados · Tour: intención de preguntas no reconocidas · Visitas: brief redactado, propuesta de informe y
variante del agradecimiento · Gestión: 2–3 líneas del Resumen de hoy e interpretación de preguntas de dirección ·
Automatización: extracción del perfil desde el informe confirmado. Todo con guardas: si la IA inventa, se descarta.

## Pendiente de credenciales o acciones externas

| Qué | Para qué |
| --- | --- |
| `ANTHROPIC_API_KEY` | capa con modelo de todas las fases (ninguna está validada todavía contra el proveedor real) |
| Claves S3 de Supabase Storage | análisis de fotos propias, fotos de captación (`owner_capture_photos`) |
| WhatsApp Cloud API / Resend | envíos (siempre con confirmación humana; `outbound_*` apagados) |
| Credenciales de portales y Meta | publicación en portales y redes (borradores ya disponibles) |
| `SENTRY_DSN`, monitor de uptime | alertas externas (docs/MONITORING.md) |
