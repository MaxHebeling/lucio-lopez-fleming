"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { BRAND_JOURNEY, PROPERTY_JOURNEY, type Journey } from "./hero-journey";
import { HeroProgress } from "./HeroProgress";
import { HeroScene } from "./HeroScene";
import "./journey.css";

export type HeroScenesProps = {
  kind: Journey["kind"];
  /** Solo con la propiedad disponible (resuelto en el servidor con datos): ficha real y datos registrados. */
  property: { code: number; href: string; specs: string[] } | null;
  endId: string;
};

/** Evento que avisa al motor (motion/journey.ts) que las escenas ya están en el DOM. */
export const JOURNEY_SCENES_EVENT = "journey:scenes";

/**
 * Escenas del recorrido (cliente, diferido). Texto real en HTML accesible; el motor solo cambia opacidad/posición.
 * Carga progresiva: las fotos esperan (`data-defer`) hasta que su escena se acerca al viewport (IntersectionObserver);
 * en el modo fijado habilita el motor según el avance del scroll.
 */
export default function HeroScenes({ kind, property, endId }: HeroScenesProps) {
  const journey = kind === "property" && property ? PROPERTY_JOURNEY : BRAND_JOURNEY;
  const total = journey.scenes.length + 1;
  const labels = ["Portada", ...journey.scenes.map((s) => s.label)];
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const root = list?.closest<HTMLElement>("[data-journey]");
    if (!list || !root) return;
    const scenes = Array.from(list.querySelectorAll<HTMLElement>("[data-jr-scene]"));
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting || root.hasAttribute("data-pinned")) continue;
            e.target.setAttribute("data-armed", "");
            io?.unobserve(e.target);
          }
        },
        { rootMargin: "0px 0px 35% 0px" },
      );
      scenes.forEach((s) => io?.observe(s));
    } else scenes.forEach((s) => s.setAttribute("data-armed", ""));
    window.dispatchEvent(new Event(JOURNEY_SCENES_EVENT));
    return () => io?.disconnect();
  }, []);

  return (
    <>
      <span className="jr-paper" data-jr-paper aria-hidden />
      <a href={`#${endId}`} className="jr-skip">
        Saltar recorrido <span aria-hidden>↓</span>
      </a>
      <HeroProgress labels={labels} />
      <ol ref={listRef} className="jr-scenes" aria-label={journey.name} data-defer="">
        {journey.scenes.map((scene, i) => (
          <HeroScene key={scene.id} scene={scene} number={i + 2} total={total}>
            {i === journey.scenes.length - 1 ? <Closing journey={journey} property={property} /> : null}
          </HeroScene>
        ))}
      </ol>
    </>
  );
}

/** Cierre: la propiedad real (ficha + datos registrados) o, en el respaldo, la invitación de marca. */
function Closing({ journey, property }: { journey: Journey; property: HeroScenesProps["property"] }) {
  if (journey.kind === "property" && property) {
    return (
      <div className="jr-close">
        <p className="jr-close-meta">{["Salta", `Cód. ${property.code}`, ...property.specs].join(" · ")}</p>
        <div className="jr-close-cta">
          <Link href={property.href} className="btn jr-close-btn btn-arrow">
            Ver la propiedad <span className="sr-only">: casa en Club de Campo El Tipal</span>
            <ArrowRight aria-hidden className="btn-icon size-4" />
          </Link>
          <Link href="/propiedades" className="link-arrow jr-close-link">
            Explorar propiedades <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="jr-close">
      <p className="jr-close-meta">Seriedad, calidad humana, compromiso y experiencia en el rubro.</p>
      <div className="jr-close-cta">
        <Link href="/propiedades" className="btn jr-close-btn btn-arrow">
          Explorar propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
        </Link>
        <Link href="#vender" className="link-arrow jr-close-link">
          Quiero vender mi propiedad <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  );
}
