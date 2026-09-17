# Núcleo operativo de visitas

> Documento vivo del módulo de visitas (portal del agente, check-in geolocalizado, link del cliente, centro operativo).
> Se completa a medida que se construye; la línea base se registró **antes** de tocar código.

## Línea base (2026-09-17, rama `feat/visits-operations` sobre `main` @ 60de445)

Comandos existentes, sin cambios en el código, contra `llf_dev_ops` / `llf_test_ops`:

| Comando | Resultado | Duración |
| --- | --- | --- |
| `pnpm lint` | OK (0 errores, 0 avisos) | 8 s |
| `pnpm typecheck` | OK | 11 s |
| `pnpm db:codegen:verify` | OK (tipos al día) | 2 s |
| `pnpm test` | 50 archivos, 437 tests, 437 OK | 50 s |
| `pnpm build` | OK | 15 s |
