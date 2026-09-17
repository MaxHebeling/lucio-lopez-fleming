import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { formatArea } from "@/server/properties/public-helpers";
import { getSiteDemoShowcase } from "@/server/site/public-data";
import { mediaTabs } from "@/server/tours/model";
import { buildTourFacts } from "@/server/tours/guide";
import { DEMO_TOUR_PATH } from "@/server/tours/demo-constants";
import { Gallery } from "@/components/site/property/Gallery";
import PropertyMediaSection from "@/components/site/property/PropertyMediaSection";
import { Fact, Paragraphs } from "@/components/site/property/facts";
import { siteUrl } from "@/components/site/seo";


/**
 * Demo pública del tour 360° sobre una propiedad FICTICIA. Reutiliza los componentes de la ficha real, no se indexa
 * (noindex + fuera del sitemap) y sus CTA no crean leads: explican el flujo real y llevan a propiedades y contacto reales.
 * Con el flag `virtual_tours` apagado o sin demo sembrada (pnpm seed:demo-tour) responde 404.
 */
export const revalidate = 300;

const TITLE = "Demo de tour virtual 360°";
const DESCRIPTION = "Demostración interactiva del recorrido virtual 360° de Lucio López Fleming sobre una residencia ficticia creada con renders 3D.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · Lucio López Fleming` },
  description: DESCRIPTION,
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: DEMO_TOUR_PATH },
};

export default async function DemoTourPage() {
  const demo = await getSiteDemoShowcase();
  if (!demo) notFound();
  const { property: p, tour } = demo;
  const url = `${siteUrl()}${DEMO_TOUR_PATH}`;
  const photos = [
    ...(tour.coverUrl ? [{ url: tour.coverUrl, width: 1600, height: 1000, alt: "Render 3D de la residencia ficticia de la demostración" }] : []),
    ...tour.scenes.filter((s) => s.thumbnailUrl).map((s) => ({ url: s.thumbnailUrl!, width: 640, height: 400, alt: `Render 3D (ficticio): ${s.name}` })),
  ];
  const tabs = mediaTabs({ flagEnabled: true, hasTour: true, photoCount: photos.length, floorPlanCount: 0, tourHasFloorPlan: Boolean(tour.floorPlan), videoCount: 0 });

  return (
    <article className="pb-28 lg:pb-24">
      <div className="container-site pt-6 lg:pt-10">
        <nav aria-label="Migas de pan" className="text-sm text-ink-2">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/" className="hover:underline">
                Inicio
              </Link>
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <span aria-current="page">Demo tour 360°</span>
            </li>
          </ol>
        </nav>

        <div className="mt-6 flex flex-col gap-2 rounded-[var(--radius-lg)] border border-brick/30 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between" role="note">
          <p className="text-xs font-bold tracking-[0.18em] text-brick">DEMO INTERACTIVA — PROPIEDAD FICTICIA</p>
          <p className="text-sm text-ink-2">Las imágenes son renders 3D de una residencia ficticia creados para la demostración. No está en venta ni en alquiler.</p>
        </div>

        <header className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="eyebrow text-brick">Tour virtual 360°</p>
            <h1 className="display mt-4 text-[clamp(2.4rem,5.6vw,4.75rem)] leading-[0.98]">Recorré la propiedad antes de visitarla.</h1>
            <p className="mt-3 text-lg text-ink-2">Explorá cada ambiente de forma interactiva.</p>
          </div>
          <div className="flex flex-col gap-2 lg:col-span-4 lg:items-end lg:text-right">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-2">{p.title}</p>
            <p className="display text-3xl">Propiedad ficticia</p>
          </div>
        </header>
      </div>

      <div className="container-site mt-8">
        <PropertyMediaSection
          tabs={tabs}
          photos={<Gallery photos={photos} title={p.title} />}
          tour={tour}
          floorPlans={[]}
          videos={[]}
          headline={`${p.title} · ${p.typeName} ficticia de ${tour.scenes.length} ambientes recorribles`}
          fallbackCoverUrl={null}
          propertyCode={null}
          shareUrl={url}
          whatsappUrl={null}
          isDemo
          guide={
            demo.guideEnabled
              ? {
                  ai: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
                  facts: buildTourFacts({ bedrooms: p.bedrooms, bathrooms: p.bathrooms, toilets: p.toilets, rooms: p.rooms, garages: p.garages, coveredAreaM2: p.coveredAreaM2, totalAreaM2: p.totalAreaM2, landAreaM2: p.landAreaM2 }),
                }
              : null
          }
        />
      </div>

      <div className="container-site mt-12 grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="min-w-0 lg:col-span-7 xl:col-span-8">
          <section aria-labelledby="datos-title">
            <h2 id="datos-title" className="display text-4xl">
              Datos clave <span className="text-2xl text-ink-2">(de ejemplo)</span>
            </h2>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              <Fact label="Tipo" value={p.typeName} />
              <Fact label="Cubierta" value={formatArea(p.coveredAreaM2)} />
              <Fact label="Terreno" value={formatArea(p.landAreaM2)} />
              <Fact label="Ambientes" value={p.rooms} />
              <Fact label="Dormitorios" value={p.bedrooms} />
              <Fact label="Baños" value={p.bathrooms} />
              <Fact label="Toilettes" value={p.toilets} />
              <Fact label="Escenas 360°" value={tour.scenes.length} />
            </dl>
          </section>
          {p.description ? (
            <section aria-labelledby="descripcion-title" className="mt-14">
              <h2 id="descripcion-title" className="display text-4xl">
                Sobre esta demo
              </h2>
              <div className="mt-6">
                <Paragraphs text={p.description} />
              </div>
            </section>
          ) : null}
        </div>

        <aside className="lg:col-span-5 xl:col-span-4" aria-label="Qué pasa en una propiedad real">
          <div className="rounded-[20px] border border-line bg-white p-5 sm:p-7 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
            <p className="eyebrow text-brick">¿Te interesa una propiedad así?</p>
            <p className="mt-4 text-ink-2">
              En una propiedad real, desde el tour y desde esta columna pedís una visita y la consulta le llega al asesor a cargo. Como esta casa es ficticia, acá no se envía nada.
            </p>
            <div className="mt-6 grid gap-2">
              <Link href="/propiedades" className="btn btn-primary">
                Ver propiedades reales <ArrowRight aria-hidden className="btn-icon size-4" />
              </Link>
              <Link href="/contacto" className="btn btn-outline">
                Contactanos
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
