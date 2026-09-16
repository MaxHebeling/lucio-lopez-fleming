import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { siteUrl } from "@/components/site/seo";

/** Solo producción se indexa. Áreas privadas y API siempre bloqueadas. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const base = siteUrl();
  if (process.env.APP_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/crm", "/propietarios", "/api"] },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
