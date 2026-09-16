# Auditoría inicial — 2026-09-16

Alcance: ecosistema digital existente de Lucio López Fleming Inmobiliaria antes de este proyecto.
Método: inspección del sitio público (HTML, `__NEXT_DATA__`, API pública, headers, red en navegador headless) y corrida
real del importador sobre el inventario completo. Solo se listan hallazgos **verificados**; lo no verificable se indica.

## 1. Punto de partida

- **No existía repositorio, base de datos propia, CRM propio, tests, CI ni documentación.** El sitio
  www.luciolopezfleming.com.ar es una plantilla ("Evolution") del SaaS **Adinco CRM** (Next.js pages router alojado por el proveedor).
- Todos los datos (propiedades, fotos, agentes, consultas) viven en el proveedor. La inmobiliaria no controla backups,
  exportación completa, disponibilidad, SEO técnico ni integraciones.

## 2. Hallazgos del sitio actual

| # | Hallazgo | Evidencia | Impacto |
| --- | --- | --- | --- |
| 1 | El home y los listados se renderizan en el cliente: el HTML inicial no contiene propiedades | `__NEXT_DATA__.props.pageProps` vacío en `/`; datos llegan por `POST /api/properties` | SEO y rendimiento percibido |
| 2 | Fichas sin `<h1>`, sin canonical y sin datos estructurados (JSON-LD) | head y headings capturados de `/luciolopez-3021` | SEO |
| 3 | Meta description genérica igual en todas las fichas (nombre, teléfono y dirección de la inmobiliaria) | `<meta name="description">` de fichas | CTR en buscadores |
| 4 | jQuery 2.1.1 (2014) y Leaflet desde CDNs de terceros cargados de forma bloqueante en `<head>` | HTML del home | seguridad (librería sin soporte) y rendimiento |
| 5 | Google Analytics Universal `UA-4351717-107` (descontinuado en 2023) conviviendo con GA4 `G-8VZ81WKL7G` y New Relic | HTML y configuración | medición parcial |
| 6 | La API pública expone emails y teléfonos personales de los 11 vendedores | `GET /api/realEstates/3414` | privacidad del equipo |
| 7 | Teléfonos inconsistentes: header "+544210303" (sin código de área); los botones de WhatsApp apuntan a números distintos según la ficha; WhatsApp general distinto del de la secretaría | header y links `wa.me` | consultas que se dispersan |
| 8 | Textos desactualizados o contradictorios: "MÁS DE 45 AÑOS" (texto) vs "50 años" (banner); horario de Casa Central cargado como "." | configuración del sitio | confianza |
| 9 | Banners con texto quemado en la imagen (no indexable, no accesible) | imágenes del carrusel | SEO y accesibilidad |
| 10 | El CDN de fotos (CloudFront) bloquea ráfagas de requests por IP | 403 tras ~8.000 verificaciones durante la migración | la copia de fotos a storage propio debe ser lenta y reanudable |

No verificado (requiere acceso del proveedor): backups, retención, disponibilidad histórica, logs, gestión de usuarios de Adinco.

## 3. Calidad de datos (corrida real del importador)

- **366** propiedades publicadas en el sitio anterior: 304 en venta (USD), 61 en alquiler (39 en pesos, 22 en USD), 1 alquiler temporario.
  Tipos: 109 casas, 107 terrenos, 77 departamentos, 21 oficinas, 19 locales, 18 galpones, 7 emprendimientos, 4 hoteles, 4 negocios especiales.
  2 oficinas, 11 vendedores.
- **3.840** fotos; 3.432 verificadas antes del bloqueo del CDN, 408 pendientes de verificación (no rotas: sin verificar).
- Advertencias abiertas que **bloquean publicación** (11 fichas, quedan en revisión):
  - 8 · la descripción indica precio **por hectárea o por m²** (el precio cargado no sería el total).
  - 5 · precio implausible (p. ej. código 3020: predio de 14.000 m² en venta a USD 150).
  - 1 · superficie implausible (código 2435: 395.386 ha).
- Advertencias no bloqueantes: 12 sin coordenadas (sin mapa), 3 con cubierta > total, 1 fuera de la provincia indicada,
  1 sin descripción; 133 títulos genéricos ("casa en venta"), 33 descripciones con teléfonos o emails embebidos.
- Estas cifras cambian a medida que el equipo revisa: fuente viva en **CRM → Migración** (`migration_warnings`).

## 4. Reliability Score inicial

Escala 0–10 por dimensión (ponderación igual), evaluando el ecosistema que la inmobiliaria **controla**.

| Dimensión | Puntaje | Motivo |
| --- | --- | --- |
| Arquitectura / propiedad del sistema | 3 | funciona, pero cerrada y en manos del proveedor |
| Dependencias | 3 | jQuery 2014, scripts de terceros bloqueantes, UA descontinuado |
| Testing | 0 | inexistente (del lado de la inmobiliaria) |
| CI/CD | 0 | inexistente |
| Seguridad | 4 | HTTPS y CDN; exposición de datos del equipo en API pública; sin control de accesos propio |
| Base de datos / fuente de verdad | 3 | existe en el proveedor; sin acceso ni exportación controlada |
| Backups | 1 | no verificables por la inmobiliaria |
| Restore | 0 | nunca probado |
| Observabilidad | 2 | New Relic del proveedor, sin acceso ni alertas propias |
| Rollback | 1 | depende del proveedor |
| Configuración | 3 | panel del proveedor, con datos inconsistentes |
| Documentación | 0 | inexistente |
| Disaster recovery | 1 | sin plan; los datos no son exportables completos |

**RELIABILITY SCORE INICIAL: 21/130 → 16/100**

## 5. Prioridades derivadas

1. Base propia como fuente de verdad + migración idempotente con revisión humana (hecho en esta etapa).
2. Captura de leads centralizada y deduplicada (web, WhatsApp, portales) con avisos y tareas.
3. SEO técnico (SSR, H1, canonical, JSON-LD, sitemap) y 301 desde las URLs actuales para no perder posicionamiento.
4. Unificar canales de contacto (un WhatsApp por sede/asesor definido por la empresa).
5. Copiar fotos a storage propio antes de dar de baja Adinco.
6. Backups, restore probado, monitoreo y alertas propios.
