import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/server/db";
import { searchPublicProperties } from "@/server/properties/public";
import { filtersToQuery, fitTitle, parseSearchFilters, plural, withBrand, type SearchFilters } from "@/server/properties/public-helpers";
import { getSiteType, getSiteZoneName } from "@/server/site/public-data";
import { pageMetadata } from "../seo";

type SP = Record<string, string | string[] | undefined>;

export type ListingPreset = { basePath: string; lock: Array<keyof SearchFilters>; eyebrow: string };

export async function resolveListing(searchParams: Promise<SP>, preset: Partial<SearchFilters>) {
  await connection();
  const sp = await searchParams;
  const filters = parseSearchFilters(sp, preset);
  const view: "grilla" | "lista" = sp.vista === "lista" ? "lista" : "grilla";
  return { filters, view, sp };
}

/** Búsqueda memoizada por render: la metadata (canonical, título) y la página comparten el mismo resultado. */
export const listingResult = cache((key: string) => searchPublicProperties(getDb(), JSON.parse(key) as SearchFilters));
export const searchListing = (f: SearchFilters) => listingResult(JSON.stringify(f));

/** Título dinámico real: "Casas en venta en Villa San Lorenzo". */
export async function listingTitle(f: SearchFilters): Promise<string> {
  const [type, zone] = await Promise.all([f.tipo ? getSiteType(f.tipo) : null, getSiteZoneName(f.zona, f.barrio)]);
  let t = type ? type.plural : "Propiedades";
  if (f.operacion === "venta") t += " en venta";
  else if (f.operacion === "alquiler") t += " en alquiler";
  else if (f.operacion === "temporario") t += " en alquiler temporario";
  t += zone ? ` en ${zone}` : " en Salta";
  return t;
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

/** Dimensiones que forman listados indexables propios (tipo y localidad); el resto son refinamientos de esa página. */
const INDEXABLE_KEYS: Array<keyof SearchFilters> = ["tipo", "zona"];

/** Parte indexable de los filtros: tipo + localidad (sin las claves que fija la ruta) y la página. */
export function canonicalListingFilters(f: SearchFilters, lock: Array<keyof SearchFilters>): Partial<SearchFilters> {
  const out: Partial<SearchFilters> = { caracteristicas: [], pagina: f.pagina };
  for (const k of INDEXABLE_KEYS) if (!lock.includes(k) && f[k] !== undefined) (out as Record<string, unknown>)[k] = f[k];
  return out;
}

function hasRefinements(f: SearchFilters, lock: Array<keyof SearchFilters>): boolean {
  const keys: Array<keyof SearchFilters> = ["q", "barrio", "moneda", "precio_min", "precio_max", "dormitorios", "banos", "cocheras", "superficie_min", "superficie_max", "orden"];
  if (!lock.includes("operacion") && f.operacion) return true;
  return f.credito || f.caracteristicas.length > 0 || keys.some((k) => f[k] !== undefined && !(k === "orden" && f.orden === "recientes"));
}

/**
 * Metadata de listados:
 * - Operación + tipo y/o localidad con resultados → URL canónica propia (`/propiedades/venta?tipo=casa&zona=salta`),
 *   indexable y en el sitemap. Página > 1: "· Página N" en el título y canonical con su página.
 * - Con refinamientos (precio, dormitorios, texto, orden…) → canonical a esa combinación de tipo/localidad, noindex.
 * - Sin resultados → noindex, canonical al listado base.
 */
export async function listingMetadata(searchParams: Promise<SP>, preset: Partial<SearchFilters>, p: ListingPreset, description: string): Promise<Metadata> {
  const { filters } = await resolveListing(searchParams, preset);
  const [base, result] = await Promise.all([listingTitle(filters), searchListing(filters)]);
  const page = Math.min(filters.pagina, result.pageCount);
  const refined = hasRefinements(filters, p.lock);
  const empty = result.total === 0;
  const canonical = empty ? p.basePath : `${p.basePath}${filtersToQuery({ ...canonicalListingFilters(filters, p.lock), pagina: page })}`;
  const paged = page > 1 ? ` · Página ${page}` : "";
  const title = fitTitle([`${base}${paged}`, base]);
  const combo = Boolean(filters.tipo && !p.lock.includes("tipo")) || Boolean(filters.zona);
  const desc = combo && !empty ? `${base}: ${plural(result.total, "propiedad publicada", "propiedades publicadas")} con fotos, precio y datos claros. Lucio López Fleming Inmobiliaria.` : description;
  return {
    ...pageMetadata({ title: withBrand(title), description: desc, path: canonical, noindex: refined || empty }),
    title: { absolute: withBrand(title) },
  };
}
