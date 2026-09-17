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

/**
 * Último ancla de la misma página pedida con un clic (Lenis la anima con `anchors: true`). Si el layout cambia durante
 * ese scroll suave (el recorrido de la portada cambia de alto al montar escenas o fijarse), `reaimAnchor()` vuelve a
 * apuntar al elemento. Se registra junto con Lenis para no perder clics hechos antes de que carguen las escenas.
 */
let pendingAnchor: { el: HTMLElement; until: number } | null = null;
const ANCHOR_WINDOW_MS = 5000;
const onAnchorClick = (e: MouseEvent) => {
  const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href*="#"]') : null;
  if (!link) return;
  const url = new URL(link.href, location.href);
  if (url.pathname !== location.pathname || url.hash.length < 2) return;
  const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
  pendingAnchor = el ? { el, until: performance.now() + ANCHOR_WINDOW_MS } : null;
};
const cancelAnchor = () => {
  pendingAnchor = null;
};
const ANCHOR_CANCEL_EVENTS = ["wheel", "touchstart", "keydown"] as const;

export function reaimAnchor(): void {
  if (!engine || !pendingAnchor) return;
  if (performance.now() > pendingAnchor.until || !pendingAnchor.el.isConnected) {
    pendingAnchor = null;
    return;
  }
  // Posición real (window.scrollY): tras un refresh, el scroll interno de Lenis puede estar desfasado.
  const margin = Number.parseFloat(getComputedStyle(pendingAnchor.el).scrollMarginTop) || 0;
  engine.lenis.resize();
  engine.lenis.scrollTo(Math.max(0, pendingAnchor.el.getBoundingClientRect().top + window.scrollY - margin), { force: true });
}

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
      document.addEventListener("click", onAnchorClick, true);
      for (const type of ANCHOR_CANCEL_EVENTS) window.addEventListener(type, cancelAnchor, { passive: true });
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
  document.removeEventListener("click", onAnchorClick, true);
  for (const type of ANCHOR_CANCEL_EVENTS) window.removeEventListener(type, cancelAnchor);
  pendingAnchor = null;
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
