import type { Metadata } from "next";
import { ListingView, type ListingPreset } from "@/components/site/listing/ListingView";
import { listingMetadata, resolveListing } from "@/components/site/listing/listing-page";

const PRESET: ListingPreset = { basePath: "/propiedades/alquiler", lock: ["operacion"], eyebrow: "Alquiler" };

export function generateMetadata({ searchParams }: PageProps<"/propiedades/alquiler">): Promise<Metadata> {
  return listingMetadata(searchParams, { operacion: "alquiler" }, PRESET, "Casas, departamentos, oficinas y locales en alquiler en Salta, con precio y datos claros. Inmobiliaria Lucio López Fleming, desde 1974.");
}

export default async function AlquilerPage({ searchParams }: PageProps<"/propiedades/alquiler">) {
  const { filters, view } = await resolveListing(searchParams, { operacion: "alquiler" });
  return <ListingView filters={filters} preset={PRESET} view={view} />;
}
