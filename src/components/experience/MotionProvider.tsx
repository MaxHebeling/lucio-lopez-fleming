"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isCalmRoute, onIdle, scenesApply, syncMotionAttribute } from "./motion/config";
import { initHeroDepth, initMagnetic } from "./motion/pointer";
import { initReveal } from "./motion/reveal";
import { initLazyBackgrounds, initSteps } from "./motion/steps";
import { destroySmoothScroll, initSmoothScroll } from "./motion/smooth-scroll";

/**
 * Orquesta el movimiento por ruta. No renderiza nada. Cada init devuelve su limpieza y todo se reinicia al cambiar de
 * ruta o de preferencia de movimiento. El motor de escenas (Lenis + GSAP/ScrollTrigger) entra en idle, solo en desktop
 * con puntero fino y nunca en rutas "calmas" (búsqueda, ficha, formularios): ver motion/smooth-scroll.ts. Con el motor,
 * el recorrido de la portada (motion/journey.ts) pasa al modo fijado; sin motor queda en su versión CSS.
 */
export function MotionProvider() {
  const pathname = usePathname();
  const [preference, setPreference] = useState(0);

  useEffect(() => syncMotionAttribute(() => setPreference((n) => n + 1)), []);

  useEffect(() => {
    const calm = isCalmRoute(pathname);
    const cleanups: Array<() => void> = [initReveal(), initSteps(), initLazyBackgrounds()];
    const cover = document.querySelector<HTMLElement>("[data-hero]");
    if (!calm) {
      cleanups.push(initMagnetic());
      if (cover) cleanups.push(initHeroDepth(cover));
    }
    let cancelled = false;
    let cancelIdle = () => {};
    let cleanupScenes = () => {};
    let cleanupJourney = () => {};
    if (calm || !scenesApply()) destroySmoothScroll();
    else
      cancelIdle = onIdle(() => {
        void initSmoothScroll().then(async (engine) => {
          if (cancelled || !engine) return;
          // El recorrido de la portada primero: cambia el alto del home y las escenas siguientes miden después.
          const [{ initJourney, markScrollTriggers }, { initScenes }] = await Promise.all([import("./motion/journey"), import("./motion/scenes")]);
          if (cancelled) return;
          cleanupJourney = initJourney(engine);
          cleanupScenes = initScenes(engine);
          markScrollTriggers(engine);
        });
      }, 3000);
    return () => {
      cancelled = true;
      cancelIdle();
      cleanupScenes();
      cleanupJourney();
      document.documentElement.removeAttribute("data-scroll-triggers");
      for (const c of cleanups) c();
    };
  }, [pathname, preference]);

  useEffect(() => () => destroySmoothScroll(), []);
  return null;
}
