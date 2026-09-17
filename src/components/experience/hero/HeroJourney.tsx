import Image, { type StaticImageData } from "next/image";
import type { CSSProperties, ReactNode } from "react";
import type { ResolvedJourney } from "./hero-journey";
import { HeroHeadline, type HeroCta } from "./HeroHeadline";
import { JourneyScenes } from "./JourneyScenes";

export const JOURNEY_END_ID = "tras-el-recorrido";

/**
 * Portada + recorrido arquitectónico (docs/WEB_EXPERIENCE.md §4.1).
 *
 * La portada (titular, CTA, buscador y la foto LCP) es HTML del servidor, igual que antes: `eager` +
 * `fetchPriority="high"`, visible desde el primer paint. Las escenas se montan en el cliente (`JourneyScenes`, chunk
 * diferido con su CSS): no suman bytes al documento ni CSS bloqueante, así el LCP no empeora. Presentaciones:
 *
 *  - sin JS: la portada completa (la fila de escenas es opcional);
 *  - movimiento reducido: portada + fila editorial estable de las escenas `static`;
 *  - flujo (movimiento, sin motor: mobile, tablet, touch, o desktop antes de que cargue GSAP): láminas que se apilan
 *    con transiciones CSS ligadas al scroll (mobile: solo las escenas `mobile`);
 *  - fijado (desktop con puntero fino y el motor cargado en idle, `data-pinned`): escenario sticky con la línea de
 *    tiempo de `motion/journey.ts`.
 */
export function HeroJourney({
  resolved,
  coverPhoto,
  kicker,
  titleLines,
  lede,
  primary,
  secondary,
  ghost,
  search,
}: {
  resolved: ResolvedJourney;
  coverPhoto: StaticImageData;
  kicker: string;
  titleLines: ReactNode[];
  lede: string;
  primary: HeroCta;
  secondary: HeroCta;
  ghost: string | null;
  search: ReactNode;
}) {
  const { journey, property } = resolved;
  const mobileScenes = journey.scenes.filter((s) => s.mobile).length;
  return (
    <section className="jr on-dark" data-hero data-journey={journey.kind} aria-labelledby="hero-title">
      <div className="jr-stage" data-jr-stage>
        <div className="cover" data-jr-cover>
          <div className="cover-plate" data-cover-plate data-aperture={JSON.stringify(journey.cover.aperture)} data-width={coverPhoto.width} data-height={coverPhoto.height}>
            <div className="cover-depth" data-depth="-1">
              <div className="cover-zoom">
                {/* LCP en todos los anchos: carga inmediata con prioridad alta. `sizes` = ancho real de la lámina. */}
                <Image
                  src={coverPhoto}
                  alt={journey.cover.alt}
                  fill
                  loading="eager"
                  fetchPriority="high"
                  quality={65}
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  placeholder="blur"
                  className="cover-img"
                />
              </div>
            </div>
            <span className="cover-plate-veil" aria-hidden />
            <span className="cover-plate-shade" data-jr-shade aria-hidden />
          </div>

          {ghost ? (
            <p className="cover-ghost" data-cover-ghost aria-hidden>
              <span data-depth="0.6">{ghost}</span>
            </p>
          ) : null}

          <HeroHeadline kicker={kicker} titleLines={titleLines} lede={lede} primary={primary} secondary={secondary} />

          <div className="cover-search container-site" data-cover-search>
            <div className="cover-enter" style={{ "--d": "1000ms" } as CSSProperties}>
              {search}
              <p className="cover-credit">{journey.cover.caption}</p>
            </div>
          </div>
        </div>

        <JourneyScenes
          kind={journey.kind}
          property={property ? { code: property.code, href: property.href, specs: property.specs } : null}
          scenes={journey.scenes.length}
          mobileScenes={mobileScenes}
          endId={JOURNEY_END_ID}
        />
      </div>
      <span id={JOURNEY_END_ID} tabIndex={-1} className="jr-end" />
    </section>
  );
}
