"use client";

import { useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Facets } from "@/server/properties/public";

type Options = {
  operations: Array<{ slug: "venta" | "alquiler" | "temporario"; count: number }>;
  types: Array<{ key: string; plural: string; count: number }>;
  zones: Array<{ slug: string; name: string; count: number }>;
};

const nf = new Intl.NumberFormat("es-AR");

/**
 * Buscador del hero: formulario GET a /propiedades (funciona sin JS, URL compartible). Opciones y conteos en vivo.
 * El servidor lo entrega con las opciones de la operación por defecto (venta); con JS, al cambiar operación o tipo se
 * piden las opciones de esa combinación (/api/site/facets): nunca se ofrecen tipos o zonas sin propiedades, y lo
 * elegido que deja de existir vuelve a "Todos".
 */
export function HeroSearch({ facets, total, contact }: { facets: Facets; total: number; contact: { label: string; href: string; external: boolean } | null }) {
  const [options, setOptions] = useState<Options>({
    operations: facets.operations,
    types: facets.types.map((t) => ({ key: t.key, plural: t.plural, count: t.count })),
    zones: facets.zones.map((z) => ({ slug: z.slug, name: z.name, count: z.count })),
  });
  const [operacion, setOperacion] = useState("venta");
  const [tipo, setTipo] = useState("");
  const [zona, setZona] = useState("");
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
      if ((e as Error).name !== "AbortError") console.warn("[hero] no se pudieron actualizar las opciones", e);
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  };

  const count = (slug: string) => options.operations.find((o) => o.slug === slug)?.count ?? 0;
  const opOption = (value: "venta" | "alquiler" | "temporario", label: string) => {
    const n = count(value);
    if (value === "temporario" && !n && operacion !== "temporario") return null;
    return (
      <option value={value} disabled={!n && operacion !== value}>
        {label} ({nf.format(n)})
      </option>
    );
  };

  return (
    <form action="/propiedades" method="get" role="search" aria-label="Buscar propiedades" className="hero-search p-3 sm:p-4" aria-busy={loading || undefined}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]">
        <div>
          <label htmlFor="hero-operacion" className="field-label !mb-1 px-1">
            Operación
          </label>
          <select
            id="hero-operacion"
            name="operacion"
            className="field-control"
            value={operacion}
            onChange={(e) => {
              setOperacion(e.target.value);
              void reload(e.target.value, tipo);
            }}
          >
            {opOption("venta", "Comprar")}
            {opOption("alquiler", "Alquilar")}
            {opOption("temporario", "Alquiler temporario")}
            <option value="">Todas</option>
          </select>
        </div>
        <div>
          <label htmlFor="hero-tipo" className="field-label !mb-1 px-1">
            Tipo
          </label>
          <select
            id="hero-tipo"
            name="tipo"
            className="field-control"
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
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="hero-zona" className="field-label !mb-1 px-1">
            Zona
          </label>
          <select id="hero-zona" name="zona" className="field-control" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Todas las zonas</option>
            {options.zones.map((z) => (
              <option key={z.slug} value={z.slug}>
                {z.name} ({nf.format(z.count)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
          <button type="submit" className="btn btn-primary w-full lg:w-auto" data-magnetic>
            <Search aria-hidden className="size-5" /> Buscar
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs text-ink-2">
        <p>
          {nf.format(total)} {total === 1 ? "propiedad publicada" : "propiedades publicadas"} en este momento.
        </p>
        {contact ? (
          <p>
            ¿Preferís hablar?{" "}
            <a href={contact.href} {...(contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="inline-flex min-h-6 items-center font-semibold text-ink underline underline-offset-2">
              {contact.label}
            </a>
          </p>
        ) : null}
      </div>
    </form>
  );
}
