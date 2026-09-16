import type Lenis from "lenis";
import { MOTION, finePointer, motionEnabled } from "./config";

/**
 * Lenis diferido: import dinámico en idle, solo desktop ≥ 1024 px con puntero fino y sin reduced motion.
 * Singleton idempotente; destroySmoothScroll() limpia todo (rutas "calmas", desmontaje).
 */
let lenis: Lenis | null = null;
let loading: Promise<Lenis | null> | null = null;

function applies(): boolean {
  return MOTION.smoothScroll && motionEnabled() && finePointer() && window.matchMedia("(min-width: 1024px)").matches;
}

export function initSmoothScroll(): Promise<Lenis | null> {
  if (lenis) return Promise.resolve(lenis);
  if (loading) return loading;
  if (!applies()) return Promise.resolve(null);
  loading = import("lenis")
    .then(({ default: LenisCtor }) => {
      if (lenis || !applies()) return lenis;
      lenis = new LenisCtor({ lerp: 0.12, smoothWheel: true, syncTouch: false, anchors: true, autoRaf: true, allowNestedScroll: true });
      return lenis;
    })
    .catch((e: unknown) => {
      console.error("[motion] no se pudo cargar el desplazamiento suave", e);
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function destroySmoothScroll(): void {
  lenis?.destroy();
  lenis = null;
}

export function pauseSmoothScroll(): void {
  lenis?.stop();
}

export function resumeSmoothScroll(): void {
  lenis?.start();
}
