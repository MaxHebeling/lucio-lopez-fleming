"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { pauseSmoothScroll, resumeSmoothScroll } from "@/components/experience/motion/smooth-scroll";

/**
 * Filtros en mobile: panel a pantalla completa (diálogo con foco atrapado, Esc cierra, foco vuelve al botón).
 * Sin JS el panel se ve como bloque normal debajo del botón gracias a <noscript> en ListingView.
 */
export function MobileFilters({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    pauseSmoothScroll();
    panel?.querySelector<HTMLElement>("button")?.focus();
    const button = buttonRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>("a[href],button,input,select,summary,textarea")).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
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
      button?.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={buttonRef} type="button" className="btn btn-outline" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden className="size-4" /> Filtros{count ? ` (${count})` : ""}
      </button>
      {open ? (
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="filtros-mobile-title" className="fixed inset-0 z-[var(--z-drawer)] overflow-y-auto bg-paper">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper px-[var(--gutter)] py-3">
            <h2 id="filtros-mobile-title" className="text-lg font-semibold">
              Filtros
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex size-11 items-center justify-center rounded-full" aria-label="Cerrar filtros">
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <div className="bg-paper px-[var(--gutter)] py-6">{children}</div>
        </div>
      ) : null}
    </>
  );
}
