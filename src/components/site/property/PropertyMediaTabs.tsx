"use client";

import Image from "next/image";
import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { MEDIA_TAB_LABEL, type MediaTabKey, type PublicTour } from "@/server/tours/model";
import { TourLauncher } from "@/components/site/tour/TourLauncher";
import type { TourGuideConfig } from "@/components/site/tour/TourExperience";
import { FloorPlan } from "@/components/site/tour/FloorPlan";

type Props = {
  tabs: MediaTabKey[];
  /** Galería ya renderizada en el servidor (la misma de siempre). */
  photos: ReactNode;
  tour: PublicTour;
  floorPlans: Array<{ url: string; width: number | null; height: number | null; alt: string }>;
  videos: Array<{ url: string }>;
  headline: string;
  fallbackCoverUrl: string | null;
  propertyCode: number | null;
  operation?: string;
  shareUrl: string;
  whatsappUrl: string | null;
  isDemo: boolean;
  /** Guía «Preguntá por esta casa» dentro del tour (flag `ai_tour_guide`). */
  guide?: TourGuideConfig | null;
};

/**
 * ¿La URL pide abrir el tour? Acepta `#tour` (lo que comparte el botón Compartir del tour) y `?tour=1`.
 * Se lee del navegador, no de la página: leer `searchParams` en la ficha la volvería dinámica y el HTML inicial dejaría
 * de traer galería y pestañas (la ficha es ISR con `revalidate`). En el servidor es `false` y se resuelve al hidratar.
 */
function wantsTour(): boolean {
  if (window.location.hash.toLowerCase() === "#tour") return true;
  const v = new URLSearchParams(window.location.search).get("tour");
  return v === "1" || v === "on" || v === "true";
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const noTourOnServer = () => false;

/**
 * Selector de medios de la ficha: [FOTOS] [TOUR 360°] [PLANO] [VIDEO], solo las disponibles (ver mediaTabs()).
 * Pestañas accesibles (flechas, Inicio/Fin). La galería se mantiene montada: el contenido indexable no cambia.
 */
export function PropertyMediaTabs({ tabs, photos, tour, floorPlans, videos, headline, fallbackCoverUrl, propertyCode, operation, shareUrl, whatsappUrl, isDemo, guide }: Props) {
  const id = useId();
  /** null = todavía no eligió pestaña: manda el link (`#tour`) y, si no, la primera disponible. */
  const [chosen, setChosen] = useState<MediaTabKey | null>(null);
  const refs = useRef<Partial<Record<MediaTabKey, HTMLButtonElement | null>>>({});
  const deepLink = useSyncExternalStore(subscribeToHash, wantsTour, noTourOnServer);
  const setActive = setChosen;
  const active: MediaTabKey = chosen ?? (deepLink && tabs.includes("tour") ? "tour" : tabs[0]!);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(active);
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const next = tabs[(map[e.key]! + tabs.length) % tabs.length]!;
    setActive(next);
    refs.current[next]?.focus();
  };

  const showPhotos = () => {
    if (!tabs.includes("fotos")) return;
    setActive("fotos");
  };

  return (
    <div>
      <div role="tablist" aria-label="Fotos, tour y planos" className="mb-4 flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${t}`}
            aria-selected={active === t}
            aria-controls={`${id}-panel-${t}`}
            tabIndex={active === t ? 0 : -1}
            onClick={() => setActive(t)}
            className="relative min-h-11 whitespace-nowrap px-3 text-xs font-bold uppercase tracking-[0.16em] text-ink-2 transition-colors hover:text-ink aria-selected:text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:bg-brick after:transition-transform aria-selected:after:scale-x-100 sm:px-4"
          >
            {t === "tour" ? (
              <>
                {MEDIA_TAB_LABEL.tour}
                <span aria-hidden className="ml-2 inline-block size-1.5 rounded-full bg-brick align-middle" />
              </>
            ) : (
              MEDIA_TAB_LABEL[t]
            )}
          </button>
        ))}
      </div>

      {tabs.includes("fotos") ? (
        <div role="tabpanel" id={`${id}-panel-fotos`} aria-labelledby={`${id}-tab-fotos`} hidden={active !== "fotos"}>
          {photos}
        </div>
      ) : null}

      <div role="tabpanel" id={`${id}-panel-tour`} aria-labelledby={`${id}-tab-tour`} hidden={active !== "tour"}>
        <TourLauncher
          tour={tour}
          headline={headline}
          fallbackCoverUrl={fallbackCoverUrl}
          propertyTitle={headline}
          propertyCode={propertyCode}
          operation={operation}
          shareUrl={shareUrl}
          whatsappUrl={whatsappUrl}
          isDemo={isDemo}
          guide={guide ?? null}
          autoOpen={deepLink}
          onShowPhotos={tabs.includes("fotos") ? showPhotos : undefined}
        />
      </div>

      {tabs.includes("plano") ? (
        <div role="tabpanel" id={`${id}-panel-plano`} aria-labelledby={`${id}-tab-plano`} hidden={active !== "plano"} className="rounded-[var(--radius-lg)] bg-paper-2 p-4 sm:p-8">
          {tour.kind === "internal" && tour.floorPlan ? (
            <div className="mx-auto max-w-4xl">
              <FloorPlan plan={tour.floorPlan} scenes={tour.scenes} currentSceneId={null} isDemo={isDemo} tone="light" />
            </div>
          ) : null}
          {floorPlans.map((p, i) => (
            <figure key={p.url} className={`relative mx-auto max-w-4xl ${i > 0 || (tour.kind === "internal" && tour.floorPlan) ? "mt-8" : ""}`}>
              <Image src={p.url} alt={p.alt} width={p.width ?? 1600} height={p.height ?? 1200} sizes="(min-width: 1024px) 896px, 100vw" className="h-auto w-full rounded-[var(--radius-md)] bg-white" />
            </figure>
          ))}
        </div>
      ) : null}

      {tabs.includes("video") ? (
        <div role="tabpanel" id={`${id}-panel-video`} aria-labelledby={`${id}-tab-video`} hidden={active !== "video"}>
          {videos.map((v) => (
            <video key={v.url} src={v.url} controls preload="none" playsInline className="aspect-video w-full rounded-[var(--radius-lg)] bg-ink" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
