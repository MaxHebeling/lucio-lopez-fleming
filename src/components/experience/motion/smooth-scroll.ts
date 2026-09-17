import type Lenis from "lenis";
import type { gsap as GsapType } from "gsap";
import type { ScrollTrigger as ScrollTriggerType } from "gsap/ScrollTrigger";
import { scenesApply } from "./config";

/**
 * Motor de scroll (solo desktop con puntero fino y sin reduced motion): Lenis + GSAP/ScrollTrigger, importados en idle
 * con `import()` para que nunca entren en el bundle inicial ni en la ruta del LCP. Un único reloj: el ticker de GSAP
 * mueve Lenis y cada scroll de Lenis actualiza ScrollTrigger. Singleton idempotente; destroySmoothScroll() lo apaga
 * (rutas "calmas", desmontaje, cambio a reduced motion).
 */
export type Engine = { lenis: Lenis; gsap: typeof GsapType; ScrollTrigger: typeof ScrollTriggerType };

let engine: Engine | null = null;
let loading: Promise<Engine | null> | null = null;
let tick: ((time: number) => void) | null = null;

export function initSmoothScroll(): Promise<Engine | null> {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  if (!scenesApply()) return Promise.resolve(null);
  loading = Promise.all([import("lenis"), import("gsap"), import("gsap/ScrollTrigger")])
    .then(([{ default: LenisCtor }, { gsap }, { ScrollTrigger }]) => {
      if (engine || !scenesApply()) return engine;
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new LenisCtor({ lerp: 0.12, smoothWheel: true, syncTouch: false, anchors: true, autoRaf: false, allowNestedScroll: true });
      lenis.on("scroll", ScrollTrigger.update);
      tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      engine = { lenis, gsap, ScrollTrigger };
      // Las fuentes y las fotos cambian alturas: se recalculan los disparadores cuando terminan de cargar.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
      if (document.readyState !== "complete") window.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
      return engine;
    })
    .catch((e: unknown) => {
      console.error("[motion] no se pudo cargar el motor de scroll", e);
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function destroySmoothScroll(): void {
  if (!engine) return;
  if (tick) engine.gsap.ticker.remove(tick);
  tick = null;
  engine.lenis.destroy();
  engine = null;
}

export function pauseSmoothScroll(): void {
  engine?.lenis.stop();
}

export function resumeSmoothScroll(): void {
  engine?.lenis.start();
}
