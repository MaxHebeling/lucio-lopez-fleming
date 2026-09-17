import type { Metadata } from "next";

export function siteUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const SITE_NAME = "Lucio López Fleming Inmobiliaria";
/** app/opengraph-image.jpg (logo original sobre ladrillo): se usa cuando la página no tiene una foto propia. */
const DEFAULT_OG = { url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "Lucio López Fleming · Buenos negocios" };

/** Metadata consistente: canonical + OpenGraph + Twitter, siempre con imagen (foto real o la de marca). */
export function pageMetadata({ title, description, path, image, noindex }: { title: string; description: string; path: string; image?: { url: string; alt: string } | null; noindex?: boolean }): Metadata {
  const images = image ? [{ url: image.url, alt: image.alt }] : [DEFAULT_OG];
  const socialTitle = title.includes("Lucio López Fleming") ? title : `${title} · Lucio López Fleming`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "es_AR", siteName: SITE_NAME, title: socialTitle, description, url: path, images },
    twitter: { card: "summary_large_image", title: socialTitle, description, images: images.map((i) => i.url) },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
