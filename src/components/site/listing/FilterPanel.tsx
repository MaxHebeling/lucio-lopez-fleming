import type { Facets } from "@/server/properties/public";
import type { SearchFilters } from "@/server/properties/public-helpers";

type Props = {
  facets: Facets;
  filters: SearchFilters;
  /** Tipo y localidad elegidos (con nombre) aunque hoy no tengan resultados: se muestran marcados y en 0, no desaparecen. */
  selected?: { type: { key: string; plural: string } | null; zone: { slug: string; name: string } | null };
  action: string;
  lockOperation: boolean;
  lockType: boolean;
  idPrefix: string;
};

const MIN_OPTIONS = [1, 2, 3, 4, 5];

/**
 * Filtros completos como formulario GET (URL compartible, funciona sin JS). Conteos en vivo desde la base, calculados
 * dentro de la operación y el tipo elegidos: tipos, localidades, barrios y características sin resultados no se ofrecen.
 * Las claves que fija la ruta (p. ej. operación en /propiedades/venta) no se repiten en la URL.
 */
export function FilterPanel({ facets, filters: f, selected, action, lockOperation, lockType, idPrefix }: Props) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const zoneForAreas = facets.zones.filter((z) => z.areas.length);
  const missingType = selected?.type && !facets.types.some((t) => t.key === selected.type!.key) ? selected.type : null;
  const missingZone = selected?.zone && !facets.zones.some((z) => z.slug === selected.zone!.slug) ? selected.zone : null;
  return (
    <form action={action} method="get" className="grid gap-6" aria-label="Filtros de búsqueda">
      <div>
        <label htmlFor={id("q")} className="field-label">
          Palabra clave o código
        </label>
        <input id={id("q")} name="q" type="search" defaultValue={f.q ?? ""} maxLength={80} placeholder="Ej.: pileta, 2605" className="field-control" />
      </div>

      {!lockOperation ? (
        <fieldset>
          <legend className="field-label">Operación</legend>
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: "", label: "Todas" },
              { v: "venta", label: "Venta" },
              { v: "alquiler", label: "Alquiler" },
            ].map((o) => (
              <label key={o.v} className="relative">
                <input type="radio" name="operacion" value={o.v} defaultChecked={(f.operacion ?? "") === o.v} className="peer sr-only" />
                <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-line bg-white px-2 text-sm font-medium peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brick">
                  {o.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {!lockType ? (
        <div>
          <label htmlFor={id("tipo")} className="field-label">
            Tipo de propiedad
          </label>
          <select id={id("tipo")} name="tipo" defaultValue={f.tipo ?? ""} className="field-control">
            <option value="">Todos</option>
            {missingType ? <option value={missingType.key}>{missingType.plural} (0)</option> : null}
            {facets.types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.plural} ({t.count})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid gap-4">
        <div>
          <label htmlFor={id("zona")} className="field-label">
            Localidad
          </label>
          <select id={id("zona")} name="zona" defaultValue={f.zona ?? ""} className="field-control">
            <option value="">Todas</option>
            {missingZone ? <option value={missingZone.slug}>{missingZone.name} (0)</option> : null}
            {facets.zones.map((z) => (
              <option key={z.slug} value={z.slug}>
                {z.name} ({z.count})
              </option>
            ))}
          </select>
        </div>
        {zoneForAreas.length ? (
          <div>
            <label htmlFor={id("barrio")} className="field-label">
              Barrio o urbanización
            </label>
            <select id={id("barrio")} name="barrio" defaultValue={f.barrio ?? ""} className="field-control">
              <option value="">Todos</option>
              {zoneForAreas.map((z) => (
                <optgroup key={z.slug} label={z.name}>
                  {z.areas.map((a) => (
                    <option key={`${z.slug}-${a.slug}`} value={a.slug}>
                      {a.name} ({a.count})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <fieldset>
        <legend className="field-label">Precio</legend>
        <div className="grid grid-cols-[6.75rem_1fr_1fr] gap-2">
          <select name="moneda" defaultValue={f.moneda ?? ""} className="field-control" aria-label="Moneda">
            <option value="">Moneda</option>
            <option value="USD">USD</option>
            <option value="ARS">$</option>
          </select>
          <input name="precio_min" type="number" inputMode="numeric" min={0} step="any" defaultValue={f.precio_min ?? ""} placeholder="Mín." aria-label="Precio mínimo" className="field-control" />
          <input name="precio_max" type="number" inputMode="numeric" min={0} step="any" defaultValue={f.precio_max ?? ""} placeholder="Máx." aria-label="Precio máximo" className="field-control" />
        </div>
      </fieldset>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["dormitorios", "Dormit."],
            ["banos", "Baños"],
            ["cocheras", "Cocheras"],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <label htmlFor={id(k)} className="field-label">
              {label}
            </label>
            <select id={id(k)} name={k} defaultValue={f[k] ? String(f[k]) : ""} className="field-control !px-2.5">
              <option value="">Todos</option>
              {MIN_OPTIONS.slice(0, k === "dormitorios" ? 5 : 4).map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <fieldset>
        <legend className="field-label">Superficie (m²)</legend>
        <div className="grid grid-cols-2 gap-2">
          <input name="superficie_min" type="number" inputMode="numeric" min={0} defaultValue={f.superficie_min ?? ""} placeholder="Desde" aria-label="Superficie mínima en m²" className="field-control" />
          <input name="superficie_max" type="number" inputMode="numeric" min={0} defaultValue={f.superficie_max ?? ""} placeholder="Hasta" aria-label="Superficie máxima en m²" className="field-control" />
        </div>
      </fieldset>

      <label className="flex min-h-11 items-center gap-3 text-[0.95rem]">
        <input type="checkbox" name="credito" value="1" defaultChecked={f.credito} className="size-5 accent-[var(--ink)]" />
        Apto crédito
      </label>

      {facets.features.length ? (
        <details className="group border-t border-line pt-4" open={f.caracteristicas.length > 0}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold">
            Características{f.caracteristicas.length ? ` (${f.caracteristicas.length})` : ""}
            <span aria-hidden className="text-xl transition-transform group-open:rotate-45">+</span>
          </summary>
          <fieldset className="mt-2">
            <legend className="sr-only">Características</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {facets.features.map((c) => (
                <label key={c.key} className="flex min-h-10 items-center gap-3 text-sm">
                  <input type="checkbox" name="caracteristicas" value={c.key} defaultChecked={f.caracteristicas.includes(c.key)} className="size-4 accent-[var(--ink)]" />
                  {c.name} <span className="text-ink-2">({c.count})</span>
                </label>
              ))}
            </div>
          </fieldset>
        </details>
      ) : null}

      {f.orden && f.orden !== "recientes" ? <input type="hidden" name="orden" value={f.orden} /> : null}

      <div className="sticky bottom-0 -mx-1 flex gap-2 bg-inherit px-1 pb-1 pt-2">
        <button type="submit" className="btn btn-ink flex-1">
          Aplicar filtros
        </button>
        <a href={action} className="btn btn-outline">
          Limpiar
        </a>
      </div>
    </form>
  );
}
