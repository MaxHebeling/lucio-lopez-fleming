import type { CSSProperties, ReactNode } from "react";
import type { JourneyScene } from "./hero-journey";
import { HeroMedia } from "./HeroMedia";

const nn = (n: number) => String(n).padStart(2, "0");

/**
 * Una escena del recorrido (`li`): foto(s) en su encuadre + texto real (label numerado, título, frase). El texto es
 * HTML visible para lectores de pantalla en todo momento; el motor solo cambia opacidad/posición.
 *
 * Capas (profundidad): numeral gigante al fondo → encuadre con la foto (arquitectura) → texto → detalle (línea de
 * agrimensura y, en escenas verticales, la losa que marca el cambio de nivel).
 */
export function HeroScene({ scene, number, total, children }: { scene: JourneyScene; number: number; total: number; children?: ReactNode }) {
  const first = scene.media[0];
  const ratio = first ? first.width / first.height : 4 / 3;
  return (
    <li
      className="jr-scene"
      data-jr-scene={scene.id}
      data-transition={scene.transition}
      data-frame={scene.frame}
      data-static={scene.static ? "" : undefined}
      data-mobile={scene.mobile ? "" : undefined}
      aria-labelledby={`jr-${scene.id}-title`}
      style={{ "--ar": ratio.toFixed(4), "--n": scene.media.length } as CSSProperties}
    >
      <span className="jr-num display" data-jr-num aria-hidden>
        {nn(number)}
      </span>
      <div className="jr-clip" data-jr-clip>
        <figure className="jr-frame" data-jr-frame>
          <div className="jr-reel" data-jr-reel>
            {scene.media.map((m, i) => (
              <HeroMedia key={m.src} media={m} frame={scene.frame} index={i} />
            ))}
          </div>
          <span className="jr-frame-shade" data-jr-shade aria-hidden />
        </figure>
      </div>
      {scene.levels?.length ? (
        <span className="jr-slab" data-jr-slab aria-hidden>
          <span className="jr-slab-line" />
          <span className="jr-slab-label">{scene.levels[scene.levels.length - 1]}</span>
        </span>
      ) : null}
      <div className="jr-caption" data-jr-caption>
        <p className="jr-label">
          <span className="tabular">
            {nn(number)}
            <span className="sr-only"> de {nn(total)}</span>
          </span>
          <span className="jr-rule" data-jr-rule aria-hidden />
          <span>{scene.label}</span>
        </p>
        <h2 id={`jr-${scene.id}-title`} className="jr-title display">
          {scene.title}
        </h2>
        {scene.phrase ? <p className="jr-phrase">{scene.phrase}</p> : null}
        {scene.levels?.length ? (
          <p className="jr-levels" data-jr-levels>
            {scene.levels.map((level, i) => (
              <span key={level} className="jr-level" data-jr-level={i}>
                {i > 0 ? (
                  <span className="jr-level-arrow" aria-hidden>
                    →
                  </span>
                ) : null}
                {level}
              </span>
            ))}
          </p>
        ) : null}
        {children}
      </div>
    </li>
  );
}
