import type { Metadata } from "next";
import Image from "next/image";
import { Phone } from "lucide-react";
import { telHref, whatsappHref } from "@/server/properties/public-helpers";
import { getSiteInfo } from "@/server/site/info";
import { getSiteFacets } from "@/server/site/public-data";
import { LeadForm } from "@/components/site/LeadForm";
import { WhatsAppIcon } from "@/components/site/icons";
import { pageMetadata } from "@/components/site/seo";
import planos from "../../../../public/brand/photos/trabajo-planos.jpg";

export const metadata: Metadata = pageMetadata({
  title: "Tasaciones de propiedades en Salta",
  description: "Pedí la tasación de tu casa, departamento, terreno o local en Salta. Lucio López Fleming Inmobiliaria, desde 1974.",
  path: "/tasaciones",
});

/** ISR: se sirve desde caché; se regenera al invalidar el sitio (sedes, conteos) o a los 5 minutos. */
export const revalidate = 300;

export default async function TasacionesPage() {
  const [info, facets] = await Promise.all([getSiteInfo(), getSiteFacets()]);
  const wa = whatsappHref(info.whatsappE164, "Hola, quiero pedir una tasación.");
  const phone = telHref(info.mainPhone);
  return (
    <div className="container-site grid gap-12 pb-24 pt-12 lg:grid-cols-12 lg:pt-20">
      <div className="lg:col-span-5">
        <p className="eyebrow text-brick">Tasaciones</p>
        <h1 className="display mt-6 text-[clamp(2.8rem,6.5vw,6rem)] leading-[0.95]">
          ¿Cuánto vale <em>tu propiedad?</em>
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-2">
          Tasación de propiedades en la provincia de Salta con la experiencia de una de las empresas más tradicionales del rubro. Completá el formulario y te contactamos para coordinar.
        </p>
        <ol className="mt-10 grid gap-5">
          {["Nos contás qué propiedad es y dónde está.", "Te contactamos para coordinar la visita.", "Recibís el valor y el asesoramiento para vender o alquilar."].map((s, i) => (
            <li key={s} className="flex gap-4 border-t border-line pt-5">
              <span className="tabular text-sm font-semibold text-brick">0{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-3">
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              <WhatsAppIcon className="size-5" /> WhatsApp
            </a>
          ) : null}
          {phone && info.mainPhone ? (
            <a href={phone} className="btn btn-outline">
              <Phone aria-hidden className="size-4" /> {info.mainPhone}
            </a>
          ) : null}
        </div>
        <div className="media-frame mt-12 hidden aspect-[16/10] rounded-[var(--radius-lg)] lg:block">
          <Image src={planos} alt="Asesor de la inmobiliaria trabajando sobre un plano de loteo" fill sizes="38vw" className="object-cover" placeholder="blur" />
        </div>
      </div>
      <section aria-labelledby="form-tasacion" className="lg:col-span-6 lg:col-start-7">
        <div className="rounded-[20px] border border-line bg-white p-5 sm:p-8 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
          <h2 id="form-tasacion" className="display text-4xl">
            Pedí tu tasación
          </h2>
          <div className="mt-6">
            <LeadForm kind="appraisal" submitLabel="Pedir tasación" appraisalTypes={facets.types.map((t) => t.name)} />
          </div>
        </div>
      </section>
    </div>
  );
}
