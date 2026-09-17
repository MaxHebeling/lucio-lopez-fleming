import Image from "next/image";
import { LeadForm } from "@/components/site/LeadForm";
import { TextReveal } from "@/components/experience/Reveal";
import planos from "../../../../public/brand/photos/trabajo-planos.jpg";

/** Tasación: formulario corto que crea un lead de captación (web_appraisal) en el CRM. */
export function AppraisalSection({ types }: { types?: string[] }) {
  return (
    <section id="tasar" className="on-dark relative isolate overflow-hidden bg-ink py-[var(--section-y)] text-paper" aria-labelledby="tasacion-title">
      <Image src={planos} alt="" fill sizes="100vw" className="-z-10 object-cover opacity-25" placeholder="blur" />
      <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/90 to-ink/60" />
      <div className="container-site grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="eyebrow text-paper/75">Tasaciones</p>
          <TextReveal id="tasacion-title" as="h2" className="display h2 mt-5" lines={["¿Cuánto vale", <em key="t">tu propiedad?</em>]} />
          <p className="mt-6 max-w-md text-lg leading-relaxed text-paper/80">
            Contanos qué tenés y dónde está. Te contactamos para coordinar la tasación.
          </p>
        </div>
        <div className="rounded-[20px] border border-paper/15 bg-ink/60 p-5 sm:p-8 lg:col-span-6 lg:col-start-7">
          <LeadForm kind="appraisal" tone="dark" submitLabel="Pedir tasación" appraisalTypes={types} />
        </div>
      </div>
    </section>
  );
}
