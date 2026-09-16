/**
 * Sistema de movimiento del sitio público (ver docs/WEB_EXPERIENCE.md §5).
 * Progresivo: sin JS o con `prefers-reduced-motion` todo se ve completo y quieto. Lo que oculta o desplaza
 * contenido cuelga de `html[data-motion="on"]`, que fija MOTION_BOOT_SCRIPT antes del primer paint.
 */
export const MOTION = {
  /** Lenis solo en desktop con puntero fino; se importa diferido (idle). */
  smoothScroll: true,
  /** Rutas donde el movimiento distrae de la tarea (nivel 5: crítico): sin Lenis, parallax ni magnetismo. */
  calmRoutes: [/^\/propiedades(\/|$)/, /^\/contacto/, /^\/tasaciones/, /^\/terminos/, /^\/privacidad/],
  /** Profundidad del hero con el puntero (px). Brief: ≤ 8. */
  heroDepthPx: 8,
  /** Parallax de fotos editoriales (px). */
  parallaxMaxPx: 24,
  /** Atracción de CTA principales (px). Nunca "huyen" del cursor. */
  magneticMaxPx: 4,
} as const;

export const REDUCED_MQ = "(prefers-reduced-motion: reduce)";
export const FINE_POINTER_MQ = "(hover: hover) and (pointer: fine)";

/** Script inline (~200 B) al inicio del sitio: marca el documento antes del primer paint. */
export const MOTION_BOOT_SCRIPT = `(function(){var d=document.documentElement;try{d.setAttribute("data-motion",window.matchMedia("${REDUCED_MQ}").matches?"reduced":"on")}catch(e){d.setAttribute("data-motion","reduced")}})();`;

export const noop = (): void => {};

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function isCalmRoute(pathname: string): boolean {
  return MOTION.calmRoutes.some((r) => r.test(pathname));
}

export function motionEnabled(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "on";
}

export function finePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(FINE_POINTER_MQ).matches;
}

/** Mantiene `data-motion` al día si el usuario cambia la preferencia con la página abierta. */
export function syncMotionAttribute(): () => void {
  const mq = window.matchMedia(REDUCED_MQ);
  const apply = () => document.documentElement.setAttribute("data-motion", mq.matches ? "reduced" : "on");
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}

/** Ejecuta `cb` con el hilo libre (o tras `timeout`). Devuelve el cancelador. */
export function onIdle(cb: () => void, timeout = 2000): () => void {
  if (typeof window === "undefined") return noop;
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(cb, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(cb, Math.min(timeout, 800));
  return () => window.clearTimeout(id);
}
