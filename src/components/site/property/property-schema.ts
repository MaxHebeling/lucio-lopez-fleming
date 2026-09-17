import type { PublicPropertyDetail } from "@/server/properties/public";
import { OPERATION_NOUN, OPERATION_TO_SLUG } from "@/server/properties/public-constants";
import type { SiteInfo } from "@/server/site/info";

export type Crumb = { name: string; path: string };

/** Migas de la ficha (las mismas en pantalla y en JSON-LD): Inicio › Propiedades en {operación} › Cód. N. */
export function propertyBreadcrumb(p: Pick<PublicPropertyDetail, "code" | "slug" | "prices">): Crumb[] {
  const op = p.prices[0]?.operation;
  const listing: Crumb = op
    ? { name: `Propiedades en ${OPERATION_NOUN[op]}`, path: op === "temporary_rent" ? "/propiedades?operacion=temporario" : `/propiedades/${OPERATION_TO_SLUG[op]}` }
    : { name: "Propiedades", path: "/propiedades" };
  return [{ name: "Inicio", path: "/" }, listing, { name: `Cód. ${p.code}`, path: `/propiedades/${p.slug}` }];
}

const RESIDENCE: Record<string, string> = { casa: "SingleFamilyResidence", departamento: "Apartment", ph: "Apartment" };

/**
 * JSON-LD de la ficha: Offer (precio solo si es visible) sobre el inmueble con el tipo adecuado.
 * La dirección nunca incluye altura si está oculta, y con dirección oculta no se publican coordenadas.
 */
export function propertyJsonLd(p: PublicPropertyDetail, url: string, base: string, info: SiteInfo) {
  const main = p.prices[0];
  const itemType = RESIDENCE[p.typeKey] ?? (p.typeCategory === "residential" ? "Residence" : "Place");
  const isResidence = itemType !== "Place";
  const area = p.coveredAreaM2 ?? p.totalAreaM2;
  const item: Record<string, unknown> = {
    "@type": itemType,
    name: p.headline,
    url,
    ...(p.photos.length ? { image: p.photos.slice(0, 8).map((x) => x.url) } : {}),
    address: {
      "@type": "PostalAddress",
      ...(p.street ? { streetAddress: p.street } : {}),
      ...(p.zone.locality ? { addressLocality: p.zone.area ? `${p.zone.area}, ${p.zone.locality}` : p.zone.locality } : {}),
      addressRegion: p.zone.province ?? "Salta",
      addressCountry: "AR",
    },
    ...(p.coordinates && !p.coordinates.approximate ? { geo: { "@type": "GeoCoordinates", latitude: p.coordinates.lat, longitude: p.coordinates.lng } } : {}),
    ...(isResidence && p.bedrooms ? { numberOfBedrooms: p.bedrooms } : {}),
    ...(isResidence && p.bathrooms ? { numberOfBathroomsTotal: p.bathrooms } : {}),
    ...(isResidence && p.rooms ? { numberOfRooms: p.rooms } : {}),
    ...(isResidence && area ? { floorSize: { "@type": "QuantitativeValue", value: area, unitCode: "MTK" } } : {}),
    ...(isResidence && p.allowsPets !== null ? { petsAllowed: p.allowsPets } : {}),
  };
  const availability = p.status === "sold" || p.status === "rented" ? "https://schema.org/SoldOut" : p.status === "reserved" ? "https://schema.org/LimitedAvailability" : "https://schema.org/InStock";
  return [
    {
      "@context": "https://schema.org",
      "@type": "Offer",
      name: p.headline,
      url,
      ...(p.description ? { description: p.description.slice(0, 500) } : {}),
      ...(main && !main.priceHidden && main.amount !== null ? { price: main.amount, priceCurrency: main.currency } : {}),
      businessFunction: main?.operation === "sale" ? "http://purl.org/goodrelations/v1#Sell" : "http://purl.org/goodrelations/v1#LeaseOut",
      availability,
      itemOffered: item,
      offeredBy: { "@type": "RealEstateAgent", "@id": `${base}/#organizacion`, name: info.name },
      sku: String(p.code),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: propertyBreadcrumb(p).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.path === "/" ? `${base}/` : `${base}${c.path}` })),
    },
  ];
}
