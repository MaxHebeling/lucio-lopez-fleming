# IA Fase 5 · Gestión («AI Management»)

Rama `feat/ai-management` (base `main` @ `dd957ce`). Construye sobre el AI Core (docs/ai/AI_CORE.md), Ventas
(docs/ai/SALES.md), Propiedades y visitas (docs/ai/PROPERTY.md, docs/ai/VISITS_AI.md) y el núcleo operativo de visitas
(docs/operations/VISITS.md). Automatización (Fase 6): docs/ai/AUTOMATION.md. Catálogo de eventos: docs/ai/EVENTS.md.

## Línea base (antes de tocar código, 2026-09-17, `llf_dev_mgmt` / `llf_test_mgmt`)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos (8,8 s) |
| `pnpm typecheck` | OK (11,7 s) |
| `pnpm test` | **68 archivos, 676 tests OK** (62,7 s) |
| `pnpm build` | OK (16,6 s). First Load JS sin comprimir: `/crm` 494.307 B · `/crm/tareas` 497.017 B · `/crm/automatizaciones` 495.889 B · `/crm/integraciones/ia` 494.307 B · `/` 553.734 B |
