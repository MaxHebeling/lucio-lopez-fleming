"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Grid2x2, X } from "lucide-react";
import type { PublicPhoto } from "@/server/properties/public";
import { pauseSmoothScroll, resumeSmoothScroll } from "@/components/experience/motion/smooth-scroll";

/**
 * Galería de la ficha.
 * - En página: mosaico (desktop) / carrusel con swipe nativo (mobile). La primera foto es el LCP (eager + high).
 *   En el carrusel mobile hay un solo tab stop (roving tabindex): ← → cambian de foto y Enter la amplía.
 * - Pantalla completa: diálogo con foco atrapado; ← → recorren, Esc cierra, swipe nativo (scroll-snap),
 *   contador anunciado y foco de vuelta al disparador. Solo se montan la foto actual y sus vecinas.
 */
export function Gallery({ photos, title }: { photos: PublicPhoto[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [inlineIndex, setInlineIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const [mosaicMode, setMosaicMode] = useState(false);
  const total = photos.length;

  // Desde md el carrusel es un mosaico de hasta 5 fotos: cada una es un tab stop. Debajo, un único tab stop.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setMosaicMode(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const openAt = (i: number, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setCurrent(i);
    setOpen(i);
  };

  const close = useCallback(() => {
    setOpen(null);
    triggerRef.current?.focus();
  }, []);

  const goTo = useCallback((i: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const idx = Math.max(0, Math.min(total - 1, i));
    track.scrollTo({ left: idx * track.clientWidth, behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
  }, [total]);

  // Al abrir: posicionar sin animación, bloquear scroll del fondo, foco al diálogo.
  useEffect(() => {
    if (open === null) return;
    const track = trackRef.current;
    if (track) track.scrollLeft = open * track.clientWidth;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    pauseSmoothScroll();
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      document.body.style.overflow = prev;
      resumeSmoothScroll();
    };
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(current + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(total - 1);
      } else if (e.key === "Tab" && dialogRef.current) {
        // Solo lo que realmente recibe foco: sin deshabilitados ni ocultos (flechas ocultas en mobile).
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")).filter(
          (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
        );
        if (!items.length) return;
        if (!items.includes(document.activeElement as HTMLElement)) {
          e.preventDefault();
          (e.shiftKey ? items[items.length - 1] : items[0])?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, current, close, goTo, total]);

  const onTrackScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i !== current) setCurrent(i);
  };
  const onInlineScroll = () => {
    const el = inlineRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== inlineIndex) setInlineIndex(i);
  };
  const onInlineKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = inlineRef.current;
    if (mosaicMode || !el) return;
    const map: Record<string, number> = { ArrowRight: inlineIndex + 1, ArrowLeft: inlineIndex - 1, Home: 0, End: total - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(total - 1, map[e.key]!));
    setInlineIndex(i);
    el.querySelectorAll<HTMLElement>("[data-slide]")[i]?.focus({ preventScroll: true });
    el.scrollTo({ left: i * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  if (!total) return null;
  const mosaic = photos.slice(0, photos.length >= 5 ? 5 : photos.length >= 3 ? 3 : 1);
  const mosaicGrid = mosaic.length === 5 ? "md:grid md:grid-cols-4 md:grid-rows-2" : mosaic.length === 3 ? "md:grid md:grid-cols-3 md:grid-rows-2" : "md:grid md:grid-cols-1";

  return (
    <div className="relative">
      {/* Un solo DOM: carrusel con swipe en mobile, mosaico editorial desde md (sin descargar la portada dos veces). */}
      <div
        ref={inlineRef}
        onScroll={onInlineScroll}
        onKeyDown={onInlineKey}
        className={`gallery-track aspect-[4/3] overflow-y-hidden rounded-[var(--radius-lg)] bg-paper-2 md:aspect-auto md:h-[min(72svh,640px)] md:gap-2 md:overflow-visible md:bg-transparent ${mosaicGrid}`}
        role="region"
        aria-label={`Fotos de ${title}`}
        aria-roledescription={mosaicMode ? undefined : "carrusel"}
      >
        {photos.map((p, i) => (
          <button
            key={p.url}
            type="button"
            data-slide
            tabIndex={mosaicMode || i === inlineIndex ? 0 : -1}
            onClick={(e) => openAt(i, e.currentTarget)}
            className={`gallery-slide group overflow-hidden bg-paper-2 md:rounded-[var(--radius-md)] ${i === 0 && mosaic.length >= 3 ? "md:col-span-2 md:row-span-2" : ""} ${i >= mosaic.length ? "md:hidden" : ""}`}
            aria-label={`Ampliar foto ${i + 1} de ${total}`}
            aria-keyshortcuts={mosaicMode || total < 2 ? undefined : "ArrowLeft ArrowRight"}
          >
            <Image
              src={p.url}
              alt={p.alt}
              fill
              sizes={i === 0 ? "(min-width: 1440px) 720px, (min-width: 768px) 50vw, 100vw" : "(min-width: 1440px) 360px, (min-width: 768px) 25vw, 100vw"}
              className="card-img object-cover transition-[scale] duration-700 md:group-hover:scale-[1.03]"
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : undefined}
            />
          </button>
        ))}
      </div>
      {total > 1 ? (
        <span className="tabular pointer-events-none absolute bottom-3 right-3 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold text-paper md:hidden" aria-hidden>
          {inlineIndex + 1} / {total}
        </span>
      ) : null}
      {total > 1 ? (
        <button type="button" onClick={(e) => openAt(0, e.currentTarget)} className="btn absolute bottom-4 left-4 hidden min-h-11 bg-paper px-4 text-sm text-ink shadow-[var(--shadow-soft)] hover:bg-white md:inline-flex">
          <Grid2x2 aria-hidden className="size-4" /> Ver las {total} fotos
        </button>
      ) : null}

      {open !== null ? (
        <div ref={dialogRef} className="gallery-dialog" role="dialog" aria-modal="true" aria-label={`Galería: ${title}`}>
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-6">
            <p className="tabular text-sm font-semibold" aria-live="polite">
              Foto {current + 1} de {total}
            </p>
            <button type="button" data-autofocus onClick={close} className="grid size-11 place-items-center rounded-full bg-paper/10 hover:bg-paper/20" aria-label="Cerrar galería">
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <div ref={trackRef} onScroll={onTrackScroll} className="gallery-track">
            {photos.map((p, i) => (
              <div key={p.url} className="gallery-slide" aria-hidden={i !== current}>
                {Math.abs(i - current) <= 2 ? <Image src={p.url} alt={p.alt} fill sizes="100vw" className="object-contain p-2 sm:p-14" loading={i === current ? "eager" : "lazy"} /> : null}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => goTo(current - 1)} disabled={current === 0} className="absolute left-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-paper/10 hover:bg-paper/20 disabled:opacity-30 sm:grid" aria-label="Foto anterior">
            <ChevronLeft aria-hidden className="size-7" />
          </button>
          <button type="button" onClick={() => goTo(current + 1)} disabled={current === total - 1} className="absolute right-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-paper/10 hover:bg-paper/20 disabled:opacity-30 sm:grid" aria-label="Foto siguiente">
            <ChevronRight aria-hidden className="size-7" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
