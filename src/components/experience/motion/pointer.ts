import { MOTION, clamp, finePointer, motionEnabled, noop } from "./config";

/**
 * Profundidad del hero: capas `[data-depth]` siguen el puntero ≤ MOTION.heroDepthPx con interpolación.
 * Solo desktop con puntero fino. Un único rAF que se detiene al llegar al reposo.
 */
export function initHeroDepth(root: HTMLElement): () => void {
  if (!motionEnabled() || !finePointer()) return noop;
  const layers = Array.from(root.querySelectorAll<HTMLElement>("[data-depth]")).map((el) => ({ el, depth: clamp(Number(el.dataset.depth) || 1, -2, 2) }));
  if (!layers.length) return noop;
  let raf = 0;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  const tick = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    for (const { el, depth } of layers) el.style.transform = `translate3d(${(cx * depth).toFixed(2)}px, ${(cy * depth).toFixed(2)}px, 0)`;
    raf = Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05 ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const onMove = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    tx = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1) * MOTION.heroDepthPx;
    ty = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1) * MOTION.heroDepthPx;
    kick();
  };
  const onLeave = () => {
    tx = 0;
    ty = 0;
    kick();
  };
  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave);
  return () => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    if (raf) cancelAnimationFrame(raf);
    for (const { el } of layers) el.style.transform = "";
  };
}

/** CTA magnéticos `[data-magnetic]` (≤ 4 px, siempre hacia el cursor). Solo puntero fino. */
export function initMagnetic(): () => void {
  if (!motionEnabled() || !finePointer()) return noop;
  const cleanups = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]")).map((el) => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = clamp((e.clientX - (r.left + r.width / 2)) * 0.12, -MOTION.magneticMaxPx, MOTION.magneticMaxPx);
      const y = clamp((e.clientY - (r.top + r.height / 2)) * 0.12, -MOTION.magneticMaxPx, MOTION.magneticMaxPx);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.style.transform = "";
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      onLeave();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  });
  return () => cleanups.forEach((c) => c());
}

/** Parallax `[data-parallax="0.08"]` ≤ MOTION.parallaxMaxPx. Solo desktop; lecturas y escrituras por frame. */
export function initParallax(): () => void {
  if (!motionEnabled() || !finePointer()) return noop;
  const items = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]")).map((el) => ({ el, speed: clamp(Number(el.dataset.parallax) || 0.08, -0.4, 0.4) }));
  if (!items.length) return noop;
  let raf = 0;
  const update = () => {
    raf = 0;
    const vh = window.innerHeight;
    const rects = items.map((i) => i.el.getBoundingClientRect());
    items.forEach(({ el, speed }, i) => {
      const r = rects[i]!;
      if (r.bottom < -100 || r.top > vh + 100) return;
      const y = clamp(-(r.top + r.height / 2 - vh / 2) * speed, -MOTION.parallaxMaxPx, MOTION.parallaxMaxPx);
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    });
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  schedule();
  return () => {
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (raf) cancelAnimationFrame(raf);
    for (const { el } of items) el.style.transform = "";
  };
}
