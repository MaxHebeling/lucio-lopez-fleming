"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { ArrowRight, Plus } from "lucide-react";

export type Service = {
  title: string;
  body: string;
  cta: { href: string; label: string };
  photo: StaticImageData | { url: string };
  alt: string;
};

const DESKTOP = "(min-width: 1024px)";
const HOVER = "(hover: hover) and (pointer: fine)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const noopSubscribe = () => () => {};

/**
 * Servicios como índice editorial. Desktop: lista grande a la izquierda; al pasar el puntero o al enfocar con teclado
 * cambia la lámina de la derecha (foto + descripción + CTA). Mobile: acordeón (un panel abierto a la vez).
 * Cada ítem es un disclosure accesible (button + aria-expanded + región). Sin JS se ven todos los paneles, en columna.
 */
export function ServicesIndex({ items }: { items: Service[] }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => false);
  // true solo en el cliente: el HTML del servidor (y sin JS) muestra todos los paneles.
  const enhanced = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const hover = () => typeof window !== "undefined" && window.matchMedia(HOVER).matches;

  return (
    <ol className="svc-list" data-enhanced={enhanced ? "" : undefined} data-layout={desktop ? "index" : "accordion"}>
      {items.map((s, i) => {
        const open = active === i;
        const src = "url" in s.photo ? s.photo.url : s.photo;
        return (
          <li key={s.title} className="svc-item" data-open={open ? "" : undefined}>
            <h3 className="svc-heading">
              <button
                type="button"
                id={`${id}-t${i}`}
                className="svc-trigger"
                aria-expanded={enhanced ? open : true}
                data-active={open ? "" : undefined}
                aria-controls={`${id}-p${i}`}
                onClick={() => setActive((cur) => (desktop ? i : cur === i ? -1 : i))}
                onFocus={() => desktop && setActive(i)}
                onPointerEnter={() => desktop && hover() && setActive(i)}
              >
                <span className="svc-num tabular" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                <span className="svc-title display">{s.title}</span>
                <Plus aria-hidden className="svc-plus size-6" strokeWidth={1.4} />
              </button>
            </h3>
            <div id={`${id}-p${i}`} role="region" aria-labelledby={`${id}-t${i}`} className="svc-panel" hidden={enhanced && !desktop && !open ? true : undefined}>
              <div className="svc-media media-frame">
                <Image src={src} alt={s.alt} fill sizes="(min-width: 1024px) 36vw, 100vw" className="object-cover" {...("url" in s.photo ? {} : { placeholder: "blur" as const })} />
              </div>
              <p className="svc-body">{s.body}</p>
              <Link href={s.cta.href} className="btn btn-outline btn-arrow svc-cta">
                {s.cta.label} <ArrowRight aria-hidden className="btn-icon size-4" />
              </Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
