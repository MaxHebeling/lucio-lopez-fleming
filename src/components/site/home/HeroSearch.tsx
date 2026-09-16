import { Search } from "lucide-react";
import type { Facets } from "@/server/properties/public";
import { plural } from "@/server/properties/public-helpers";

/**
 * Buscador del hero: formulario GET a /propiedades (funciona sin JS, URL compartible).
 * Opciones y conteos salen en vivo de la base.
 */
export function HeroSearch({ facets, contact }: { facets: Facets; contact: { label: string; href: string; external: boolean } | null }) {
  const count = (slug: string) => facets.operations.find((o) => o.slug === slug)?.count ?? 0;
  return (
    <form action="/propiedades" method="get" role="search" aria-label="Buscar propiedades" className="hero-search p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]">
        <div>
          <label htmlFor="hero-operacion" className="field-label !mb-1 px-1">
            Operación
          </label>
          <select id="hero-operacion" name="operacion" className="field-control" defaultValue="venta">
            <option value="venta">Comprar ({count("venta")})</option>
            <option value="alquiler">Alquilar ({count("alquiler")})</option>
            {count("temporario") ? <option value="temporario">Alquiler temporario ({count("temporario")})</option> : null}
            <option value="">Todas</option>
          </select>
        </div>
        <div>
          <label htmlFor="hero-tipo" className="field-label !mb-1 px-1">
            Tipo
          </label>
          <select id="hero-tipo" name="tipo" className="field-control" defaultValue="">
            <option value="">Todos los tipos</option>
            {facets.types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.plural} ({t.count})
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="hero-zona" className="field-label !mb-1 px-1">
            Zona
          </label>
          <select id="hero-zona" name="zona" className="field-control" defaultValue="">
            <option value="">Todas las zonas</option>
            {facets.zones.map((z) => (
              <option key={z.slug} value={z.slug}>
                {z.name} ({z.count})
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
        <p>{plural(facets.total, "propiedad publicada", "propiedades publicadas")} en este momento.</p>
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
