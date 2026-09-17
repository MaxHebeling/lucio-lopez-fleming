import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

export type HeroCta = { href: string; label: string };

/**
 * Titular de la portada (marca): kicker, titular real por líneas, bajada y CTA. Entrada en CSS (≈1 s, sin JS).
 * `data-cover-copy` es el nodo que el recorrido desvanece al empezar a scrollear (no tiene animación CSS propia: las
 * animaciones con fill ganarían a los estilos inline).
 */
export function HeroHeadline({ kicker, titleLines, lede, primary, secondary }: { kicker: string; titleLines: ReactNode[]; lede: string; primary: HeroCta; secondary: HeroCta }) {
  return (
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
  );
}
