/**
 * Lecturas del sitio público con caché de datos de Next (`unstable_cache`, el mecanismo soportado sin
 * `cacheComponents`), etiquetadas para invalidarse al instante desde el CRM (ver revalidate.ts) y con vencimiento de
 * respaldo de SITE_REVALIDATE_SECONDS. Envueltas además en React `cache` para no repetir la misma lectura dentro de un
 * render (metadata + página + layout).
 *
 * Los resultados pasan por JSON: solo tipos serializables (las fechas viajan como texto ISO).
 */
import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { connection } from "next/server";
import { getDb } from "../db";
import { errorFields, log } from "../log";
import {
  getPublicFacets,
  getPublicPropertyBySlug,
  getPublicType,
  getRecentProperties,
  getShowcaseProperties,
  getSimilarProperties,
  getZoneName,
  listPublishedForSitemap,
  type Facets,
  type PublicPropertyDetail,
  type ZoneCount,
} from "../properties/public";
import { getZoneShowcase, listListingCombinations, resolveLegacyTarget } from "../properties/public-home";
import type { PublicOperation } from "../properties/public-helpers";
import { SITE_CACHE_TAGS, SITE_REVALIDATE_SECONDS } from "./revalidate";

const PROPERTIES = { tags: [SITE_CACHE_TAGS.properties], revalidate: SITE_REVALIDATE_SECONDS };

/**
 * Las páginas estáticas/ISR se prerenderizan en `next build`. Si ahí la base no responde, la ruta pasa a renderizarse
 * en cada petición (como antes de la caché) en lugar de romper el build.
 */
export async function readPublic<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      log.warn("site.build_read_failed_route_dynamic", errorFields(e));
      await connection();
    }
    throw e;
  }
}

// ───────── Facetas ─────────

const facetsCached = unstable_cache(
  async (operation: PublicOperation | null, typeKey: string | null) => getPublicFacets(getDb(), operation ?? undefined, typeKey ?? undefined),
  ["site", "facets", "v2"],
  PROPERTIES,
);
/**
 * Facetas dentro de la operación y el tipo vigentes. El tipo sale de la URL: solo se usa como clave de caché si existe
 * entre los tipos publicados de esa operación (un tipo inventado no llena la caché; no tiene resultados).
 */
export const getSiteFacets = cache(async (operation?: PublicOperation, typeKey?: string): Promise<Facets> => {
  const base = await readPublic(() => facetsCached(operation ?? null, null));
  if (!typeKey) return base;
  if (!base.types.some((t) => t.key === typeKey)) return { ...base, operations: [], zones: [], features: [], total: 0 };
  return readPublic(() => facetsCached(operation ?? null, typeKey));
});

// ───────── Home ─────────

const showcaseCached = unstable_cache(
  async (limit: number, preferCoverWidth: number | null) => getShowcaseProperties(getDb(), limit, preferCoverWidth ? { preferCoverWidth } : {}),
  ["site", "showcase", "v3"],
  PROPERTIES,
);
export const getSiteShowcase = cache((limit: number, preferCoverWidth?: number) => readPublic(() => showcaseCached(limit, preferCoverWidth ?? null)));

const recentCached = unstable_cache(async (limit: number, excludeCodes: number[]) => getRecentProperties(getDb(), limit, excludeCodes), ["site", "recent", "v2"], PROPERTIES);
export const getSiteRecent = (limit: number, excludeCodes: number[] = []) => readPublic(() => recentCached(limit, [...excludeCodes].sort((a, b) => a - b)));

const zonesCached = unstable_cache(async (top: ZoneCount[]) => getZoneShowcase(getDb(), { zones: top }, top.length), ["site", "zones", "v3"], PROPERTIES);
/** Portadas por zona a partir de las facetas ya leídas (no se recuentan). */
export const getSiteZoneShowcase = (zones: ZoneCount[], limit: number) => readPublic(() => zonesCached(zones.slice(0, limit)));

// ───────── Ficha ─────────

const propertyCached = unstable_cache(async (slug: string) => getPublicPropertyBySlug(getDb(), slug), ["site", "property", "v2"], PROPERTIES);
export const getSiteProperty = cache((slug: string) => readPublic(() => propertyCached(slug)));

const similarCached = unstable_cache(
  async (p: Pick<PublicPropertyDetail, "code" | "typeKey" | "typeCategory" | "zone" | "prices">, limit: number) => getSimilarProperties(getDb(), p as PublicPropertyDetail, limit),
  ["site", "similar", "v2"],
  PROPERTIES,
);
export const getSiteSimilar = (p: PublicPropertyDetail, limit: number) =>
  readPublic(() => similarCached({ code: p.code, typeKey: p.typeKey, typeCategory: p.typeCategory, zone: p.zone, prices: p.prices.slice(0, 1) }, limit));

// ───────── Listados (títulos) ─────────
// Sin caché de datos: las claves salen de la URL (cualquier slug) y ambas son lecturas chicas (tipo por PK, árbol de
// ubicaciones ya en memoria). Solo se evita repetirlas dentro del mismo render.

export const getSiteType = cache((key: string) => getPublicType(getDb(), key));
export const getSiteZoneName = cache((zona?: string, barrio?: string) => (zona || barrio ? getZoneName(getDb(), zona, barrio) : Promise.resolve(null)));

// ───────── Sitemap y sitio anterior ─────────

const sitemapCached = unstable_cache(
  async () => (await listPublishedForSitemap(getDb())).map((p) => ({ slug: p.slug, updatedAt: p.updatedAt.toISOString() })),
  ["site", "sitemap", "v1"],
  PROPERTIES,
);
export const getSiteSitemapProperties = async () => (await readPublic(sitemapCached)).map((p) => ({ slug: p.slug, updatedAt: new Date(p.updatedAt) }));

const combinationsCached = unstable_cache(async () => listListingCombinations(getDb()), ["site", "listing-combinations", "v1"], PROPERTIES);
export const getSiteListingCombinations = () => readPublic(combinationsCached);

/** Sin caché: la clave la elige quien escribe la URL (un código cualquiera) y es una sola consulta indexada. */
export const getSiteLegacyTarget = (path: string) => resolveLegacyTarget(getDb(), path);
