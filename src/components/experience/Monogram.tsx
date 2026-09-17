import type { CSSProperties } from "react";

/**
 * Monograma LLF (recreado en vector desde el logo original, ver scripts/site/brand-assets.ts).
 * Cada trazo es un polígono propio: con `draw` se "dibujan" en secuencia (transform + opacity, CSS en site.css).
 * Los trazos se superponen: la silueta final es idéntica al monograma original.
 */
const STROKES: Array<{ d: string; origin: string; sx: number; sy: number }> = [
  { d: "M0 114 L33 95 L33 345 L0 351 Z", origin: "50% 100%", sx: 1, sy: 0 },
  { d: "M0 351 L35 331 L198 423 L233 443 L233 481 Z", origin: "0% 0%", sx: 0, sy: 0 },
  { d: "M198 1 L233 21 L233 481 L198 461 Z", origin: "50% 100%", sx: 1, sy: 0 },
  { d: "M198 1 L411 118 L410 156 L233 59 L198 39 Z", origin: "0% 0%", sx: 0, sy: 0 },
  { d: "M233 205 L378 289 L378 328 L233 248 Z", origin: "0% 0%", sx: 0, sy: 0 },
  { d: "M100 57 L131 38 L133 290 L100 296 Z", origin: "50% 0%", sx: 1, sy: 0 },
  { d: "M100 296 L133 275 L172 298 L172 336 Z", origin: "0% 0%", sx: 0, sy: 0 },
];
const DRAW_ORDER = [0, 5, 2, 1, 6, 3, 4];

export function Monogram({ className, draw = false, delayMs = 0, title }: { className?: string; draw?: boolean; delayMs?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 412 482"
      className={`${draw ? "mono-draw " : ""}${className ?? ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ "--mono-delay": `${delayMs}ms` } as CSSProperties}
    >
      <g fill="currentColor">
        {STROKES.map((s, i) => (
          <path
            key={i}
            d={s.d}
            className="mono-stroke"
            style={{ transformOrigin: s.origin, "--s": DRAW_ORDER.indexOf(i), "--sx": s.sx, "--sy": s.sy } as CSSProperties}
          />
        ))}
      </g>
    </svg>
  );
}
