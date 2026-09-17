import { getSiteInfo } from "@/server/site/info";
import { siteUrl } from "./seo";

/** JSON-LD seguro: `<` escapado para que ningún texto cargado pueda cerrar el <script>. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

const DAY_MAP: Record<string, string[]> = {
  "lunes a viernes": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  "sábados": ["Saturday"],
  "sabados": ["Saturday"],
};

/** "Lunes a viernes de 9:00 a 13:00 · Sábados de 10:30 a 12:30" → OpeningHoursSpecification. Lo que no se entiende se omite. */
export function openingHours(schedule: string | null) {
  if (!schedule) return undefined;
  const specs = schedule
    .split("·")
    .map((part) => {
      const m = /^\s*(.+?)\s+de\s+(\d{1,2}):?(\d{2})?\s+a\s+(\d{1,2}):?(\d{2})?\s*$/i.exec(part);
      if (!m) return null;
      const days = DAY_MAP[m[1]!.toLowerCase()];
      if (!days) return null;
      const t = (h: string, mm?: string) => `${h.padStart(2, "0")}:${mm ?? "00"}`;
      return { "@type": "OpeningHoursSpecification", dayOfWeek: days, opens: t(m[2]!, m[3]), closes: t(m[4]!, m[5]) };
    })
    .filter(Boolean);
  return specs.length ? specs : undefined;
}

export async function organizationSchema() {
  const info = await getSiteInfo();
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": `${base}/#organizacion`,
    name: info.name,
    url: base,
    logo: `${base}/icon.png`,
    image: `${base}/opengraph-image.jpg`,
    slogan: "Buenos negocios",
    ...(info.foundedYear ? { foundingDate: String(info.foundedYear) } : {}),
    ...(info.mainPhone ? { telephone: info.mainPhone } : {}),
    ...(info.mainEmail ? { email: info.mainEmail } : {}),
    areaServed: { "@type": "AdministrativeArea", name: "Provincia de Salta, Argentina" },
    sameAs: [info.social.instagram, info.social.facebook],
    department: info.branches.map((b) => ({
      "@type": "RealEstateAgent",
      name: `${info.name} · ${b.name}`,
      ...(b.phone ? { telephone: b.phone } : {}),
      address: {
        "@type": "PostalAddress",
        ...(b.street ? { streetAddress: b.street } : {}),
        addressLocality: b.city ?? undefined,
        addressRegion: b.province ?? "Salta",
        addressCountry: "AR",
      },
      ...(b.lat !== null && b.lng !== null ? { geo: { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng } } : {}),
      ...(openingHours(b.schedule) ? { openingHoursSpecification: openingHours(b.schedule) } : {}),
    })),
  };
}

export async function OrganizationJsonLd() {
  return <JsonLd data={await organizationSchema()} />;
}
