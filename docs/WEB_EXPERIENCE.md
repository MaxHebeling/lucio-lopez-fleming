# Experiencia web — Lucio López Fleming

Documento de dirección creativa y técnica del sitio público. Toda decisión visual se mide contra una pregunta:
**¿ayuda a explorar propiedades, contactar, pedir tasación o agendar?** Si no, se elimina.

## 1. Lo que sabemos de la marca (fuentes reales)

- Fundada en **1974** en Salta por Lucio López Fleming, de quien toma el nombre (dato publicado en el sitio anterior).
- A CONFIRMAR con la empresa antes de usarlo en copy público: que sea una empresa familiar de varias generaciones (lo
  sugieren las fotos de la oficina y los apellidos del equipo) y la composición actual del equipo. Mientras no se
  confirme, el sitio no lo afirma.
- Textos propios del sitio anterior (se pueden citar): «Líderes inmobiliarios desde 1974», «Buenos negocios»,
  «una de las empresas más tradicionales del rubro en Salta», «Nos caracterizamos por nuestra seriedad, calidad humana,
  compromiso y la experiencia en el rubro», «comercialización de inmuebles y lotes, alquileres, administración y tasación
  de propiedades en la provincia de Salta y el país», «Brindamos asesoramiento personalizado».
- Oficinas: **Casa Central** Av. Entre Ríos 639, Salta (lun a vie 9–13 · sáb 10:30–12:30) y **Oficina San Lorenzo Chico**
  (Circunvalación Oeste). Teléfono 387 421-4143. Instagram @inmoluciolopezfleming · Facebook /luciolopezfleming.
