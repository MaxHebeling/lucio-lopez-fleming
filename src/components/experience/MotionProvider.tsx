"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isCalmRoute, onIdle, syncMotionAttribute } from "./motion/config";
import { initHeroDepth, initMagnetic, initParallax } from "./motion/pointer";
import { initReveal } from "./motion/reveal";
import { initStickyStory } from "./motion/story";
import { destroySmoothScroll, initSmoothScroll } from "./motion/smooth-scroll";

/**
 * Orquesta el movimiento por ruta. No renderiza nada. Cada init devuelve su limpieza y todo se reinicia al
 * cambiar de ruta. Lenis entra en idle y nunca en rutas "calmas" (búsqueda, ficha, formularios).
 */
export function MotionProvider() {
  const pathname = usePathname();

  useEffect(() => syncMotionAttribute(), []);

  useEffect(() => {
    const calm = isCalmRoute(pathname);
    const cleanups: Array<() => void> = [initReveal(), initStickyStory()];
    if (!calm) {
      cleanups.push(initParallax(), initMagnetic());
      const hero = document.querySelector<HTMLElement>("[data-hero]");
      if (hero) cleanups.push(initHeroDepth(hero));
    }
    let cancelled = false;
    let cancelIdle = () => {};
    if (calm) destroySmoothScroll();
    else
      cancelIdle = onIdle(() => {
        if (!cancelled) void initSmoothScroll();
      }, 3000);
    return () => {
      cancelled = true;
      cancelIdle();
      for (const c of cleanups) c();
    };
  }, [pathname]);

  useEffect(() => () => destroySmoothScroll(), []);
  return null;
}
