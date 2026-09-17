# Migración desde el sitio anterior (Adinco)

## Origen

- Sitio: https://www.luciolopezfleming.com.ar — plataforma **Adinco CRM** (plantilla "Evolution"), inmobiliaria id 3414.
- Datos públicos usados (solo lectura): `POST /api/properties` (listado), ficha SSR `/luciolopez-{código}` (`__NEXT_DATA__`),
  `GET /api/realEstates/3414` (oficinas y vendedores), fotos en `https://static1.adinco.net/`.
- No se usan credenciales de Adinco ni datos privados (propietarios, consultas históricas, contratos): **esos datos no
  están disponibles públicamente** y requieren una exportación desde Adinco (ver "Pendiente").

## Pipeline por registro

```
DISCOVERED → EXTRACTED → NORMALIZED → VALIDATED → IMPORTED → MEDIA VERIFIED → REVIEW REQUIRED | PUBLISHED
                                                                         └→ SKIPPED_PROTECTED (verificada a mano)
```

- Estado por propiedad en `migration_records` (con payload crudo, hash y normalizado); corridas en `migration_runs`.
- **Idempotente**: clave `source=adinco` + id de Adinco en `external_refs`. Correrlo N veces no duplica.
- **Incremental**: si el hash del payload no cambió, no reescribe (usar `--force` al cambiar reglas de mapeo).
- **Reiniciable**: cada propiedad en su transacción; un error no aborta la corrida.
- **Correcciones humanas**: campos editados en el CRM quedan en `protected_fields` y no se sobrescriben
  (conflicto → advertencia `protected_field_conflict`); propiedades verificadas manualmente no se tocan.
- **Sin efectos colaterales**: importar no emite `property.published` (no genera borradores de redes ni sincroniza portales).
- Fichas con advertencias de severidad `error` quedan **en revisión y sin publicar**.

## Advertencias (`migration_warnings`)

| Código | Severidad | Significado |
| --- | --- | --- |
| implausible_price | error | venta en USD < 1.000, alquiler en USD < 50, venta en pesos muy baja |
| price_per_unit_in_description | error | la descripción dice "por hectárea/m²": el precio cargado podría no ser el total |
| implausible_area | error | superficie absurda (no se guarda) |
| missing_price / unknown_currency | error | sin precio ni "consultar" / moneda desconocida con monto |
| missing_images / media_unreachable | error | sin fotos o ninguna responde |
| missing_locality / coordinates_outside_argentina | error | ubicación inválida |
| invalid_source_payload | error | el origen cambió de formato (ficha no importada) |
| covered_exceeds_total, bedrooms_on_land, missing_description, missing_address, unknown_type | warning | revisar |
| generic_title, contact_data_in_description, few_images, area_in_hectares, sale_in_pesos, development_price_on_request | info | mejora sugerida |
| protected_field_conflict, source_changed_after_verification | warning/info | el origen difiere de una corrección del CRM |
| missing_from_source | warning | ya no está en el sitio anterior: revisar estado (no se cambia solo) |

Se revisan en **CRM → Migración**: resolver/descartar, abrir la propiedad y marcarla como verificada.

## Uso

```bash
pnpm import:adinco --limit 10          # prueba
pnpm import:adinco --verify-media      # corrida completa verificando fotos
pnpm import:adinco --codes 3021,3018   # puntuales
pnpm import:adinco --force             # reprocesar con reglas nuevas
```

Salida: estadísticas JSON (descubiertas, extraídas, creadas, actualizadas, sin cambios, protegidas, publicadas,
en revisión, fallidas, advertencias por severidad, fotos verificadas). Código de salida 2 si hubo fallidas.

## Corte (cutover)

1. Corrida completa en staging → revisar advertencias `error` con el equipo.
2. Congelar cargas en Adinco (o registrar los cambios hechos allí) → corrida final en producción.
3. Desde ese momento **el CRM es la fuente de verdad**; el importador queda solo para auditoría.
4. Apuntar el dominio al sitio nuevo; las URLs `/luciolopez-{código}` redirigen 301 a las fichas nuevas.
5. Copiar la multimedia a storage propio (flag `media_copy`) antes de dar de baja Adinco.

## Pendiente (requiere acción de la inmobiliaria)

- Exportación desde Adinco de propietarios, interesados/consultas, visitas y contratos (no son públicos).
- Confirmar qué vendedores siguen activos antes de invitarlos al CRM (se importaron sin acceso).

## Resultado de la corrida real (base de desarrollo, 2026-09-16)

| Etapa / dato | Cantidad |
| --- | --- |
| Descubiertas / extraídas | 366 / 366 |
| Publicadas | 355 |
| En revisión (advertencias de severidad error) | 11 |
| Fallidas | 0 |
| Agentes importados (sin acceso hasta invitarlos) | 11 |
| Oficinas vinculadas | 2 |
| Fotos | 3.840 (3.432 verificadas · 408 sin verificar por bloqueo del CDN, no rotas) |
| Advertencias abiertas | 14 error · 17 warning · 236 info |

Incidente durante la migración: el CDN de Adinco (CloudFront) bloqueó la IP tras miles de verificaciones de fotos y la
segunda corrida marcó 408 fotos válidas como rotas (43 fichas despublicadas). Se corrigió el importador (403/429/5xx =
no concluyente, circuit breaker) y se repararon los datos con registro en `audit_logs` (`MIGRATION_DATA_REPAIRED`).
**Para producción**: correr la importación con `--verify-media` una sola vez y lejos de otras corridas; la copia de
fotos a storage propio (`media.copy`) debe ir en lotes chicos.
