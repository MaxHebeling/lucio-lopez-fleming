import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { filtersToQuery, parseSearchFilters, type SearchFilters } from "@/server/properties/public-helpers";
import { pageMetadata } from "../seo";
import { listingTitle, type ListingPreset } from "./ListingView";

type SP = Record<string, string | string[] | undefined>;

export async function resolveListing(searchParams: Promise<SP>, preset: Partial<SearchFilters>) {
  await connection();
  const sp = await searchParams;
  const filters = parseSearchFilters(sp, preset);
  const view: "grilla" | "lista" = sp.vista === "lista" ? "lista" : "grilla";
  return { filters, view, sp };
}

/**
 * El formulario GET envía también los campos vacíos (?q=&zona=…). Se normaliza a la URL limpia y estable
 * (sin JS, un solo salto) para que el link compartible sea legible y no duplique URLs.
 */
export function normalizeListingUrl(basePath: string, sp: SP, filters: SearchFilters, lock: Array<keyof SearchFilters>, view: "grilla" | "lista") {
  const hasEmpty = Object.values(sp).some((v) => v === "" || (Array.isArray(v) && v.some((x) => x === "")));
  const repeated = Object.values(sp).some((v) => Array.isArray(v));
  if (!hasEmpty && !repeated) return;
  const q = filtersToQuery(filters, lock);
  const extra = view === "lista" ? `${q ? "&" : "?"}vista=lista` : "";
  redirect(`${basePath}${q}${extra}`);
}

/** Canonical: ruta base (+ página). Las combinaciones de filtros apuntan al listado base para no diluir el SEO. */
export async function listingMetadata(searchParams: Promise<SP>, preset: Partial<SearchFilters>, p: ListingPreset, description: string): Promise<Metadata> {
  const { filters } = await resolveListing(searchParams, preset);
  const title = await listingTitle(filters);
  const onlyPreset = Object.entries(await searchParams).every(([k]) => k === "pagina");
  const path = `${p.basePath}${filters.pagina > 1 && onlyPreset ? `?pagina=${filters.pagina}` : ""}`;
  return pageMetadata({ title, description, path });
}
