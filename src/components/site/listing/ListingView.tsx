import Link from "next/link";
import { ChevronLeft, ChevronRight, LayoutGrid, List, X } from "lucide-react";
import type { PublicPropertyCard } from "@/server/properties/public";
import { getSiteFacets, getSiteRecent, getSiteType, getSiteZoneName } from "@/server/site/public-data";
import {
  OPERATION_SLUGS,
  SORTS,
  activeFilterCount,
  filtersToQuery,
  plural,
  type SearchFilters,
  type SortKey,
} from "@/server/properties/public-helpers";
import { PropertyCard } from "../PropertyCard";
import { PriceBlock, Specs, StatusBadge } from "../property-bits";
import { JsonLd } from "../JsonLd";
import { siteUrl } from "../seo";
import { FilterPanel } from "./FilterPanel";
import { FiltersButton, FiltersShell } from "./MobileFilters";
import { SortSelect } from "./SortSelect";
import { listingTitle, searchListing, type ListingPreset } from "./listing-page";
import Image from "next/image";
import { getSiteFlag } from "@/server/site/public-flags";
import { ConciergeSearch } from "../sales/ConciergeSearch";
import { CompareTray } from "../sales/CompareControls";

export type { ListingPreset } from "./listing-page";

/** `sizes` de la grilla: 1 columna (gutter a cada lado) → 2 → con panel lateral 2 → 3; el contenedor tope es 1440 px. */
const GRID_SIZES = "(min-width: 1440px) 330px, (min-width: 1280px) 24vw, (min-width: 1024px) 36vw, (min-width: 640px) 46vw, 90vw";

function chipLabel(k: keyof SearchFilters, f: SearchFilters, names: { type: string | null; zone: string | null; area: string | null }): string | null {
  const money = (n: number) => new Intl.NumberFormat("es-AR").format(n);
  switch (k) {
    case "q":
      return f.q ? `“${f.q}”` : null;
    case "operacion":
      return f.operacion ? { venta: "Venta", alquiler: "Alquiler", temporario: "Temporario" }[f.operacion] : null;
    case "tipo":
      return names.type;
    case "zona":
      return names.zone;
    case "barrio":
      return names.area;
    case "moneda":
      return f.moneda ?? null;
    case "precio_min":
      return f.precio_min !== undefined ? `Desde ${money(f.precio_min)}` : null;
    case "precio_max":
      return f.precio_max !== undefined ? `Hasta ${money(f.precio_max)}` : null;
    case "dormitorios":
      return f.dormitorios ? `${f.dormitorios}+ dormitorios` : null;
    case "banos":
      return f.banos ? `${f.banos}+ baños` : null;
    case "cocheras":
      return f.cocheras ? `${f.cocheras}+ cocheras` : null;
    case "superficie_min":
      return f.superficie_min !== undefined ? `Desde ${money(f.superficie_min)} m²` : null;
    case "superficie_max":
      return f.superficie_max !== undefined ? `Hasta ${money(f.superficie_max)} m²` : null;
    case "credito":
      return f.credito ? "Apto crédito" : null;
    default:
      return null;
  }
}

function ListRow({ p, preload = false }: { p: PublicPropertyCard; preload?: boolean }) {
  return (
    <article className="card grid gap-4 border-b border-line pb-6 sm:grid-cols-[minmax(0,17rem)_1fr] sm:gap-6">
      <div className="media-frame relative aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] bg-paper-2">
        {p.cover ? <Image src={p.cover.url} alt={p.cover.alt} fill sizes="(min-width: 640px) 17rem, 90vw" className="card-img object-cover" loading={preload ? "eager" : "lazy"} fetchPriority={preload ? "high" : undefined} /> : null}
        <StatusBadge status={p.status} className="absolute left-3 top-3" />
      </div>
      <div className="flex flex-col">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">{p.zone.label ?? p.typeName}</p>
        <h2 className="mt-1.5 text-xl font-semibold leading-snug">
          <Link href={`/propiedades/${p.slug}`} className="card-link">
            {p.headline}
          </Link>
        </h2>
        {p.subtitle ? <p className="mt-1 text-sm text-ink-2">{p.subtitle}</p> : null}
        <Specs p={p} className="mt-3" />
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <PriceBlock prices={p.prices} />
          <span className="tabular text-xs text-ink-2">Cód. {p.code}</span>
        </div>
      </div>
    </article>
  );
}

