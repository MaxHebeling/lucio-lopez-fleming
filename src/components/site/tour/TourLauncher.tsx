"use client";

import Image from "next/image";
import { useCallback, useRef, useState, type ComponentType } from "react";
import { ArrowUpRight, Rotate3d } from "lucide-react";
import { PROVIDER_LABEL, type PublicTour } from "@/server/tours/model";
import type { TourContext } from "./TourExperience";

type ExperienceProps = TourContext & { onClose: () => void; onShowPhotos?: () => void };
let modulePromise: Promise<ComponentType<ExperienceProps>> | null = null;
/** Carga diferida del tour (PSV + three). Se dispara por intención (hover, foco, toque) o al entrar. */
export function loadTourExperience(): Promise<ComponentType<ExperienceProps>> {
  modulePromise ??= import("./TourExperience").then((m) => m.default);
  modulePromise.catch(() => {
    modulePromise = null; // un fallo de red no deja la carga "pegada": el próximo intento vuelve a pedir el módulo
  });
  return modulePromise;
}

type Props = Omit<TourContext, "entry" | "analytics"> & {
  tour: PublicTour;
  headline: string;
  fallbackCoverUrl: string | null;
  onShowPhotos?: () => void;
};

const ENTER_MS = 560;

/**
 * Portada del tour en la ficha: foto, título, bajada y «Entrar al tour 360°». Al entrar, la foto escala, la UI se retira
 * y aparece la capa inmersiva (que continúa la transición). Al salir, el foco vuelve al botón y la ficha queda donde estaba.
 */
export function TourLauncher({ tour, headline, fallbackCoverUrl, onShowPhotos, ...ctx }: Props) {
  const [Experience, setExperience] = useState<ComponentType<ExperienceProps> | null>(null);
  const [entering, setEntering] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cover = tour.coverUrl ?? fallbackCoverUrl;
  const provider = tour.kind === "external" ? PROVIDER_LABEL[tour.provider] : null;
  const prefetch = useCallback(() => {
    loadTourExperience().catch((e: unknown) => console.warn("[tour] no se pudo precargar el tour", e));
  }, []);

  const open = async () => {
    if (entering || Experience) return;
    setLoadError(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEntering(!reduced);
    try {
      const [Comp] = await Promise.all([loadTourExperience(), new Promise((r) => window.setTimeout(r, reduced ? 0 : ENTER_MS))]);
      setExperience(() => Comp);
    } catch (e) {
      console.error("[tour] no se pudo cargar el tour", e);
      setLoadError(true);
      setEntering(false);
    }
  };

  const close = useCallback(() => {
    setExperience(null);
    setEntering(false);
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }, []);

  return (
    <div className="tour-launch group relative isolate overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface-ink)] text-paper" data-entering={entering || undefined}>
      <div className="relative aspect-[4/5] sm:aspect-[4/3] md:aspect-auto md:h-[min(72svh,640px)]">
        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(min-width: 1440px) 1360px, 100vw"
            className="tour-launch-img object-cover opacity-80 transition-[scale,opacity] duration-[var(--motion-editorial)] ease-[var(--ease-out)] group-data-[entering]:scale-[1.08] group-data-[entering]:opacity-100 md:group-hover:scale-[1.02]"
          />
        ) : null}
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_top,rgb(15_14_13/0.85),rgb(15_14_13/0.15)_60%,rgb(15_14_13/0.35))]" />
      </div>
      <div className="absolute inset-0 flex flex-col justify-between p-5 transition-[opacity,translate] duration-[var(--motion-ui)] group-data-[entering]:translate-y-2 group-data-[entering]:opacity-0 sm:p-8 lg:p-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="eyebrow text-paper/85">
            <Rotate3d aria-hidden className="size-4" strokeWidth={1.6} /> Tour 360°{provider ? ` · ${provider}` : ""}
          </p>
          {ctx.isDemo ? <p className="rounded-full border border-paper/35 bg-ink/40 px-3 py-1 text-[0.625rem] font-bold tracking-[0.16em]">DEMO · PROPIEDAD FICTICIA</p> : null}
        </div>
        <div className="max-w-3xl">
          <p className="display text-[clamp(2rem,5vw,4.5rem)] leading-[0.95]">Viví la propiedad antes de visitarla.</p>
          <p className="mt-3 max-w-xl text-paper/85">{headline}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              ref={buttonRef}
              type="button"
              onClick={open}
              onPointerEnter={prefetch}
              onFocus={prefetch}
              onTouchStart={prefetch}
              aria-busy={entering}
              className="btn btn-lg bg-paper text-ink hover:bg-white"
            >
              {entering ? "Abriendo el tour…" : "Entrar al tour 360°"} <ArrowUpRight aria-hidden className="btn-icon size-5" />
            </button>
            {loadError ? (
              <p role="alert" className="text-sm text-[#ffb4ad]">
                No pudimos abrir el tour. Revisá la conexión y probá de nuevo.
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {Experience ? <Experience {...ctx} tour={tour} analytics entry="cover" onClose={close} onShowPhotos={onShowPhotos} /> : null}
    </div>
  );
}
