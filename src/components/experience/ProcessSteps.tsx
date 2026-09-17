import type { CSSProperties } from "react";
import { MONOGRAM_DRAW_ORDER, MONOGRAM_STROKES } from "./Monogram";
import { TextReveal } from "./Reveal";

export type ProcessStep = { title: string; body: string };

/**
 * «Una operación, de punta a punta». Desktop: a la izquierda (sticky) el monograma LLF se completa trazo a trazo a
 * medida que avanzan los pasos, con el número del paso activo y una barra de progreso; a la derecha los pasos.
 * Mobile: línea de tiempo vertical. El paso activo lo marca motion/steps.ts (IntersectionObserver, sin librerías).
 * Sin JS: monograma completo y todos los pasos legibles.
 */
export function ProcessSteps({ id, eyebrow, title, intro, steps }: { id: string; eyebrow: string; title: [string, string]; intro: string; steps: ProcessStep[] }) {
  const n = steps.length;
  // Paso i enciende los trazos hasta `lit[i]` (el último paso completa el monograma).
  const lit = steps.map((_, i) => (i === n - 1 ? MONOGRAM_STROKES.length : Math.max(1, Math.round(((i + 1) / n) * MONOGRAM_STROKES.length))));
  const stepOfStroke = (drawIndex: number) => lit.findIndex((k) => drawIndex < k);
  return (
    <section className="scene process" aria-labelledby={`${id}-title`} data-steps>
      <div className="container-site process-grid">
        <div className="process-aside">
          <div className="process-sticky">
            <p className="eyebrow text-brick">{eyebrow}</p>
            <TextReveal id={`${id}-title`} as="h2" className="display h2 mt-5" lines={[title[0], <em key="t">{title[1]}</em>]} />
            <p className="process-intro">{intro}</p>
            <div className="process-visual" aria-hidden>
              <svg viewBox="0 0 412 482" className="process-mono" focusable="false">
                {MONOGRAM_STROKES.map((s, i) => (
                  <path key={i} d={s.d} className="process-stroke" data-step-light={stepOfStroke(MONOGRAM_DRAW_ORDER.indexOf(i))} />
                ))}
              </svg>
              <div className="process-counter">
                <span className="process-current display tabular">
                  {steps.map((_, i) => (
                    <span key={i} data-idx={i}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  ))}
                </span>
                <span className="process-total tabular">/ {String(n).padStart(2, "0")}</span>
              </div>
              <span className="process-bar">
                <span />
              </span>
            </div>
          </div>
        </div>
        <ol className="process-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="process-step" data-step={i} style={{ "--i": i } as CSSProperties}>
              <span className="process-step-num tabular">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="display process-step-title">{s.title}</h3>
                <p className="process-step-body">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
