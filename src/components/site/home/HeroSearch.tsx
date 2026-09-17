"use client";

import { useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Facets } from "@/server/properties/public";

type OperationSlug = "venta" | "alquiler" | "temporario";
type Options = {
  operations: Array<{ slug: OperationSlug; count: number }>;
  types: Array<{ key: string; plural: string; count: number }>;
  zones: Array<{ slug: string; name: string; count: number }>;
};

const nf = new Intl.NumberFormat("es-AR");

/**
 * Topes de precio del buscador (parámetros reales del listado: `moneda` + `precio_max`, ver searchFiltersSchema).
 * Son escalones de interfaz, no datos: la venta se publica en dólares y el alquiler mayormente en pesos. Con "Todas"
 * las operaciones o temporario no se ofrece precio (mezclaría monedas).
 */
const PRICE_STEPS: Partial<Record<OperationSlug, { currency: "USD" | "ARS"; steps: number[] }>> = {
  venta: { currency: "USD", steps: [50_000, 100_000, 150_000, 250_000, 400_000, 700_000] },
  alquiler: { currency: "ARS", steps: [400_000, 700_000, 1_000_000, 1_500_000, 2_500_000] },
};

/**
 * Buscador de la portada: barra única (Operación · Zona · Tipo · Precio) que envía un GET a /propiedades (funciona sin
 * JS, URL compartible). Opciones y conteos en vivo: el servidor la entrega con las facetas de la operación por defecto
 * (venta); con JS, al cambiar operación o tipo se piden las de esa combinación (/api/site/facets) y lo elegido que deja
 * de existir vuelve a "Todos".
 */
export function HeroSearch({ facets, total }: { facets: Facets; total: number }) {
  const [options, setOptions] = useState<Options>({
    operations: facets.operations,
    types: facets.types.map((t) => ({ key: t.key, plural: t.plural, count: t.count })),
    zones: facets.zones.map((z) => ({ slug: z.slug, name: z.name, count: z.count })),
  });
  const [operacion, setOperacion] = useState<string>("venta");
  const [tipo, setTipo] = useState("");
  const [zona, setZona] = useState("");
  const [precio, setPrecio] = useState("");
  const [loading, setLoading] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  const reload = async (op: string, type: string) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch(`/api/site/facets?operacion=${encodeURIComponent(op)}&tipo=${encodeURIComponent(type)}`, { signal: ctrl.signal });
      if (!res.ok) return;
      const next = (await res.json()) as Options;
      setOptions(next);
      if (type && !next.types.some((t) => t.key === type)) setTipo("");
      setZona((z) => (z && !next.zones.some((x) => x.slug === z) ? "" : z));
    } catch (e) {
      // Abortado por un cambio más nuevo, o sin red: quedan las opciones anteriores (el listado igual muestra un estado vacío útil).
      if ((e as Error).name !== "AbortError") console.warn("[buscador] no se pudieron actualizar las opciones", e);
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  };

  const count = (slug: OperationSlug) => options.operations.find((o) => o.slug === slug)?.count ?? 0;
  const opOption = (value: OperationSlug, label: string) => {
    const n = count(value);
    if (value === "temporario" && !n && operacion !== "temporario") return null;
    return (
      <option value={value} disabled={!n && operacion !== value}>
        {label} ({nf.format(n)})
      </option>
    );
  };
  const price = PRICE_STEPS[operacion as OperationSlug] ?? null;

  return (
    <form action="/propiedades" method="get" role="search" aria-label="Buscar propiedades" className="search-bar" aria-busy={loading || undefined}>
      <div className="search-row">
      <div className="search-fields">
        <div className="search-field">
          <label htmlFor="hero-operacion">Operación</label>
          <select
            id="hero-operacion"
            name="operacion"
            value={operacion}
            onChange={(e) => {
              setOperacion(e.target.value);
              setPrecio("");
              void reload(e.target.value, tipo);
            }}
          >
            {opOption("venta", "Comprar")}
            {opOption("alquiler", "Alquilar")}
            {opOption("temporario", "Alquiler temporario")}
            <option value="">Todas</option>
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="hero-zona">Ubicación</label>
          <select id="hero-zona" name="zona" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Todas las zonas</option>
            {options.zones.map((z) => (
              <option key={z.slug} value={z.slug}>
                {z.name} ({nf.format(z.count)})
              </option>
            ))}
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="hero-tipo">Tipo</label>
          <select
            id="hero-tipo"
            name="tipo"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              void reload(operacion, e.target.value);
            }}
          >
            <option value="">Todos los tipos</option>
            {options.types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.plural} ({nf.format(t.count)})
              </option>
            ))}
          </select>
        </div>
        <div className="search-field" data-disabled={price ? undefined : ""}>
          <label htmlFor="hero-precio">Precio hasta</label>
          <select id="hero-precio" name="precio_max" value={price ? precio : ""} disabled={!price} onChange={(e) => setPrecio(e.target.value)}>
            <option value="">{price ? "Sin tope" : "Elegí la operación"}</option>
            {price?.steps.map((n) => (
              <option key={n} value={n}>
                {price.currency === "USD" ? "USD" : "$"} {nf.format(n)}
              </option>
            ))}
          </select>
          {/* La moneda viaja solo con un tope elegido: sin precio la búsqueda no se limita a una moneda. */}
          <input type="hidden" name="moneda" value={price?.currency ?? ""} disabled={!price || !precio} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary search-submit">
        <Search aria-hidden className="size-5" /> Buscar
      </button>
      </div>
      <p className="search-meta">
        <span className="tabular">{nf.format(total)}</span> {total === 1 ? "propiedad publicada" : "propiedades publicadas"} hoy
      </p>
    </form>
  );
}
