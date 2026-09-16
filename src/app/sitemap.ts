import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { listPublishedForSitemap } from "@/server/properties/public";
import { siteUrl } from "@/components/site/seo";

/** Sitemap dinámico: páginas institucionales, listados y fichas publicadas (lastModified real). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = siteUrl();
  const props = await listPublishedForSitemap(getDb());
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
  return [...statics, ...props.map((p) => ({ url: `${base}/propiedades/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 }))];
}
