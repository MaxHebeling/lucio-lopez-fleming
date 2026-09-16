import type { Metadata } from "next";

export function siteUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Metadata consistente: canonical + OpenGraph + Twitter. La imagen por defecto es app/opengraph-image.jpg. */
export function pageMetadata({ title, description, path, image, noindex }: { title: string; description: string; path: string; image?: { url: string; alt: string } | null; noindex?: boolean }): Metadata {
  const images = image ? [{ url: image.url, alt: image.alt }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "es_AR", siteName: "Lucio López Fleming Inmobiliaria", title, description, url: path, ...(images ? { images } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(images ? { images: images.map((i) => i.url) } : {}) },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
