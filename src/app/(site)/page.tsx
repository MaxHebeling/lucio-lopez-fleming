import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/server/db";
import { getPublicFacets, getRecentProperties, getShowcaseProperties, getZoneShowcase } from "@/server/properties/public";
import { whatsappHref } from "@/server/properties/public-helpers";
import { getSiteInfo } from "@/server/site/info";
import { CinematicHero } from "@/components/experience/CinematicHero";
import { PropertyShowcase } from "@/components/experience/PropertyShowcase";
import { StickyStory } from "@/components/experience/StickyStory";
import { TextReveal } from "@/components/experience/Reveal";
import { HeroSearch } from "@/components/site/home/HeroSearch";
import { Manifesto } from "@/components/site/home/Manifesto";
import { ZoneExplorer } from "@/components/site/home/ZoneExplorer";
import { RecentRail } from "@/components/site/home/RecentRail";
import { AppraisalSection } from "@/components/site/home/AppraisalSection";
import { Offices } from "@/components/site/home/Offices";
import { Closing } from "@/components/site/home/Closing";
import { pageMetadata } from "@/components/site/seo";
import trabajoPlanos from "../../../public/brand/photos/trabajo-planos.jpg";
import escritorio from "../../../public/brand/photos/oficina-escritorio.jpg";
import modular from "../../../public/brand/photos/oficina-modular.jpg";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const [hero] = await getShowcaseProperties(getDb(), 1);
  return {
    ...pageMetadata({
      title: "Lucio López Fleming Inmobiliaria · Salta, desde 1974",
      description:
        "Casas, departamentos, terrenos y locales en venta y alquiler en Salta. Administración de alquileres y tasaciones. Líderes inmobiliarios desde 1974.",
      path: "/",
      image: hero?.cover ? { url: hero.cover.url, alt: hero.cover.alt } : null,
    }),
    title: { absolute: "Lucio López Fleming Inmobiliaria · Salta, desde 1974" },
  };
}

export default async function HomePage() {
  await connection();
  const db = getDb();
  const [info, facets, showcase, zones] = await Promise.all([getSiteInfo(), getPublicFacets(db), getShowcaseProperties(db, 7), getZoneShowcase(db, 5)]);
  const [hero, ...featured] = showcase;
  const recent = await getRecentProperties(db, 10, showcase.map((p) => p.code));
  const wa = whatsappHref(info.whatsappE164, "Hola, les escribo desde la web de Lucio López Fleming.");
  const year = info.foundedYear;

  return (
    <>
      <CinematicHero
        property={hero ?? null}
        eyebrow="Inmobiliaria en Salta"
        titleLines={["Buenos negocios,", <em key="y">{year ? `desde ${year}.` : "en Salta."}</em>]}
        search={<HeroSearch facets={facets} />}
      />

      <Manifesto foundedYear={year} />

      {featured.length ? (
        <section className="pb-[var(--section-y)]" aria-labelledby="destacadas-title">
          <div className="container-site">
            <div className="mb-14 flex flex-col gap-6 border-t border-line pt-[var(--section-y)] lg:mb-20 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="eyebrow text-brick">Selección</p>
                <TextReveal id="destacadas-title" as="h2" className="display h2 mt-5 max-w-4xl" lines={["Propiedades", <em key="d">para mirar dos veces.</em>]} />
              </div>
              <Link href="/propiedades" className="link-arrow text-ink">
                Ver las {facets.total} propiedades <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
            <PropertyShowcase items={featured} />
          </div>
        </section>
      ) : null}

      <ZoneExplorer zones={zones} />

      <StickyStory
        id="servicios"
        eyebrow="Qué hacemos"
        title="Te acompañamos de punta a punta."
        steps={[
          {
            title: "Venta de inmuebles y lotes",
            body: "Comercialización de casas, departamentos, terrenos, lotes y locales en la provincia de Salta y el país, con asesoramiento personalizado en cada paso.",
            cta: { href: "/propiedades/venta", label: "Ver propiedades en venta" },
            photo: escritorio,
            alt: "Integrantes de la inmobiliaria revisando documentación en la oficina",
          },
          {
            title: "Alquileres y administración",
            body: "Alquiler de casas, departamentos, oficinas y locales, y administración de propiedades en alquiler para sus dueños.",
            cta: { href: "/propiedades/alquiler", label: "Ver propiedades en alquiler" },
            photo: modular,
            alt: "Oficina modular con el cartel de la inmobiliaria al atardecer",
          },
          {
            title: "Tasaciones",
            body: "Tasación de propiedades con la experiencia de una de las empresas más tradicionales del rubro en Salta. Contanos qué tenés y te contactamos.",
            cta: { href: "/tasaciones", label: "Pedir una tasación" },
            photo: trabajoPlanos,
            alt: "Asesor trabajando sobre un plano de loteo",
          },
        ]}
      />

      <RecentRail items={recent} />

      <AppraisalSection types={facets.types.map((t) => t.name)} />

      <Offices branches={info.branches} />

      <Closing foundedYear={year} whatsappHref={wa} />
    </>
  );
}
