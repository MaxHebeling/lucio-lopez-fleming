import Image from "next/image";
import type { CSSProperties } from "react";
import type { JourneyFrame, JourneyMedia } from "./hero-journey";
import { JOURNEY_BLUR } from "./journey-blur";

/**
 * `sizes` = ancho real del encuadre en cada modo (ver journey.css): desktop por tipo de encuadre, tablet a lo ancho
 * del contenedor, mobile a lo ancho de la pantalla menos márgenes. Las fotos de la propiedad miden 1024 px: ningún
 * encuadre de desktop las muestra a más de ~1040 px CSS.
 */
const SIZES: Record<JourneyFrame, string> = {
  stage: "(min-width: 1024px) 58vw, (min-width: 768px) 88vw, 92vw",
  column: "(min-width: 1024px) 34vw, (min-width: 768px) 88vw, 92vw",
  close: "(min-width: 1024px) 46vw, (min-width: 768px) 88vw, 92vw",
};

/**
 * Una foto del recorrido. Siempre `lazy`: no compite con la portada (LCP). En el modo fijado de desktop el motor
 * habilita cada escena recién cuando el scroll se acerca (`data-armed`), así se descarga solo la próxima.
 * `data-aperture` lleva la abertura real de la foto (ventana, puerta, arco) para la transición `through`.
 */
export function HeroMedia({ media, frame, index }: { media: JourneyMedia; frame: JourneyFrame; index: number }) {
  const blur = JOURNEY_BLUR[media.src];
  return (
    <div
      className="jr-media"
      data-jr-media={index}
      data-width={media.width}
      data-height={media.height}
      data-focal={`${media.focal.x} ${media.focal.y}`}
      data-aperture={media.aperture ? JSON.stringify(media.aperture) : undefined}
      style={{ "--i": index } as CSSProperties}
    >
      <div className="jr-media-inner" data-jr-media-inner>
        <Image
          src={media.src}
          alt={media.alt}
          fill
          loading="lazy"
          quality={65}
          sizes={SIZES[frame]}
          placeholder={blur ? "blur" : "empty"}
          blurDataURL={blur}
          className="jr-img"
          style={{ objectPosition: `${media.focal.x}% ${media.focal.y}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}
