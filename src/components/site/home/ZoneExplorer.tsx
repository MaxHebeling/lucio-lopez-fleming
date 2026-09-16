import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ZoneShowcase } from "@/server/properties/public";
import { plural } from "@/server/properties/public-helpers";
import { Reveal, TextReveal } from "@/components/experience/Reveal";

/** Explorar por zona: zonas reales con conteo en vivo y la foto de una propiedad publicada en cada una. */
export function ZoneExplorer({ zones }: { zones: ZoneShowcase[] }) {
  if (!zones.length) return null;
  return (
    <section className="on-dark bg-ink py-[var(--section-y)] text-paper" aria-labelledby="zonas-title">
      <div className="container-site">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow text-paper/75">Territorio</p>
            <TextReveal id="zonas-title" as="h2" className="display h2 mt-5 max-w-3xl" lines={["Explorá por zona:", <em key="v">del centro al valle.</em>]} />
          </div>
          <Link href="/propiedades" className="link-arrow text-paper">
            Ver todas las zonas <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </div>
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6" data-reveal-group="80">
          {zones.map((z, i) => (
            <Reveal as="li" key={z.slug} className={`card ${i === 0 ? "lg:row-span-2" : ""}`}>
              <div className={`media-frame relative ${i === 0 ? "aspect-[4/5] lg:aspect-auto lg:h-full" : "aspect-[16/11]"} rounded-[var(--radius-lg)] bg-ink-2`}>
                {z.cover ? <Image src={z.cover.url} alt={z.cover.alt} fill sizes={i === 0 ? "(min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw" : "(min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw"} className="reveal-img card-img object-cover opacity-80" /> : null}
                <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 lg:p-6">
                  <div>
                    <h3 className="display text-3xl lg:text-4xl">
                      <Link href={`/propiedades?zona=${z.slug}`} className="card-link">
                        {z.name}
                      </Link>
                    </h3>
                    <p className="tabular mt-1 text-sm text-paper/85">{plural(z.count, "propiedad", "propiedades")}</p>
                  </div>
                  <span aria-hidden className="card-arrow grid size-11 shrink-0 place-items-center rounded-full bg-paper text-ink">
                    <ArrowUpRight className="size-5" strokeWidth={1.8} />
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
