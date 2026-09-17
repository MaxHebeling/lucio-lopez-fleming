import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { PublicPropertyCard } from "@/server/properties/public";
import { priceLabel } from "@/components/site/property-bits";
import { Monogram } from "./Monogram";
import fallbackPhoto from "../../../public/brand/photos/oficina-modular.jpg";

/**
 * Nivel 1 · Portada. Secuencia ≈1.5 s en CSS (site.css): fondo tinta → monograma que se dibuja → foto que
 * asienta su escala (sin opacidad: es el LCP) → titular por líneas (solo translate) → buscador.
 * Profundidad ≤ 8 px con el puntero solo en desktop ([data-depth], motion/pointer.ts). Todo visible sin JS.
 */
export function CinematicHero({ property, search, eyebrow, titleLines }: { property: PublicPropertyCard | null; search: ReactNode; eyebrow: string; titleLines: ReactNode[] }) {
  const cover = property?.cover ?? null;
  return (
    <section className="hero on-dark" data-hero aria-labelledby="hero-title">
      <div className="hero-media" data-depth="-1" aria-hidden={cover ? undefined : true}>
        <div className="hero-zoom absolute inset-0">
          {cover ? (
            <Image src={cover.url} alt={cover.alt} fill sizes="100vw" loading="eager" fetchPriority="high" className="hero-img" />
          ) : (
            <Image src={fallbackPhoto} alt="" fill sizes="100vw" loading="eager" fetchPriority="high" className="hero-img" placeholder="blur" />
          )}
        </div>
      </div>
      <div className="hero-veil" aria-hidden />

      <div className="container-site relative pb-8 pt-28 sm:pb-12 lg:pb-14">
        <div className="flex items-center gap-4">
          <Monogram draw className="h-10 w-auto text-paper sm:h-12" delayMs={80} />
          <p className="eyebrow hero-enter text-paper/90" style={{ "--d": "260ms" } as CSSProperties}>
            {eyebrow}
          </p>
        </div>
        <h1 id="hero-title" className="hero-title display mt-6 max-w-[14ch] sm:mt-8" data-depth="0.4">
          {titleLines.map((line, i) => (
            <span key={i} className="hero-line" style={{ "--l": i } as CSSProperties}>
              {line}
              {i < titleLines.length - 1 ? " " : null}
            </span>
          ))}
        </h1>

        <div className="mt-8 grid items-end gap-6 lg:mt-12 lg:grid-cols-12 lg:gap-10">
          <div className="hero-enter lg:col-span-8 xl:col-span-9" style={{ "--d": "780ms" } as CSSProperties}>
            {search}
          </div>
          {property ? (
            <div className="hero-enter hidden text-sm lg:col-span-4 lg:block xl:col-span-3" style={{ "--d": "980ms" } as CSSProperties}>
              <p className="eyebrow text-paper/75">En portada</p>
              <p className="mt-3 text-lg font-semibold leading-snug">{property.headline}</p>
              <p className="tabular mt-1 text-paper/80">
                {property.prices[0] ? priceLabel(property.prices[0]) : "Consultar"} · Cód. {property.code}
              </p>
              <Link href={`/propiedades/${property.slug}`} className="link-arrow mt-3 text-paper">
                Ver la propiedad <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
