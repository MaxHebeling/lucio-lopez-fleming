import type { Metadata } from "next";
import { ListingView, type ListingPreset } from "@/components/site/listing/ListingView";
import { listingMetadata, normalizeListingUrl, resolveListing } from "@/components/site/listing/listing-page";

const PRESET: ListingPreset = { basePath: "/emprendimientos", lock: ["tipo"], eyebrow: "Emprendimientos" };

export function generateMetadata({ searchParams }: PageProps<"/emprendimientos">): Promise<Metadata> {
  return listingMetadata(searchParams, { tipo: "emprendimiento" }, PRESET, "Emprendimientos y desarrollos inmobiliarios en Salta: unidades, fechas de posesión y precios publicados.");
}

export default async function EmprendimientosPage({ searchParams }: PageProps<"/emprendimientos">) {
  const { filters, view, sp } = await resolveListing(searchParams, { tipo: "emprendimiento" });
  normalizeListingUrl(PRESET.basePath, sp, filters, PRESET.lock, view);
  return <ListingView filters={filters} preset={PRESET} view={view} />;
}
