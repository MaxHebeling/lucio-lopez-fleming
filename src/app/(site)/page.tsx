import type { Metadata } from "next";
import { cache } from "react";
import { plural, telHref } from "@/server/properties/public-helpers";
import { getSiteInfo } from "@/server/site/info";
import { getSiteFacets, getSiteOwnerCapture, getSiteRecent, getSiteShowcase, getSiteZoneShowcase } from "@/server/site/public-data";
import { CoverHero } from "@/components/experience/CoverHero";
import { EditorialManifesto } from "@/components/experience/EditorialManifesto";
import { FeaturedEditorial } from "@/components/experience/FeaturedEditorial";
import { TerritorySalta, pickTerritoryFeature } from "@/components/experience/TerritorySalta";
import { ServicesIndex, type Service } from "@/components/experience/ServicesIndex";
import { ProcessSteps } from "@/components/experience/ProcessSteps";
import { OwnersCapture } from "@/components/experience/OwnersCapture";
import { TrustLedger } from "@/components/experience/TrustLedger";
import { FinalCover } from "@/components/experience/FinalCover";
import { HeroSearch } from "@/components/site/home/HeroSearch";
import { ConciergeSearch } from "@/components/site/sales/ConciergeSearch";
import { getSiteFlag } from "@/server/site/public-flags";
import { RecentRail } from "@/components/site/home/RecentRail";
import { pageMetadata } from "@/components/site/seo";
import coverPhoto from "../../../public/brand/photos/oficina-modular.jpg";
import trabajoPlanos from "../../../public/brand/photos/trabajo-planos.jpg";
import escritorio from "../../../public/brand/photos/oficina-escritorio.jpg";
import equipo from "../../../public/brand/photos/equipo-planos.jpg";
import "./home.css";

/** ISR: el home se sirve desde caché y se regenera al invalidar (revalidatePublicSite) o cada 5 minutos como respaldo. */
export const revalidate = 300;

/** Editoriales de destacadas (ver FeaturedEditorial: una composición por propiedad). */
const FEATURED = 3;
/** Zonas del índice de territorio. */
const ZONES = 6;

/**
 * Datos del home, una sola vez por render (metadata y página comparten): facetas generales (total, zonas, tipos para
 * captación), facetas de venta (operación por defecto del buscador), destacadas, zonas con portada, recientes y la
 * últimas dos propiedades en alquiler (fotos reales de los servicios de alquileres y administración).
 */
const loadHome = cache(async () => {
  const [info, facets, saleFacets, featured, rentals, conciergeOn] = await Promise.all([getSiteInfo(), getSiteFacets(), getSiteFacets("sale"), getSiteShowcase(FEATURED), getSiteRecent(2, [], "rent"), getSiteFlag("ai_concierge")]);
  const exclude = featured.map((p) => p.code);
  const [zones, recent] = await Promise.all([getSiteZoneShowcase(facets.zones, ZONES), getSiteRecent(10, exclude)]);
  return { info, facets, saleFacets, featured, zones, recent, rentals, conciergeOn };
});

export async function generateMetadata(): Promise<Metadata> {
  const { featured } = await loadHome();
  const cover = featured[0]?.cover;
  return {
    ...pageMetadata({
      title: "Lucio López Fleming Inmobiliaria · Salta, desde 1974",
      description:
        "Casas, departamentos, terrenos y locales en venta y alquiler en Salta. Administración de alquileres y tasaciones. Líderes inmobiliarios desde 1974.",
      path: "/",
      image: cover ? { url: cover.url, alt: cover.alt } : null,
    }),
    title: { absolute: "Lucio López Fleming Inmobiliaria · Salta, desde 1974" },
  };
}

