import type { ZoneShowcase } from "@/server/properties/public-home";

export type TerritoryFeature = { zoneName: string; zoneSlug: string; url: string };

/**
 * Foto del territorio elegida por datos: la portada de la zona con más propiedades publicadas cuya localidad no es la
 * ciudad de la casa central (en el inventario real, el valle con cerros). Si no hay otra, la de la primera zona.
 */
export function pickTerritoryFeature(zones: ZoneShowcase[], mainCity: string | null): TerritoryFeature | null {
  const same = (a: string, b: string | null) => Boolean(b) && a.localeCompare(b!, "es", { sensitivity: "base" }) === 0;
  const withCover = zones.filter((z) => z.cover);
  const z = withCover.find((x) => !same(x.name, mainCity)) ?? withCover[0];
  return z?.cover ? { zoneName: z.name, zoneSlug: z.slug, url: z.cover.url } : null;
}
