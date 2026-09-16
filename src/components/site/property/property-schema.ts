import type { PublicPropertyDetail } from "@/server/properties/public";
import type { SiteInfo } from "@/server/site/info";

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
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Inicio", item: `${base}/` },
        { "@type": "ListItem", position: 2, name: "Propiedades", item: `${base}/propiedades` },
        { "@type": "ListItem", position: 3, name: p.headline, item: url },
      ],
    },
  ];
}