export default async function HomePage() {
  const [{ info, facets, saleFacets, featured, zones, recent, rentals, conciergeOn }, capture] = await Promise.all([loadHome(), getSiteOwnerCapture()]);
  const [rentalA, rentalB] = rentals;
  const year = info.foundedYear;
  const phoneHref = telHref(info.mainPhone);
  const phone = info.mainPhone && phoneHref ? { label: info.mainPhone.replace(/^\+54\s?/, ""), href: phoneHref } : null;
  const mainCity = info.branches.find((b) => b.isMain)?.city ?? null;
  const saleCount = facets.operations.find((o) => o.slug === "venta")?.count ?? 0;
  const rentCount = facets.operations.find((o) => o.slug === "alquiler")?.count ?? 0;

  const services: Service[] = [
    {
      title: "Venta de inmuebles y lotes",
      body: "Comercialización de casas, departamentos, terrenos, lotes y locales en la provincia de Salta y el país, con asesoramiento personalizado en cada paso.",
      cta: { href: "/propiedades/venta", label: `Ver ${plural(saleCount, "propiedad en venta", "propiedades en venta")}` },
      photo: trabajoPlanos,
      alt: "Asesor de la inmobiliaria trabajando sobre el plano de un loteo",
    },
    {
      title: "Alquileres",
      body: "Alquiler de casas, departamentos, oficinas y locales en Salta, con asesoramiento personalizado.",
      cta: { href: "/propiedades/alquiler", label: `Ver ${plural(rentCount, "propiedad en alquiler", "propiedades en alquiler")}` },
      photo: rentalA?.cover ? { url: rentalA.cover.url } : trabajoPlanos,
      alt: rentalA?.cover ? rentalA.cover.alt : "Asesor de la inmobiliaria trabajando sobre el plano de un loteo",
    },
    {
      title: "Administración de alquileres",
      body: "Administración de propiedades en alquiler para sus dueños. Contanos qué propiedad tenés y te explicamos cómo trabajamos.",
      cta: { href: "#vender", label: "Consultar por mi propiedad" },
      photo: rentalB?.cover ? { url: rentalB.cover.url } : escritorio,
      alt: rentalB?.cover ? rentalB.cover.alt : "Tres integrantes de la inmobiliaria revisan una carpeta en el escritorio de la oficina",
    },
    {
      title: "Tasaciones",
      body: "Tasación de propiedades con la experiencia de una de las empresas más tradicionales del rubro en Salta.",
      cta: { href: "/tasaciones", label: "Pedir una tasación" },
      photo: equipo,
      alt: "Equipo de la inmobiliaria reunido alrededor de una mesa con planos",
    },
  ];

  return (
    <>
      <CoverHero
        photo={coverPhoto}
        photoAlt="Oficina modular de Lucio López Fleming, con su cartel y estructura roja, al atardecer"
        caption="Nuestra oficina modular, al atardecer"
        kicker="Inmobiliaria en Salta"
        titleLines={["Buenos", "negocios,", <em key="y">{year ? `desde ${year}.` : "en Salta."}</em>]}
        lede="Comercialización de inmuebles y lotes, alquileres, administración y tasación de propiedades en la provincia de Salta y el país."
        primary={{ href: "/propiedades", label: "Ver propiedades" }}
        secondary={{ href: "#vender", label: "Quiero vender mi propiedad" }}
        ghost={year ? String(year) : null}
        search={
          <>
            {conciergeOn ? (
              <div className="mb-2">
                <ConciergeSearch variant="hero" page="home" />
              </div>
            ) : null}
            <HeroSearch facets={saleFacets} total={facets.total} />
          </>
        }
      />

      <EditorialManifesto foundedYear={year} />

      <FeaturedEditorial items={featured} total={facets.total} />

      <TerritorySalta zones={zones} feature={pickTerritoryFeature(zones, mainCity)} localities={facets.zones.length} total={facets.total} />

      <section className="scene services" aria-labelledby="servicios-title">
        <div className="container-site">
          <div className="services-head">
            <p className="eyebrow text-brick">Qué hacemos</p>
            <h2 id="servicios-title" className="display h2 mt-5 max-w-3xl">
              Buenos negocios, <em>con asesoramiento personalizado.</em>
            </h2>
          </div>
          <ServicesIndex items={services} />
        </div>
      </section>

      <ProcessSteps
        id="proceso"
        eyebrow="Cómo trabajamos"
        title={["Una operación,", "de punta a punta."]}
        intro="Así acompañamos a quien vende o alquila su propiedad. Cada operación es distinta: lo conversamos con vos."
        steps={[
          { title: "Conversamos", body: "Nos contás qué propiedad tenés, qué querés hacer y en qué plazos." },
          { title: "Tasamos", body: "Coordinamos una visita y te damos un valor de referencia para vender o alquilar." },
          { title: "Publicamos", body: "La propiedad se publica en nuestro sitio con sus fotos, sus datos y un código propio." },
          { title: "Mostramos", body: "Respondemos las consultas y coordinamos las visitas con los interesados." },
          { title: "Negociamos", body: "Te acompañamos en la negociación de precio y condiciones." },
          { title: "Firmamos", body: "Llegamos juntos a la firma de la operación." },
        ]}
      />

      <OwnersCapture types={facets.types.map((t) => t.name)} phone={phone} steps={capture.steps} photos={capture.photos} />

      <TrustLedger
        foundedYear={year}
        branches={info.branches}
        total={facets.total}
        localities={facets.zones.length}
        photo={escritorio}
        photoAlt="Tres integrantes de la inmobiliaria revisan una carpeta en el escritorio de la oficina"
      />

      <RecentRail items={recent} />

      <FinalCover
        photo={coverPhoto}
        lines={["Tu próximo", "buen negocio."]}
        lede={`${year ? `Desde ${year}, en Salta. ` : ""}Contanos qué buscás o qué querés vender y te asesoramos.`}
        phone={phone}
      />
    </>
  );
}
