import { MOTION, clamp } from "./config";
import type { Engine } from "./smooth-scroll";

/**
 * Escenas ligadas al scroll (solo con el motor cargado: desktop, puntero fino, sin reduced motion).
 * Todo parte del HTML completo y visible: los estados iniciales los fija GSAP recién acá y `ctx.revert()` los quita
 * (cambio de ruta, desmontaje, reduced motion). Solo transform y opacity, sobre nodos que el CSS no anima
 * (las animaciones CSS con fill ganan a los estilos inline).
 *
 * Marcado:
 * La portada (recorrido arquitectónico) tiene su propia línea de tiempo: motion/journey.ts.
 *  [data-scene="words"]   las `.word` pasan de 0.5 a 1 de opacidad con el scroll (texto display ≥ 24 px: AA en todo momento).
 *  [data-parallax-y="28"] capa interna de una foto: ±28 px mientras cruza el viewport.
 *  [data-drift="4"]       tipografía gigante: ±4 % en X mientras cruza el viewport.
 *  [data-scene="settle"]  la foto de una portada asienta su escala (1.12 → 1) al entrar.
 */
export function initScenes({ gsap, ScrollTrigger }: Engine): () => void {
  const ctx = gsap.context(() => {
    for (const el of gsap.utils.toArray<HTMLElement>('[data-scene="words"]')) {
      const words = el.querySelectorAll(".word");
      if (!words.length) continue;
      gsap.fromTo(words, { opacity: 0.5 }, { opacity: 1, ease: "none", stagger: 0.08, scrollTrigger: { trigger: el, start: "top 82%", end: "bottom 50%", scrub: true } });
    }

    for (const el of gsap.utils.toArray<HTMLElement>("[data-parallax-y]")) {
      const px = clamp(Math.abs(Number(el.dataset.parallaxY) || 24), 0, MOTION.parallaxMaxPx);
      gsap.fromTo(el, { y: -px }, { y: px, ease: "none", scrollTrigger: { trigger: el.parentElement ?? el, start: "top bottom", end: "bottom top", scrub: true } });
    }

    for (const el of gsap.utils.toArray<HTMLElement>("[data-drift]")) {
      const pct = clamp(Number(el.dataset.drift) || 4, -12, 12);
      gsap.fromTo(el, { xPercent: pct }, { xPercent: -pct, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } });
    }

    for (const el of gsap.utils.toArray<HTMLElement>('[data-scene="settle"]')) {
      gsap.fromTo(el, { scale: 1.12 }, { scale: 1, ease: "none", scrollTrigger: { trigger: el.parentElement ?? el, start: "top bottom", end: "top 25%", scrub: true } });
    }
  });
  ScrollTrigger.refresh();
  return () => ctx.revert();
}
