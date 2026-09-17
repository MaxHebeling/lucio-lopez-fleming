"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { pauseSmoothScroll, resumeSmoothScroll } from "@/components/experience/motion/smooth-scroll";

const OPEN_EVENT = "llf:filtros-abrir";
const DESKTOP_MQ = "(min-width: 1024px)";

/** Botón "Filtros" de mobile: abre el panel único (FiltersShell) y recibe el foco al cerrarse. */
export function FiltersButton({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onState = (e: Event) => setOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open));
    document.addEventListener("llf:filtros-estado", onState);
    return () => document.removeEventListener("llf:filtros-estado", onState);
  }, []);
  return (
    <button
      type="button"
      className="btn btn-outline"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="filtros"
      onClick={(e) => document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { opener: e.currentTarget } }))}
    >
      <SlidersHorizontal aria-hidden className="size-4" /> Filtros{count ? ` (${count})` : ""}
    </button>
  );
}

/**
 * Panel de filtros renderizado una sola vez. En desktop es la columna lateral (landmark "Filtros"); en mobile queda
 * oculto y, al abrirlo, el mismo elemento pasa a ser un diálogo a pantalla completa: foco atrapado, Esc cierra,
 * scroll del fondo bloqueado y foco de vuelta al botón. Sin JS en mobile se ve como bloque (site.css).
 */
export function FiltersShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      if (window.matchMedia(DESKTOP_MQ).matches) return;
      opener.current = (e as CustomEvent<{ opener?: HTMLElement }>).detail?.opener ?? null;
      setOpen(true);
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    const mq = window.matchMedia(DESKTOP_MQ);
    const onMq = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener(OPEN_EVENT, onOpen);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  useEffect(() => {
    document.dispatchEvent(new CustomEvent("llf:filtros-estado", { detail: { open } }));
    if (!open) return;
    const panel = ref.current;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    pauseSmoothScroll();
    panel?.querySelector<HTMLElement>("[data-filtros-cerrar]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>("a[href],button,input,select,summary,textarea")).filter(
        (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0 && !(el instanceof HTMLInputElement && el.type === "hidden"),
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      resumeSmoothScroll();
      document.removeEventListener("keydown", onKey);
      opener.current?.focus();
    };
  }, [open]);

  return (
    <aside
      ref={ref}
      id="filtros"
      className={`filters-shell${open ? " is-open" : ""}`}
      {...(open ? { role: "dialog", "aria-modal": true, "aria-labelledby": "filtros-titulo" } : { "aria-label": "Filtros" })}
      data-lenis-prevent
    >
      <div className="filters-shell-head">
        <h2 id="filtros-titulo" className="text-lg font-semibold">
          Filtros
        </h2>
        <button type="button" data-filtros-cerrar onClick={() => setOpen(false)} className="inline-flex size-11 items-center justify-center rounded-full" aria-label="Cerrar filtros">
          <X aria-hidden className="size-6" />
        </button>
      </div>
      <div className="filters-shell-body">{children}</div>
    </aside>
  );
}
