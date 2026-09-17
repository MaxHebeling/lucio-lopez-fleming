import { noop } from "./config";

/**
 * Historias con pasos (`[data-steps]`): marca el paso activo (`[data-step]`) según cuál cruza la franja central del
 * viewport y lo refleja en el contenedor (`data-active`) y en los elementos que se encienden por paso
 * (`[data-step-light="n"]` → `data-on` cuando n ≤ paso activo). El CSS cruza fotos, mueve el indicador y enciende los
 * trazos. Funciona también con el movimiento reducido (sin transición): el paso activo es información, no adorno.
 */
export function initSteps(): () => void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-steps]"));
  if (!roots.length || !("IntersectionObserver" in window)) return noop;
  const observers = roots.map((root) => {
    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
    const lights = Array.from(root.querySelectorAll<HTMLElement | SVGElement>("[data-step-light]"));
    const total = steps.length;
    const activate = (i: number) => {
      root.setAttribute("data-active", String(i));
      root.style.setProperty("--step-progress", String(total ? (i + 1) / total : 1));
      for (const l of lights) l.toggleAttribute("data-on", Number(l.getAttribute("data-step-light")) <= i);
    };
    root.setAttribute("data-steps-ready", "");
    activate(0);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) activate(Number((e.target as HTMLElement).dataset.step) || 0);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    steps.forEach((s) => io.observe(s));
    return () => {
      io.disconnect();
      root.removeAttribute("data-steps-ready");
      root.removeAttribute("data-active");
      for (const l of lights) l.removeAttribute("data-on");
    };
  });
  return () => observers.forEach((o) => o());
}

/**
 * Fondos diferidos (`[data-lazy-bg="url"]`): un background-image se descarga apenas el elemento se pinta, esté o no en
 * pantalla. Se asigna como `--lazy-bg` y se marca `data-bg-ready` cuando el elemento se acerca al viewport.
 * Sin JS el elemento conserva su estilo de respaldo.
 */
export function initLazyBackgrounds(): () => void {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-lazy-bg]:not([data-bg-ready])"));
  if (!els.length) return noop;
  const load = (el: HTMLElement) => {
    const url = el.dataset.lazyBg;
    if (!url) return;
    el.style.setProperty("--lazy-bg", `url("${url.replace(/"/g, "%22")}")`);
    el.setAttribute("data-bg-ready", "");
  };
  if (!("IntersectionObserver" in window)) {
    els.forEach(load);
    return noop;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        load(e.target as HTMLElement);
        io.unobserve(e.target);
      }
    },
    { rootMargin: "800px 0px" },
  );
  els.forEach((el) => io.observe(el));
  return () => io.disconnect();
}
