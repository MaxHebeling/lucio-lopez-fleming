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
 * Imágenes diferidas dentro de SVG (`<image data-lazy-href>`), que no admiten `loading="lazy"`: el href se asigna
 * cuando la figura se acerca al viewport. Sin JS la figura conserva su relleno de respaldo.
 */
export function initLazySvgImages(): () => void {
  const imgs = Array.from(document.querySelectorAll<SVGImageElement>("image[data-lazy-href]"));
  if (!imgs.length) return noop;
  const load = (img: SVGImageElement) => {
    const href = img.getAttribute("data-lazy-href");
    if (href) img.setAttribute("href", href);
    img.removeAttribute("data-lazy-href");
  };
  if (!("IntersectionObserver" in window)) {
    imgs.forEach(load);
    return noop;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const svg = e.target;
        svg.querySelectorAll<SVGImageElement>("image[data-lazy-href]").forEach(load);
        io.unobserve(svg);
      }
    },
    { rootMargin: "800px 0px" },
  );
  for (const img of imgs) {
    const svg = img.ownerSVGElement ?? img;
    io.observe(svg);
  }
  return () => io.disconnect();
}