export async function ListingView({ filters: f, preset, view }: { filters: SearchFilters; preset: ListingPreset; view: "grilla" | "lista" }) {
  const op = f.operacion ? OPERATION_SLUGS[f.operacion] : undefined;
  // Facetas dentro de la operación y el tipo vigentes: el panel no ofrece combinaciones sin resultados.
  const [result, facets, title, type, zoneName, areaName, conciergeOn, compareOn] = await Promise.all([
    searchListing(f),
    getSiteFacets(op, f.tipo),
    listingTitle(f),
    f.tipo ? getSiteType(f.tipo) : null,
    f.zona ? getSiteZoneName(f.zona) : null,
    f.barrio ? getSiteZoneName(f.zona, f.barrio) : null,
    getSiteFlag("ai_concierge"),
    getSiteFlag("site_compare"),
  ]);
  const omit = preset.lock;
  const href = (patch: Partial<SearchFilters>, extra: Record<string, string> = {}) => {
    const q = filtersToQuery({ ...f, ...patch }, omit);
    const params = new URLSearchParams(q.replace(/^\?/, ""));
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    const s = params.toString();
    return `${preset.basePath}${s ? `?${s}` : ""}`;
  };
  const viewExtra = view === "lista" ? { vista: "lista" } : ({} as Record<string, string>);
  const nActive = activeFilterCount(f, omit);
  const chipKeys: Array<keyof SearchFilters> = ["q", "operacion", "tipo", "zona", "barrio", "moneda", "precio_min", "precio_max", "dormitorios", "banos", "cocheras", "superficie_min", "superficie_max", "credito"];
  const names = { type: type?.plural ?? null, zone: zoneName, area: areaName };
  const chips = chipKeys
    .filter((k) => !omit.includes(k))
    .map((k) => ({ k, label: chipLabel(k, f, names) }))
    .filter((c): c is { k: keyof SearchFilters; label: string } => Boolean(c.label));
  const featureNames = new Map(facets.features.map((x) => [x.key, x.name]));
  const sortHrefs = Object.fromEntries(SORTS.map((s) => [s, href({ orden: s, pagina: 1 }, viewExtra)])) as Record<SortKey, string>;
  const empty = result.total === 0;
  const suggestions = empty ? await getSiteRecent(3) : [];
  const base = siteUrl();

  const selected = { type: f.tipo && type ? { key: f.tipo, plural: type.plural } : null, zone: f.zona && zoneName ? { slug: f.zona, name: zoneName } : null };

  return (
    <div className="container-site pb-24 pt-8 lg:pt-12">
      <nav aria-label="Migas de pan" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/propiedades" className="hover:underline" aria-current={preset.basePath === "/propiedades" && !nActive ? "page" : undefined}>
              Propiedades
            </Link>
          </li>
          {preset.basePath !== "/propiedades" ? (
            <>
              <li aria-hidden>/</li>
              <li aria-current="page">{preset.eyebrow}</li>
            </>
          ) : null}
        </ol>
      </nav>

      <header className="mt-6 flex flex-col gap-6 border-b border-line pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow text-brick">{preset.eyebrow}</p>
          <h1 className="display mt-4 text-[clamp(2.4rem,6vw,5rem)] leading-[0.98]">{title}</h1>
          <p className="tabular mt-3 text-ink-2" aria-live="polite" id="resultados-conteo">
            {plural(result.total, "propiedad encontrada", "propiedades encontradas")}
            {result.pageCount > 1 ? ` · página ${result.page} de ${result.pageCount}` : ""}
          </p>
        </div>
        {!omit.includes("operacion") ? (
          <nav aria-label="Operación" className="flex flex-wrap gap-2">
            {[
              { label: "Todas", value: undefined },
              { label: "Venta", value: "venta" as const },
              { label: "Alquiler", value: "alquiler" as const },
            ].map((o) => {
              const q = filtersToQuery({ ...f, operacion: undefined, pagina: 1 });
              const target = `/propiedades${o.value ? `/${o.value}` : ""}${q}`;
              return (
                <Link
                  key={o.label}
                  href={target}
                  aria-current={f.operacion === o.value ? "true" : undefined}
                  className={`btn min-h-11 border px-4 text-sm ${f.operacion === o.value ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink"}`}
                >
                  {o.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>

      {conciergeOn ? <ConciergeSearch variant="listing" page="listing" currentHref={`${preset.basePath}${filtersToQuery({ ...f, pagina: 1, orden: undefined }, omit)}`} /> : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[18.5rem_1fr] xl:grid-cols-[20rem_1fr]">
        {/* Un solo panel: columna lateral en desktop y diálogo a pantalla completa en mobile (sin JS, bloque visible). */}
        <FiltersShell>
          <FilterPanel facets={facets} filters={f} selected={selected} action={preset.basePath} lockOperation={omit.includes("operacion")} lockType={omit.includes("tipo")} idPrefix="f" />
        </FiltersShell>

        <section aria-labelledby="resultados-conteo" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="lg:hidden">
              <FiltersButton count={nActive} />
            </div>
            <form action={preset.basePath} method="get" className="flex items-center gap-2">
              {Object.entries(Object.fromEntries(new URLSearchParams(filtersToQuery({ ...f, orden: undefined, pagina: 1 }, omit).replace(/^\?/, "")))).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {view === "lista" ? <input type="hidden" name="vista" value="lista" /> : null}
              <label htmlFor="orden" className="text-sm text-ink-2">
                Ordenar
              </label>
              <SortSelect value={f.orden ?? "recientes"} hrefFor={sortHrefs} />
              <noscript>
                <button type="submit" className="btn btn-outline min-h-11 text-sm">
                  Ordenar
                </button>
              </noscript>
            </form>
            <div className="flex items-center gap-1" role="group" aria-label="Vista">
              <Link href={href({}, {})} aria-current={view === "grilla" ? "true" : undefined} className={`grid size-11 place-items-center rounded-full ${view === "grilla" ? "bg-ink text-paper" : "hover:bg-paper-2"}`} aria-label="Ver en grilla">
                <LayoutGrid aria-hidden className="size-5" />
              </Link>
              <Link href={href({}, { vista: "lista" })} aria-current={view === "lista" ? "true" : undefined} className={`grid size-11 place-items-center rounded-full ${view === "lista" ? "bg-ink text-paper" : "hover:bg-paper-2"}`} aria-label="Ver en lista">
                <List aria-hidden className="size-5" />
              </Link>
            </div>
          </div>

          {chips.length || f.caracteristicas.length ? (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Filtros activos">
              {chips.map((c) => (
                <li key={c.k}>
                  <Link href={href({ [c.k]: c.k === "credito" ? false : undefined, pagina: 1, ...(c.k === "zona" ? { barrio: undefined } : {}) } as Partial<SearchFilters>, viewExtra)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-paper-2 px-3 text-sm hover:bg-line">
                    {c.label}
                    <X aria-hidden className="size-3.5" />
                    <span className="sr-only">(quitar filtro)</span>
                  </Link>
                </li>
              ))}
              {f.caracteristicas.map((c) => (
                <li key={c}>
                  <Link href={href({ caracteristicas: f.caracteristicas.filter((x) => x !== c), pagina: 1 }, viewExtra)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-paper-2 px-3 text-sm hover:bg-line">
                    {featureNames.get(c) ?? c}
                    <X aria-hidden className="size-3.5" />
                    <span className="sr-only">(quitar filtro)</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link href={preset.basePath} className="inline-flex min-h-9 items-center px-2 text-sm font-semibold underline underline-offset-4">
                  Limpiar todo
                </Link>
              </li>
            </ul>
          ) : null}

          {empty ? (
            <div className="mt-10 rounded-[var(--radius-lg)] border border-line bg-white p-6 sm:p-10">
              <h2 className="display text-4xl">No encontramos propiedades con esos filtros.</h2>
              <p className="mt-3 max-w-xl text-ink-2">Probá quitar alguno de los filtros de arriba o ampliar la zona. Si buscás algo puntual, contanos: muchas propiedades se ofrecen antes de publicarse.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={preset.basePath} className="btn btn-ink">
                  Ver todas
                </Link>
                <Link href="/contacto" className="btn btn-outline">
                  Contanos qué buscás
                </Link>
              </div>
              {suggestions.length ? (
                <>
                  <p className="eyebrow mt-12 text-brick">Recién publicadas</p>
                  <ul className="mt-6 grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
                    {suggestions.map((p) => (
                      <li key={p.code}>
                        <PropertyCard p={p} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : view === "lista" ? (
            <ul className="mt-8 grid gap-6">
              {result.items.map((p, i) => (
                <li key={p.code}>
                  <ListRow p={p} preload={i === 0} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3">
              {result.items.map((p, i) => (
                <li key={p.code}>
                  <PropertyCard p={p} headingLevel={2} eager={i < 2} preload={i === 0} sizes={GRID_SIZES} compare={compareOn} />
                </li>
              ))}
            </ul>
          )}

          {result.pageCount > 1 ? (
            <nav aria-label="Paginación" className="mt-14 flex items-center justify-between gap-4 border-t border-line pt-6">
              {result.page > 1 ? (
                <Link href={href({ pagina: result.page - 1 }, viewExtra)} className="btn btn-outline" rel="prev">
                  <ChevronLeft aria-hidden className="size-4" /> Anterior
                </Link>
              ) : (
                <span />
              )}
              <ol className="hidden items-center gap-1 sm:flex">
                {Array.from({ length: result.pageCount }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === result.pageCount || Math.abs(n - result.page) <= 2)
                  .map((n, i, arr) => (
                    <li key={n} className="flex items-center gap-1">
                      {i > 0 && n - arr[i - 1]! > 1 ? <span aria-hidden className="px-1 text-ink-2">…</span> : null}
                      <Link
                        href={href({ pagina: n }, viewExtra)}
                        aria-current={n === result.page ? "page" : undefined}
                        aria-label={`Página ${n}`}
                        className={`tabular grid size-11 place-items-center rounded-full text-sm ${n === result.page ? "bg-ink text-paper" : "hover:bg-paper-2"}`}
                      >
                        {n}
                      </Link>
                    </li>
                  ))}
              </ol>
              <span className="tabular text-sm text-ink-2 sm:hidden">
                {result.page} / {result.pageCount}
              </span>
              {result.page < result.pageCount ? (
                <Link href={href({ pagina: result.page + 1 }, viewExtra)} className="btn btn-outline" rel="next">
                  Siguiente <ChevronRight aria-hidden className="size-4" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      </div>

      {compareOn ? <CompareTray /> : null}

      {!empty ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: title,
            numberOfItems: result.total,
            itemListElement: result.items.map((p, i) => ({ "@type": "ListItem", position: (result.page - 1) * result.pageSize + i + 1, url: `${base}/propiedades/${p.slug}`, name: p.headline })),
          }}
        />
      ) : null}
    </div>
  );
}
