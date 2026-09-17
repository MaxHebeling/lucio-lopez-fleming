/**
 * Sistema de movimiento del sitio público (ver docs/WEB_EXPERIENCE.md §5).
 * Progresivo: sin JS o con `prefers-reduced-motion` todo se ve completo y quieto. Lo que oculta o desplaza
 * contenido cuelga de `html[data-motion="on"]`, que fija MOTION_BOOT_SCRIPT antes del primer paint.
 *
 * Capas:
 *  1. CSS (todas las pantallas): entrada de la portada, revelados, microinteracciones. 0 KB de JS propio.
 *  2. IntersectionObserver (todas): revelados al entrar, paso activo de las historias con pasos.
 *  3. Motor de escenas (solo desktop con puntero fino): Lenis + GSAP/ScrollTrigger importados en idle, nunca en la
 *     ruta del LCP. Transformaciones ligadas al scroll (portada, manifiesto, parallax, Salta, cierre).
 */
export const MOTION = {
  /** Lenis + escenas GSAP: solo desktop con puntero fino; se importan diferidos (idle). */
  scenes: true,
  /** Rutas donde el movimiento distrae de la tarea (nivel 5: crítico): sin Lenis, escenas ni magnetismo. */
  calmRoutes: [/^\/propiedades(\/|$)/, /^\/contacto/, /^\/tasaciones/, /^\/terminos/, /^\/privacidad/],
  /** Profundidad de la portada con el puntero (px). Brief: ≤ 6–8. */
  heroDepthPx: 6,
  /** Parallax de fotos editoriales (px, a cada lado del centro). Brief: 20–40. */
  parallaxMaxPx: 32,
  /** Atracción de CTA principales (px). Nunca "huyen" del cursor. */
  magneticMaxPx: 4,
} as const;

export const REDUCED_MQ = "(prefers-reduced-motion: reduce)";
export const FINE_POINTER_MQ = "(hover: hover) and (pointer: fine)";
export const DESKTOP_MQ = "(min-width: 1024px)";

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

/** ¿Corresponde el motor de escenas (Lenis + GSAP)? Desktop, puntero fino y movimiento permitido. */
export function scenesApply(): boolean {
  return MOTION.scenes && motionEnabled() && finePointer() && window.matchMedia(DESKTOP_MQ).matches;
}

/** Mantiene `data-motion` al día si el usuario cambia la preferencia con la página abierta. */
export function syncMotionAttribute(onChange?: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MQ);
  const apply = () => document.documentElement.setAttribute("data-motion", mq.matches ? "reduced" : "on");
  const changed = () => {
    apply();
    onChange?.();
  };
  apply();
  mq.addEventListener("change", changed);
  return () => mq.removeEventListener("change", changed);
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
