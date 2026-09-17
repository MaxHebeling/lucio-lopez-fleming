# AI Property (Fase 3) + IA de visitas (Fase 4b)

Documento vivo de la rama `feat/ai-property` (base `main` @ `3cca8d7`). Se completa a medida que se construye.

## Línea base (antes de tocar código, 2026-09-17)

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | OK, 0 errores / 0 avisos (8,3 s) |
| `pnpm typecheck` | OK (11,2 s) |
| `pnpm test` | **54 archivos, 522 tests OK** (unit + integración contra Postgres local `llf_test_property`, 49 s) |
| `pnpm build` | OK (16,3 s). First Load JS sin comprimir: `/` 539.322 B · `/propiedades/[slug]` 541.542 B · `/crm/propiedades/[id]` 533.830 B · `/crm/mis-visitas/[id]` 539.508 B |
| Lighthouse home `/` (build de producción local, base `llf_dev_property`, Chrome for Testing 1243, 3 corridas) | Mobile: rendimiento 95 / 92 / 92 (LCP 2,95–3,38 s, TBT ≤ 8 ms, CLS 0), accesibilidad 100, buenas prácticas 100, SEO 69 (`APP_ENV=development` ⇒ `noindex`). Desktop: 100 / 100 / 100 (LCP 0,66–0,82 s, TBT 0, CLS 0) |
