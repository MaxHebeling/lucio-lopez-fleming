import type { CSSProperties } from "react";
import type { JourneyFrame, JourneyMedia } from "./hero-journey";

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

/** Optimizador de next/image (AVIF/WebP) con pocos anchos: el recorrido suma varias fotos y el HTML de la portada no debe crecer. */
function optimized(src: string, w: number) {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=65`;
}

/**
 * Una foto del recorrido. Siempre `lazy` y con prioridad baja: nunca compite con la portada (LCP). Con JS, la escena
 * se habilita (`data-armed`) recién cerca del viewport o, en el modo fijado, cuando el scroll se acerca: así se
 * descarga solo la próxima. `data-aperture` lleva la abertura real de la foto (ventana, puerta, arco).
 */
export function HeroMedia({ media, frame, index }: { media: JourneyMedia; frame: JourneyFrame; index: number }) {
  const widths = media.width > 1400 ? [640, 1080, 1920] : [640, 828, 1080];
  return (
    <div
      className="jr-media"
      data-jr-media={index}
      data-width={media.width}
      data-height={media.height}
      data-aperture={media.aperture ? JSON.stringify(media.aperture) : undefined}
      style={{ "--i": index } as CSSProperties}
    >
      <div className="jr-media-inner" data-jr-media-inner>
        {/* eslint-disable-next-line @next/next/no-img-element -- mismo optimizador de next/image con un srcset corto (ver arriba) */}
        <img
          src={optimized(media.src, widths[widths.length - 1]!)}
          srcSet={widths.map((w) => `${optimized(media.src, w)} ${w}w`).join(", ")}
          sizes={SIZES[frame]}
          width={media.width}
          height={media.height}
          alt={media.alt}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className="jr-img"
          style={{ objectPosition: `${media.focal.x}% ${media.focal.y}%` }}
        />
      </div>
    </div>
  );
}
