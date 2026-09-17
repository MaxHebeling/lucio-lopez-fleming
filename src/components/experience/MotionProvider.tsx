"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isCalmRoute, onIdle, scenesApply, syncMotionAttribute } from "./motion/config";
import { initHeroDepth, initMagnetic } from "./motion/pointer";
import { initReveal } from "./motion/reveal";
import { initLazySvgImages, initSteps } from "./motion/steps";
import { destroySmoothScroll, initCoverFocus, initSmoothScroll } from "./motion/smooth-scroll";

/**
 * Orquesta el movimiento por ruta. No renderiza nada. Cada init devuelve su limpieza y todo se reinicia al cambiar de
 * ruta o de preferencia de movimiento. El motor de escenas (Lenis + GSAP/ScrollTrigger) entra en idle, solo en desktop
 * con puntero fino y nunca en rutas "calmas" (búsqueda, ficha, formularios): ver motion/smooth-scroll.ts.
 */
export function MotionProvider() {
  const pathname = usePathname();
  const [preference, setPreference] = useState(0);

  useEffect(() => syncMotionAttribute(() => setPreference((n) => n + 1)), []);

  useEffect(() => {
    const calm = isCalmRoute(pathname);
    const cleanups: Array<() => void> = [initReveal(), initSteps(), initLazySvgImages()];
    const cover = document.querySelector<HTMLElement>("[data-hero]");
    if (cover) cleanups.push(initCoverFocus(cover));
    if (!calm) {
      cleanups.push(initMagnetic());
      if (cover) cleanups.push(initHeroDepth(cover));
    }
    let cancelled = false;
    let cancelIdle = () => {};
    let cleanupScenes = () => {};
    if (calm || !scenesApply()) destroySmoothScroll();
    else
      cancelIdle = onIdle(() => {
        void initSmoothScroll().then(async (engine) => {
          if (cancelled || !engine) return;
          const { initScenes } = await import("./motion/scenes");
          if (!cancelled) cleanupScenes = initScenes(engine);
        });
      }, 3000);
    return () => {
      cancelled = true;
      cancelIdle();
      cleanupScenes();
      for (const c of cleanups) c();
    };
  }, [pathname, preference]);

  useEffect(() => () => destroySmoothScroll(), []);
  return null;
}
