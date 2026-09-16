import { motionEnabled, noop } from "./config";

/**
 * Revelados al entrar en pantalla (nivel 3). Nada arranca oculto en el HTML: al iniciar, solo lo que está
 * entero por debajo del viewport recibe `.reveal-wait`; al entrar pasa a `.reveal-in` (transición CSS).
 * Marcado: `data-reveal="up|fade|scale|line|mask"`, `--reveal-delay` o `data-reveal-group="70"` en el contenedor.
 * Dentro de filas con scroll horizontal (`data-reveal-row`) no se oculta nada (el scroller recorta la intersección).
 */
export function initReveal(root: ParentNode = document): () => void {
  const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]:not(.reveal-in)"));
  if (!els.length) return noop;
  if (!motionEnabled() || !("IntersectionObserver" in window)) {
    for (const el of els) el.classList.add("reveal-in");
    return noop;
  }
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-reveal-group]"))) {
    const step = Number(group.dataset.revealGroup) || 70;
    Array.from(group.querySelectorAll<HTMLElement>("[data-reveal]")).forEach((child, i) => {
      if (!child.style.getPropertyValue("--reveal-delay")) child.style.setProperty("--reveal-delay", `${Math.min(i, 6) * step}ms`);
    });
  }
  const inRow = (el: HTMLElement) => {
    const row = el.closest<HTMLElement>("[data-reveal-row]");
    return Boolean(row && row.scrollWidth > row.clientWidth + 1);
  };
  const show = (el: HTMLElement) => {
    el.classList.remove("reveal-wait");
    el.classList.add("reveal-in");
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) {
          show(el);
          io.unobserve(el);
        } else if (!el.classList.contains("reveal-wait")) {
          if (e.boundingClientRect.top >= window.innerHeight && !inRow(el)) el.classList.add("reveal-wait");
          else {
            show(el);
            io.unobserve(el);
          }
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );
  for (const el of els) io.observe(el);
  return () => {
    io.disconnect();
    for (const el of els) if (el.classList.contains("reveal-wait")) show(el);
  };
}
