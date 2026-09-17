import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { Journey, ResolvedJourney } from "./hero-journey";
import { HeroHeadline, type HeroCta } from "./HeroHeadline";
import { HeroProgress } from "./HeroProgress";
import { HeroScene } from "./HeroScene";

export const JOURNEY_END_ID = "tras-el-recorrido";

/**
 * Portada + recorrido arquitectónico (docs/WEB_EXPERIENCE.md §4.1). Server component: 0 JS propio. Un mismo HTML,
 * cuatro presentaciones decididas por CSS y por el motor:
 *
 *  - estable (sin JS o con movimiento reducido): portada completa + fila editorial de las escenas `static`;
 *  - flujo (JS + movimiento, sin motor: mobile, tablet, touch, o desktop antes de que cargue GSAP): láminas que se
 *    apilan con transiciones CSS ligadas al scroll (mobile: solo las escenas `mobile`);
 *  - fijado (desktop con puntero fino y el motor cargado en idle, `data-pinned`): escenario sticky con la línea de
 *    tiempo de `motion/journey.ts`.
 *
 * La foto de la portada es el LCP en todas: `eager` + `fetchPriority="high"`, visible desde el primer paint.
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
  const total = journey.scenes.length + 1;
  const labels = ["Portada", ...journey.scenes.map((s) => s.label)];
  return (
    <section className="jr on-dark" data-hero data-journey={journey.kind} aria-labelledby="hero-title">
      <div className="jr-stage" data-jr-stage>
        <span className="jr-paper" data-jr-paper aria-hidden />
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

        <a href={`#${JOURNEY_END_ID}`} className="jr-skip">
          Saltar recorrido <span aria-hidden>↓</span>
        </a>
        <HeroProgress labels={labels} />

        <ol className="jr-scenes" aria-label={journey.name}>
          {journey.scenes.map((scene, i) => (
            <HeroScene key={scene.id} scene={scene} number={i + 2} total={total}>
              {i === journey.scenes.length - 1 ? <Closing journey={journey} property={property} /> : null}
            </HeroScene>
          ))}
        </ol>
      </div>
      <span id={JOURNEY_END_ID} tabIndex={-1} className="jr-end" />
    </section>
  );
}

/** Cierre: la propiedad real (ficha + datos registrados) o, en el respaldo, la invitación de marca. */
function Closing({ journey, property }: { journey: Journey; property: ResolvedJourney["property"] }) {
  if (journey.kind === "property" && property) {
    return (
      <div className="jr-close">
        <p className="jr-close-meta">{["Salta", `Cód. ${property.code}`, ...property.specs].join(" · ")}</p>
        <div className="jr-close-cta">
          <Link href={property.href} className="btn jr-close-btn btn-arrow">
            Ver la propiedad <span className="sr-only">: casa en Club de Campo El Tipal</span>
            <ArrowRight aria-hidden className="btn-icon size-4" />
          </Link>
          <Link href="/propiedades" className="link-arrow jr-close-link">
            Explorar propiedades <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="jr-close">
      <p className="jr-close-meta">Seriedad, calidad humana, compromiso y experiencia en el rubro.</p>
      <div className="jr-close-cta">
        <Link href="/propiedades" className="btn jr-close-btn btn-arrow">
          Explorar propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
        </Link>
        <Link href="#vender" className="link-arrow jr-close-link">
          Quiero vender mi propiedad <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  );
}
