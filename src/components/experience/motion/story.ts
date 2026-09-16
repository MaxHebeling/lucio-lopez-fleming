import { noop } from "./config";

/**
 * Sticky story: marca el paso activo (`data-story-step`) según cuál cruza la mitad del viewport y lo refleja en
 * el contenedor (`data-active`). El CSS cruza las fotos (opacity) y mueve el indicador (transform).
 * Funciona aunque el movimiento esté reducido (solo cambia sin transición): el estado activo es información.
 */
export function initStickyStory(): () => void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-story]"));
  if (!roots.length || !("IntersectionObserver" in window)) return noop;
  const observers = roots.map((root) => {
    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-story-step]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) root.setAttribute("data-active", (e.target as HTMLElement).dataset.storyStep ?? "0");
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    steps.forEach((s) => io.observe(s));
    return io;
  });
  return () => observers.forEach((o) => o.disconnect());
}
