import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { ListingView, type ListingPreset } from "@/components/site/listing/ListingView";
import { listingMetadata, resolveListing } from "@/components/site/listing/listing-page";
import { filtersToQuery } from "@/server/properties/public-helpers";

const PRESET: ListingPreset = { basePath: "/propiedades", lock: [], eyebrow: "Propiedades" };

export function generateMetadata({ searchParams }: PageProps<"/propiedades">): Promise<Metadata> {
  return listingMetadata(searchParams, {}, PRESET, "Casas, departamentos, terrenos, locales y oficinas en venta y alquiler en Salta. Filtrá por zona, precio, ambientes y características.");
}

export default async function PropiedadesPage({ searchParams }: PageProps<"/propiedades">) {
  const { filters, view } = await resolveListing(searchParams, {});
  // /propiedades?operacion=venta → /propiedades/venta (una sola URL por listado)
  if (filters.operacion === "venta" || filters.operacion === "alquiler") {
    const rest = filtersToQuery({ ...filters, operacion: undefined });
    const extra = view === "lista" ? `${rest ? "&" : "?"}vista=lista` : "";
    permanentRedirect(`/propiedades/${filters.operacion}${rest}${extra}`);
  }
  return <ListingView filters={filters} preset={PRESET} view={view} />;
}
