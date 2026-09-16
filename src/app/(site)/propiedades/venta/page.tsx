import type { Metadata } from "next";
import { ListingView, type ListingPreset } from "@/components/site/listing/ListingView";
import { listingMetadata, normalizeListingUrl, resolveListing } from "@/components/site/listing/listing-page";

const PRESET: ListingPreset = { basePath: "/propiedades/venta", lock: ["operacion"], eyebrow: "Venta" };

export function generateMetadata({ searchParams }: PageProps<"/propiedades/venta">): Promise<Metadata> {
  return listingMetadata(searchParams, { operacion: "venta" }, PRESET, "Casas, departamentos, terrenos y locales en venta en Salta, con precio y datos claros. Inmobiliaria Lucio López Fleming, desde 1974.");
}

export default async function VentaPage({ searchParams }: PageProps<"/propiedades/venta">) {
  const { filters, view, sp } = await resolveListing(searchParams, { operacion: "venta" });
  normalizeListingUrl(PRESET.basePath, sp, filters, PRESET.lock, view);
  return <ListingView filters={filters} preset={PRESET} view={view} />;
}