- Logo: monograma **LLF** de trazos angulares en rojo ladrillo (#AE2C25), wordmark geométrico en negro, bajada
  «BUENOS NEGOCIOS» en rojo. La oficina: madera clara, paredes gris pizarra, dibujos en sanguina (siena), luz natural.
- Inventario real (sept. 2026): ~360 propiedades. Mayoría casas y terrenos; fuerte presencia en Villa San Lorenzo,
  Salta Capital, Vaqueros, La Caldera, Cerrillos y Valle de Lerma, con cerros y verde de fondo en muchas fotos.
- **Datos que NO existen y no se inventan**: testimonios, cantidad de operaciones, clientes, años de "experiencia"
  distintos de "desde 1974", premios, rankings. Números permitidos: los que salen en vivo de la base (propiedades
  publicadas por zona/tipo) y el año de fundación.

## 2. Concepto: «Buenos negocios, desde 1974»

Una casa editorial de bienes raíces salteña. No una "inmobiliaria con animaciones": una marca con oficio, con archivo,
con territorio. Tres ideas guían todo:

1. **Oficio y herencia** — tipografía editorial, ritmo de revista de arquitectura, el año 1974 como ancla.
2. **Territorio** — las líneas angulares del monograma LLF se leen como trazos de agrimensura: lotes, planos, cerros.
   Son el motivo gráfico de transición (líneas finas que se dibujan y revelan fotografía), nunca decoración suelta.
3. **La propiedad protagonista** — fotografía real a sangre, recortes editoriales, escala. Los datos (precio, m²,
   dormitorios, zona) siempre legibles y a un toque.

Emoción buscada: confianza serena + deseo. Al entrar: «qué marca»; a los segundos: «entiendo quiénes son y qué hacen»;
enseguida: «quiero ver esta casa / escribirles».

## 3. Sistema visual

- **Paleta** (tokens en `src/app/globals.css`): papel cal `paper`, tinta `ink`, ladrillo `brick` (acento escaso: CTA
  primario, líneas del motivo, detalles), siena `siena` (secundario cálido), piedra `stone`, líneas `line`.
  Secciones oscuras en `ink` con texto `paper` para dar ritmo.
- **Tipografía**: display `Instrument Serif` (titulares grandes, cursiva para énfasis puntual) + `Manrope` (UI, datos,
  cuerpo). Macrotipografía solo donde dirige la mirada (`clamp(3.5rem, 9vw, 10rem)` en hero y cierre).
- **Fotografía**: solo del inventario real y de la oficina/equipo (sitio anterior). Crops editoriales, verticales y
  horizontales alternadas, offset, máscaras. Nunca imágenes de stock ni generadas presentadas como propiedades.
- **Nada de**: templates reconocibles, partículas, neón, blur gratuito, gradientes sin propósito, falso 3D, loaders,
  intros no salteables, scroll secuestrado, copy genérico de IA.

## 4. Narrativa del Home

Ritmo: IMPACTO → PAUSA → PROPIEDAD → TERRITORIO → SERVICIOS → PROCESO → CONVERSIÓN → CONFIANZA → CIERRE.

1. **Portada + recorrido arquitectónico** (`components/experience/hero`, ver §4.1) — la foto de la oficina modular
   (`public/brand/photos/oficina-modular.jpg`, 1200 × 1600) es la portada y el LCP: lámina vertical protagonista
   (derecha en desktop, arriba en mobile), titular «Buenos negocios, desde 1974.» por líneas, año de fundación como
   numeral fantasma, CTA «Ver propiedades» y «Quiero vender mi propiedad», concierge y buscador en barra. Al scrollear,
   la ventana roja del container se vuelve el portal a un recorrido por una propiedad real (o, si no está disponible,
   por la inmobiliaria) que termina sobre papel y da paso al manifiesto.
2. **Manifiesto** (`EditorialManifesto`) — textos reales, se enciende palabra por palabra con el scroll (desktop).
3. **Destacadas** (`FeaturedEditorial`) — 3 propiedades de `getShowcaseProperties` (≥ 8 fotos no fallidas, destacadas
   del equipo primero), cada una con composición propia: foto protagonista + número, split editorial, localidad gigante
   detrás de la foto.
4. **Territorio** (`TerritorySalta`) — «SALTA» recortando la portada de la zona con más propiedades fuera de la ciudad
   de la casa central (elegida por datos) + índice de zonas con conteos en vivo.
5. **Servicios** (`ServicesIndex`) — venta, alquileres, administración, tasaciones: índice con lámina que cambia al
   hover/foco en desktop, acordeón en mobile.
6. **Proceso** (`ProcessSteps`) — seis pasos genéricos; el monograma LLF se completa trazo a trazo (sticky en desktop).
7. **Propietarios** (`OwnersCapture`, `#vender`) — formulario que crea un lead `sell_my_property` (alquilar →
   captación) + acceso a tasación.
8. **Confianza** (`TrustLedger`) — solo datos reales: 1974, sedes, inventario y localidades en vivo, texto propio de la
   empresa, foto real del equipo y oficinas con horarios.
9. **Recientes** y **Cierre** (`FinalCover`, la foto de la portada reencuadrada sobre el cielo).

## 4.1 Recorrido arquitectónico de la portada

**Idea.** El usuario entra a la marca (la oficina modular) y, al scrollear, atraviesa la ventana roja del container
hacia una casa real, escena por escena: acceso → entrar → subir → la vista → el exterior → de noche, y la última escena
se asienta sobre papel como primera hoja del home. La arquitectura es el eje; el scroll conduce todo (scrub, nada de
autoplay, ni carrusel, ni fundido tras fundido). Las aberturas reales de cada foto (ventana, puerta, arco) son las
máscaras de las transiciones.

**Propiedad.** Cód. 2605, «Casa en Club de Campo El Tipal» (Salta; dos plantas, 5 dormitorios, 4 baños, 500 m²
cubiertos según la publicación). Fotos de su publicación (1024 px, no hay más grandes), solo redimensionadas con un
sharpen leve (`scripts/site/hero-journey-images.ts` → `public/brand/journey/el-tipal-2605/`); nada generado ni
reescalado. Se evitaron la fachada con portón y la fachada de noche porque muestran la altura de la calle y la
publicación oculta la dirección exacta.

| # | Escena | Foto (sort_order) | Encuadre | Entra con |
| --- | --- | --- | --- | --- |
| 01 | Portada | oficina modular | lámina | — (LCP) |
| 02 | Acceso · «Casa en El Tipal» | camino a la fachada (04) | stage | `through`: la ventana roja del container |
| 03 | Planta baja · «Hall y living» | hall con escalera y living (05) | stage | `through`: la puerta en arco de la fachada |
| 04 | Planta alta · «Dos plantas» | escalera (13) → ventana en arco (40) | column | `rise`: la columna sube un nivel (losa «Planta alta») |
| 05 | La vista · «Desde el balcón» | vista desde el balcón (41) | stage | `through`: el arco del ventanal |
| 06 | Exterior · «Galería y piscina» | piscina de día desde la galería (28) | stage | `widen`: la composición se abre |
| 07 | De noche · «Casa en Club de Campo El Tipal» | piscina de noche (32) | close | `dusk` (misma vista de noche) + se asienta sobre papel con «Ver la propiedad» (ficha real) y «Explorar propiedades» |

**Datos y respaldo.** `ArchitecturalHero` (server) pide `getSiteJourneyProperty` (caché del sitio, etiqueta
`site:properties`): la propiedad se usa solo si está publicada, **disponible** y conserva todas las fotos del recorrido
(por URL de origen). Si no, `pickJourney` devuelve el **recorrido de respaldo**: oficina modular → oficina/escritorio →
trabajo con planos → equipo, con textos de marca y sin link a ninguna ficha. Los datos del cierre (dormitorios, baños,
m²) salen de la base, nunca del copy.

**Sistema.** `hero-journey.ts` es la configuración pura (escenas con id, label, título, frase, fotos con alt real,
foco, abertura, encuadre, transición, niveles, `static`/`mobile`, código de propiedad): otro edificio o desarrollo se
arma con otra configuración (niveles reales en `levels`), sin tocar el motor. Componentes: `ArchitecturalHero` (datos)
→ `HeroJourney` (portada, HTML del servidor) → `JourneyScenes` (isla cliente diferida) → `HeroScenes` (lista `ol` de
`HeroScene` + `HeroMedia`, `HeroProgress`, «Saltar recorrido», cierre). `motion/journey.ts` arma la línea de tiempo
leyendo solo el marcado (`data-transition`, `data-aperture`).

**Presentaciones.**

- **Desktop** (≥ 1024 px, puntero fino, sin movimiento reducido, motor cargado en idle): `.jr[data-pinned]`, escenario
  sticky de 100svh y ~33svh de scroll por unidad de la línea (≈ 450svh en 1440 × 900). Solo `transform`, `opacity` y
  `clip-path` (interpolado sobre un objeto: el navegador normaliza `inset(... round 0px)`). Profundidad: numeral
  gigante al fondo, foto, texto y detalle (línea de agrimensura, losa de nivel) a velocidades distintas. Indicador
  `01 / 07` + barra + nombre de escena; cabecera transparente mientras el recorrido está oscuro. `gsap.matchMedia`
  revierte todo al salir de desktop o pasar a movimiento reducido; `invalidateOnRefresh` recalcula aberturas al
  cambiar el tamaño; refresh tras cargar fotos; foco con teclado en una escena → se lleva el scroll a esa escena;
  recarga a mitad de página → se compensa el cambio de alto.
- **Tablet y touch** (sin motor): las escenas como láminas que se apilan (sticky) y se abren con
  `animation-timeline: view()` (sin soporte: quietas y completas).
- **Mobile** (≤ 767 px): lo mismo, solo las escenas `mobile` (portada → acceso → planta baja → exterior → cierre). Sin
  GSAP ni Lenis.
- **Movimiento reducido**: portada + fila editorial estable de las escenas `static` con el acceso a la ficha.
- **Sin JS**: la portada completa (titular, CTA, buscador); la fila de escenas es opcional y no se reserva espacio.

**Performance (regla aprendida).** Cada KB de HTML o de CSS bloqueante en el home se paga en FCP/LCP mobile (Lighthouse
simula 4G lento): con las escenas en el HTML del servidor (+5 KB gzip) y su CSS en el bloqueante (+1,7 KB) el FCP mobile
subió 300 ms. Por eso las escenas son una isla cliente (`next/dynamic`, `ssr: false`) con su CSS en el mismo chunk; en
`home.css` queda solo lo que afecta al layout inicial (`.jr`, `.jr-slot`, `.jr-end`). Las fotos del recorrido usan el
optimizador de next/image con un `srcset` corto, `loading="lazy"`, `fetchpriority="low"` y esperan a que su escena se
acerque (`data-armed`): en la carga inicial no compiten con la portada.

Lighthouse local (build de producción, `next start`, base `llf_dev_hero`, 5 corridas alternando `main` y la rama,
mediana; sept. 2026):

| | LCP | FCP | TBT | CLS | Speed Index | Peso |
| --- | --- | --- | --- | --- | --- | --- |
| Mobile `main` | 3364 ms | 1054 ms | 4 ms | 0 | 1055 ms | 443 KB |
| Mobile rama | 3215 ms | 1054 ms | 5 ms | 0 | 1054 ms | 376 KB |
| Desktop `main` | 703 ms | 285 ms | 0 ms | 0 | 422 ms | 575 KB |
| Desktop rama | 683 ms | 285 ms | 0 ms | 0 | 586 ms | 532 KB |

El LCP mobile es bimodal en ambos (≈ 2,7 s o ≈ 3,2–3,4 s según la corrida). El Speed Index desktop sube porque la lámina
de la portada es más ancha (60 vw) y su entrada (escala 1,06 → 1) ocupa más píxeles.

**QA.** `node scripts/site/journey-shots.mjs [anchos desktop] [anchos flujo]` (capturas al 0–100 % del recorrido con
el motor activo y del modo flujo). E2E: portada y LCP sin opacity 0, avance e indicador, ficha real, resize, recarga y
volver atrás sin duplicar disparadores (`data-scroll-triggers`), teclado y «Saltar recorrido», respaldo sin la 2605,
movimiento reducido, sin JS y mobile sin GSAP ni desborde.

## 5. Movimiento (jerarquía)

| Nivel | Dónde | Qué |
| --- | --- | --- |
| 1 Hero | portada + recorrido | entrada ≈1.8 s en CSS (foto que asienta su escala → cabecera → titular por líneas → bajada → CTA → buscador), profundidad ≤ 6 px con el puntero solo desktop; al scroll, recorrido arquitectónico (§4.1) |
| 2 Story | manifiesto, "qué hacemos" | sticky con progreso ligado al scroll, reveals por línea |
| 3 Secciones | resto del home | reveals moderados al entrar (opacity/translate), stagger corto |
| 4 UI | botones, cards, filtros | microinteracciones consistentes (flecha, fondo, 2–4 px) |
| 5 Crítico | buscador, fichas, formularios | casi estático |

Reglas técnicas: solo `transform`/`opacity`; contenido visible sin JS (lo que se oculta cuelga de un atributo que pone JS);
`prefers-reduced-motion` desactiva parallax, sticky animado, smooth scroll y reveals; mouse tracking y magnetismo solo con
`(hover: hover) and (pointer: fine)`; cero librerías de animación en el bundle inicial: Lenis + GSAP/ScrollTrigger se
importan con `import()` en idle, solo en desktop con puntero fino y fuera de las rutas calmas
(`components/experience/motion/smooth-scroll.ts` y `scenes.ts`); limpieza de observers/listeners/ScrollTriggers al
desmontar; CLS = 0; el LCP (foto de la portada) nunca parte de opacity 0; nada que no sea la portada en el HTML ni en el
CSS bloqueante del home si puede llegar diferido (§4.1). Tokens de duración: `--motion-fast`,
`--motion-ui`, `--motion-reveal`, `--motion-editorial`, `--motion-cinematic` (dos curvas: `--ease-out`, `--ease-in-out`).
Mobile: sin GSAP ni Lenis; revelados por IntersectionObserver y CSS.

## 6. Conversión

- Buscador y filtros (operación, tipo, localidad/barrio, precio min/máx, moneda, dormitorios, baños, cocheras,
  superficie, apto crédito, características) con URL compartible; orden por recientes, precio y superficie.
- Ficha: galería inmersiva accesible, precio o «Consultar», datos clave arriba, descripción, características, mapa
  aproximado si la dirección exacta está oculta, asesor real con WhatsApp, formulario (crea lead con la propiedad),
  pedir visita, compartir, similares reales.
- Todo formulario: validación en servidor, rate limit, honeypot, idempotencia, confirmación clara, crea lead en el CRM.

### Tour virtual 360° (fichas con tour y demo)

- Solo con tour publicado aparecen las pestañas **Fotos · Tour 360° · Plano · Video** (las disponibles); sin tour la
  ficha no cambia. La portada del tour usa la misma escala tipográfica (display) y la foto a sangre en tinta.
- Capa inmersiva en tinta con texto papel y acento ladrillo: escena en Instrument Serif, herramientas en píldoras de
  vidrio, hotspots de círculo fino. Entrada ≈ 560 ms (la foto escala y la UI se retira) + fundido de la portada; cambio de
  escena con fundido + desenfoque leve (≈ 420 ms); todo desactivado con `prefers-reduced-motion`.
- El JS del tour (PSV + three) se carga por intención o al entrar; nunca en el bundle inicial. Detalle, CRM, analítica
  y seguridad: `docs/VIRTUAL_TOURS.md`. Demo pública ficticia: `/demo/tour-360` (noindex, fuera del sitemap).

## 7. SEO

- Metadata por página, canonical, OpenGraph con foto real, JSON-LD (`RealEstateAgent` para la empresa con sus dos
  sedes; `Offer`/`SingleFamilyResidence`/`Apartment`/`Place` en fichas según corresponda), sitemap dinámico, robots.
- URLs estables `/propiedades/{slug}`; URLs del sitio anterior `/luciolopez-{código}` → 301 a la ficha nueva; si ya no
  está publicada, 301 a la búsqueda por su tipo/operación/localidad; código inexistente → 404 real.
- Propiedad vendida/alquilada: la ficha se mantiene con estado visible y similares; archivada → 301 a búsqueda filtrada.
- Titulares con diferencial real (dormitorios, ambientes o superficie) y `<title>` ≤ 60 caracteres sin cortar palabras
  (la marca se agrega solo si entra). Listados por operación + tipo y/o localidad con resultados: canonical propio y en
  el sitemap; con refinamientos (precio, dormitorios, texto…) o sin resultados: `noindex` y canonical a la base.

## 8. Caché e invalidación

- Lecturas públicas en la caché de datos de Next (`unstable_cache`, `src/server/site/public-data.ts`) con etiquetas
  `site:properties` / `site:info` y vencimiento de respaldo de 5 minutos. Home, fichas (ISR, generadas en la primera
  visita), empresa, contacto, tasaciones, términos y privacidad se sirven desde caché (`s-maxage=300`). Los listados
  dependen de la URL y siguen dinámicos (con facetas y nombres cacheados).
- Invalidación inmediata (`src/server/site/revalidate.ts`): las Server Actions y route handlers del CRM que cambian algo
  visible en el sitio llaman `revalidatePublicSiteInRequest()` después del servicio; los eventos `property.*` disparan la
  automatización de sistema `revalidate_public_site` (cubre alquileres, jobs e importador); fuera de Next (worker local,
  scripts) se pide por HTTP a `POST /api/site/revalidate` con `CRON_SECRET`.
- Nunca usar APIs dinámicas (`connection()`, `headers()`, `cookies()`) en el layout del sitio ni en `app/not-found.tsx`:
  el 404 raíz forma parte del árbol de todas las páginas y volvería dinámico al sitio entero.
