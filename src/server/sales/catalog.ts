/**
 * Catálogo REAL contra el que se validan la intención del concierge y las preferencias del perfil:
 * tipos activos (con su inventario publicado), localidades y barrios con propiedades publicadas (mismas facetas que el
 * buscador) y el catálogo completo de características. Caché en memoria corta (cambia poco).
 */
import "server-only";
import type { Executor } from "../db";
import { getPublicFacets } from "../properties/public";
import type { SalesCatalog } from "./intent/schema";

const TTL_MS = 5 * 60_000;
let cached: { at: number; catalog: SalesCatalog } | undefined;

export async function loadSalesCatalog(db: Executor): Promise<SalesCatalog> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.catalog;
  const [facets, types, features] = await Promise.all([
    getPublicFacets(db),
    db.selectFrom("property_types").select(["key", "name", "name_plural"]).where("is_active", "=", true).orderBy("sort_order").execute(),
    db.selectFrom("features").select(["key", "name"]).orderBy("sort_order").orderBy("name").execute(),
  ]);
  const counts = new Map(facets.types.map((t) => [t.key, t.count]));
  const catalog: SalesCatalog = {
    types: types.map((t) => ({ key: t.key, name: t.name, plural: t.name_plural, count: counts.get(t.key) ?? 0 })),
    localities: facets.zones.map((z) => ({ slug: z.slug, name: z.name, count: z.count })),
    areas: facets.zones.flatMap((z) => z.areas.map((a) => ({ slug: a.slug, name: a.name, localitySlug: z.slug, localityName: z.name, count: a.count }))),
    features: features.map((f) => ({ key: f.key, name: f.name })),
  };
  cached = { at: Date.now(), catalog };
  return catalog;
}

export function resetSalesCatalogCache(): void {
  cached = undefined;
}
