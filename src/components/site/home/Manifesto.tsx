import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal, SurveyLine, TextReveal } from "@/components/experience/Reveal";
import escritorio from "../../../../public/brand/photos/oficina-escritorio.jpg";
import planos from "../../../../public/brand/photos/equipo-planos.jpg";

/** Nivel 2 · Manifiesto: textos reales del sitio anterior + 1974 como gran numeral + fotos reales de la oficina. */
export function Manifesto({ foundedYear }: { foundedYear: number | null }) {
  return (
    <section className="relative py-[var(--section-y)]" aria-labelledby="manifiesto-title">
      <div className="container-site">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <p className="eyebrow text-brick">La inmobiliaria</p>
            {foundedYear ? (
              <p className="numeral tabular mt-6 text-ink" aria-label={`Desde ${foundedYear}`} data-reveal="up">
                {foundedYear}
              </p>
            ) : null}
            <SurveyLine className="mt-8 w-full text-line" />
          </div>
          <div className="lg:col-span-6 lg:col-start-7 lg:pt-6">
            <TextReveal id="manifiesto-title" as="h2" className="display h2" lines={["Líderes inmobiliarios", <em key="s">{foundedYear ? `desde ${foundedYear}.` : "en Salta."}</em>]} />
            <div className="mt-8 grid gap-5 text-lg leading-relaxed text-ink-2" data-reveal-group="90">
              <p data-reveal="up">
                Una de las empresas más tradicionales del rubro en Salta. Nos caracterizamos por nuestra seriedad, calidad humana, compromiso y la experiencia en el rubro.
              </p>
              <p data-reveal="up">Comercialización de inmuebles y lotes, alquileres, administración y tasación de propiedades en la provincia de Salta y el país. Brindamos asesoramiento personalizado.</p>
            </div>
            <Link href="/empresa" className="link-arrow mt-8 text-ink">
              Conocé la empresa <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-12 lg:mt-24">
          <Reveal className="sm:col-span-8">
            <div className="media-frame aspect-[16/9] rounded-[var(--radius-lg)] bg-paper-2">
              <div className="absolute -inset-y-6 inset-x-0" data-parallax="0.05">
              <Image src={escritorio} alt="Tres integrantes de la inmobiliaria revisan una carpeta en el escritorio de la oficina" fill sizes="(min-width: 640px) 64vw, 92vw" className="reveal-img object-cover object-[50%_40%]" placeholder="blur" />
              </div>
              <span aria-hidden className="curtain" />
            </div>
          </Reveal>
          <Reveal className="sm:col-span-4 sm:mt-24" delay={120}>
            <div className="media-frame aspect-[4/5] rounded-[var(--radius-lg)] bg-paper-2">
              <Image src={planos} alt="Equipo de la inmobiliaria reunido alrededor de una mesa con planos" fill sizes="(min-width: 640px) 32vw, 92vw" className="reveal-img object-cover object-[40%_50%]" placeholder="blur" />
              <span aria-hidden className="curtain" />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
