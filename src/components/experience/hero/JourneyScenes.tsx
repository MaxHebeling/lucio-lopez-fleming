"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import type { HeroScenesProps } from "./HeroScenes";

/**
 * Isla cliente de las escenas del recorrido: chunk propio (JS + journey.css) que se descarga después de hidratar, fuera
 * de la ruta del LCP. Mientras llega, un espacio reservado de alto aproximado (solo con JS: sin JS no se reserva nada)
 * evita que el contenido siguiente salte si alguien ya scrolleó.
 */
const HeroScenes = dynamic(() => import("./HeroScenes"), {
  ssr: false,
  loading: () => null,
});

export function JourneyScenes(props: HeroScenesProps & { scenes: number; mobileScenes: number }) {
  const { scenes, mobileScenes, ...rest } = props;
  return (
    <div className="jr-slot" style={{ "--jr-scenes": scenes, "--jr-scenes-mobile": mobileScenes } as CSSProperties}>
      <HeroScenes {...rest} />
    </div>
  );
}
