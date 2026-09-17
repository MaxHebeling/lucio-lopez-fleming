import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

type Cta = { href: string; label: string };

/**
 * Nivel 1 · Portada de revista. La foto es una lámina vertical a sangre (derecha en desktop, arriba en mobile): su
 * encuadre nunca la estira más allá de su resolución real (ver `.cover-plate` en home.css). La tipografía macro vive
 * sobre tinta, con el año de fundación como numeral fantasma detrás de la lámina (capas + profundidad con el puntero).
 *
 * Entrada ≈1.6 s en CSS (sin JS): la foto asienta su escala (nunca parte de opacity 0: es el LCP) → cabecera →
 * titular por líneas → bajada → CTA → buscador. Con el motor de escenas (desktop) la portada se transforma al scroll
 * mientras la escena siguiente la cubre (`data-scene="cover"`). Todo visible y usable sin JS.
 */
export function CoverHero({
  photo,
  photoAlt,
  caption,
  kicker,
  titleLines,
  lede,
  primary,
  secondary,
  ghost,
  search,
}: {
  photo: StaticImageData;
  photoAlt: string;
  caption: string;
  kicker: string;
  titleLines: ReactNode[];
  lede: string;
  primary: Cta;
  secondary: Cta;
  ghost: string | null;
  search: ReactNode;
}) {
  return (
    <section className="cover on-dark" data-hero data-scene="cover" aria-labelledby="hero-title">
      <div className="cover-plate" data-cover-plate>
        <div className="cover-depth" data-depth="-1">
          <div className="cover-zoom">
            {/* LCP en todos los anchos: carga inmediata con prioridad alta desde que se descubre (el HTML la trae temprano).
                `sizes` = ancho real de la lámina. */}
            <Image
              src={photo}
              alt={photoAlt}
              fill
              loading="eager"
              fetchPriority="high"
              quality={65}
              sizes="(min-width: 1024px) 56vw, 100vw"
              placeholder="blur"
              className="cover-img"
            />
          </div>
        </div>
        <span className="cover-plate-veil" aria-hidden />
      </div>

      {ghost ? (
        <p className="cover-ghost" data-cover-ghost aria-hidden>
          <span data-depth="0.6">{ghost}</span>
        </p>
      ) : null}

      <div className="cover-body container-site">
        <div className="cover-copy" data-cover-copy>
          <div data-depth="0.35">
            <p className="eyebrow cover-enter text-paper/85" style={{ "--d": "300ms" } as CSSProperties}>
              {kicker}
            </p>
            <h1 id="hero-title" className="cover-title display">
              {titleLines.map((line, i) => (
                <span key={i} className="cover-line">
                  <span className="cover-line-inner" style={{ "--l": i } as CSSProperties}>
                    {line}
                  </span>
                  {i < titleLines.length - 1 ? " " : null}
                </span>
              ))}
            </h1>
            <p className="cover-lede cover-enter" style={{ "--d": "760ms" } as CSSProperties}>
              {lede}
            </p>
            <div className="cover-cta cover-enter" style={{ "--d": "880ms" } as CSSProperties}>
              <Link href={primary.href} className="btn btn-light btn-arrow" data-magnetic>
                {primary.label} <ArrowRight aria-hidden className="btn-icon size-4" />
              </Link>
              <Link href={secondary.href} className="btn btn-outline">
                {secondary.label}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="cover-search container-site cover-enter" style={{ "--d": "1000ms" } as CSSProperties}>
        {search}
        <p className="cover-credit">{caption}</p>
      </div>
      <span className="cover-shade" data-cover-shade aria-hidden />
    </section>
  );
}
