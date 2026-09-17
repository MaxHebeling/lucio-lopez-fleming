import type { MetadataRoute } from "next";
import { filtersToQuery } from "@/server/properties/public-helpers";
import { getSiteListingCombinations, getSiteSitemapProperties } from "@/server/site/public-data";
import { siteUrl } from "@/components/site/seo";

/** Se sirve desde caché y se regenera al invalidar el sitio o a los 5 minutos. */
export const revalidate = 300;

/** El generador de Next no escapa las URL: `&` debe ir como entidad XML. */
const xmlUrl = (u: string) => u.replace(/&/g, "&amp;");

/**
 * Sitemap dinámico: páginas institucionales, listados, listados por tipo y/o localidad con resultados (sus URL
 * canónicas, ver listingMetadata) y fichas publicadas (lastModified real).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [props, combos] = await Promise.all([getSiteSitemapProperties(), getSiteListingCombinations()]);
  const latest = props.reduce<Date | undefined>((acc, p) => (!acc || p.updatedAt > acc ? p.updatedAt : acc), undefined);
  const statics: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: latest, changeFrequency: "daily", priority: 1 },
    { url: `${base}/propiedades`, lastModified: latest, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/propiedades/venta`, lastModified: latest, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/propiedades/alquiler`, lastModified: latest, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/emprendimientos`, lastModified: latest, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/tasaciones`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/empresa`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contacto`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/terminos`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.1 },
  ];
  const listings: MetadataRoute.Sitemap = combos.map((c) => ({
    url: xmlUrl(`${base}/propiedades/${c.operation}${filtersToQuery({ tipo: c.typeKey ?? undefined, zona: c.zoneSlug ?? undefined, caracteristicas: [], pagina: 1 })}`),
    lastModified: new Date(c.updatedAt),
    changeFrequency: "daily" as const,
    priority: c.typeKey && c.zoneSlug ? 0.6 : 0.7,
  }));
  return [...statics, ...listings, ...props.map((p) => ({ url: `${base}/propiedades/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 }))];
}
