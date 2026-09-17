"use client";

/**
 * Punto de entrada único «✦ Asistente IA» del CRM. Liviano a propósito: el panel (y las Server Actions) se cargan
 * recién al abrirlo o al pasar el puntero/foco por el botón, así el First Load JS de las páginas no crece.
 * Atajo: Ctrl + I (⌘ + I en Mac). Esc cierra.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

const loadPanel = () => import("./copilot-panel");
const CopilotPanel = lazy(loadPanel);

export function CopilotLauncher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const show = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setMounted(true);
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={show}
        onMouseEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Control+I Meta+I"
        title="Asistente IA (Ctrl + I)"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink"
      >
        <span aria-hidden="true" className="text-brick">
          ✦
        </span>
        <span className="hidden sm:inline">Asistente IA</span>
        <span className="sm:hidden">IA</span>
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <CopilotPanel open={open} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
