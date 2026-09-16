import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/server/db";
import { getPublicFacets } from "@/server/properties/public";
import { plural } from "@/server/properties/public-helpers";
import { getSiteInfo } from "@/server/site/info";
import { Reveal, SurveyLine, TextReveal } from "@/components/experience/Reveal";
import { Offices } from "@/components/site/home/Offices";
import { pageMetadata } from "@/components/site/seo";
import escritorio from "../../../../public/brand/photos/oficina-escritorio.jpg";
import equipo from "../../../../public/brand/photos/equipo-planos.jpg";
import modular from "../../../../public/brand/photos/oficina-modular.jpg";

export const metadata: Metadata = pageMetadata({
  title: "La empresa",
  description: "Lucio López Fleming Inmobiliaria: una de las empresas más tradicionales del rubro en Salta, desde 1974. Venta, alquileres, administración y tasaciones.",
  path: "/empresa",
});

export default async function EmpresaPage() {
  await connection();
  const [info, facets] = await Promise.all([getSiteInfo(), getPublicFacets(getDb())]);
  const year = info.foundedYear;
  return (
    <>
      <section className="container-site pb-16 pt-12 lg:pb-24 lg:pt-20" aria-labelledby="empresa-title">
        <p className="eyebrow text-brick">La empresa</p>
        <h1 id="empresa-title" className="display mt-6 max-w-5xl text-[clamp(3rem,8.5vw,8.5rem)] leading-[0.92] tracking-[-0.03em]">
          Líderes inmobiliarios <em>{year ? `desde ${year}.` : "en Salta."}</em>
        </h1>
        <div className="mt-12 grid gap-10 lg:grid-cols-12">
          <div className="text-lg leading-relaxed text-ink-2 lg:col-span-6">
            <p>
              {year ? `Fundada en ${year} en Salta por Lucio López Fleming, de quien toma el nombre, ` : "Fundada en Salta por Lucio López Fleming, de quien toma el nombre, "}
              es una de las empresas más tradicionales del rubro en Salta.
            </p>
            <p className="mt-5">Nos caracterizamos por nuestra seriedad, calidad humana, compromiso y la experiencia en el rubro.</p>
          </div>
          <div className="lg:col-span-5 lg:col-start-8">
            <SurveyLine className="text-line" />
            <dl className="mt-6 grid grid-cols-2 gap-6">
              {year ? (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">Desde</dt>
                  <dd className="display tabular mt-2 text-6xl">{year}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">Publicadas hoy</dt>
                <dd className="display tabular mt-2 text-6xl">{facets.total}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">Oficinas</dt>
                <dd className="display tabular mt-2 text-6xl">{info.branches.length}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">Localidades con propiedades</dt>
                <dd className="display tabular mt-2 text-6xl">{facets.zones.length}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="container-site grid gap-6 sm:grid-cols-12">
        <Reveal className="sm:col-span-7">
          <div className="media-frame aspect-[4/3] rounded-[var(--radius-lg)] bg-paper-2">
            <Image src={escritorio} alt="Tres integrantes de la inmobiliaria revisan una carpeta en el escritorio de la oficina" fill sizes="(min-width: 640px) 58vw, 92vw" className="reveal-img object-cover" placeholder="blur" />
            <span aria-hidden className="curtain" />
          </div>
        </Reveal>
        <Reveal className="sm:col-span-5 sm:mt-32" delay={120}>
          <div className="media-frame aspect-[3/4] rounded-[var(--radius-lg)] bg-paper-2">
            <Image src={modular} alt="Oficina modular con el cartel de la inmobiliaria al atardecer" fill sizes="(min-width: 640px) 40vw, 92vw" className="reveal-img object-cover" placeholder="blur" />
            <span aria-hidden className="curtain" />
          </div>
        </Reveal>
      </div>

      <section className="container-site py-[var(--section-y)]" aria-labelledby="servicios-title">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="eyebrow text-brick">Qué hacemos</p>
            <TextReveal id="servicios-title" className="display h2 mt-5" lines={["Buenos negocios,", <em key="p">con asesoramiento personalizado.</em>]} />
          </div>
          <ul className="grid gap-8 lg:col-span-6 lg:col-start-7" data-reveal-group="90">
            {[
              { t: "Comercialización de inmuebles y lotes", d: "Casas, departamentos, terrenos, locales y oficinas en la provincia de Salta y el país.", href: "/propiedades/venta", cta: `Ver ${plural(facets.operations.find((o) => o.slug === "venta")?.count ?? 0, "propiedad en venta", "propiedades en venta")}` },
              { t: "Alquileres y administración", d: "Alquiler de propiedades y administración para sus dueños.", href: "/propiedades/alquiler", cta: `Ver ${plural(facets.operations.find((o) => o.slug === "alquiler")?.count ?? 0, "propiedad en alquiler", "propiedades en alquiler")}` },
              { t: "Tasación de propiedades", d: "Contanos qué tenés y dónde está, y coordinamos la tasación.", href: "/tasaciones", cta: "Pedir tasación" },
            ].map((s, i) => (
              <li key={s.t} data-reveal="up" className="border-t border-line pt-6">
                <p className="tabular text-sm font-semibold text-brick">0{i + 1}</p>
                <h3 className="display mt-2 text-3xl">{s.t}</h3>
                <p className="mt-3 text-ink-2">{s.d}</p>
                <Link href={s.href} className="link-arrow mt-4 text-ink">
                  {s.cta} <ArrowRight aria-hidden className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container-site">
        <Reveal>
          <div className="media-frame aspect-[16/9] rounded-[var(--radius-lg)] bg-paper-2 sm:aspect-[21/9]">
            <Image src={equipo} alt="Equipo de la inmobiliaria reunido alrededor de una mesa con planos" fill sizes="92vw" className="reveal-img object-cover" placeholder="blur" />
            <span aria-hidden className="curtain" />
          </div>
        </Reveal>
      </div>

      <Offices branches={info.branches} />
    </>
  );
}
