"use client";

/**
 * Punto de entrada único «✦ Asistente IA» del CRM. Liviano a propósito: el panel (y las Server Actions) se cargan
 * recién al abrirlo o al pasar el puntero/foco por el botón, así el First Load JS de las páginas no crece.
 * Atajo: Ctrl + I (⌘ + I en Mac). Esc cierra.
 *
 * Desde `sm` el botón vive en el encabezado. En celular el encabezado no tiene lugar (taparía «Menú»), así que se
 * muestra flotante abajo a la derecha; se monta en <body> porque el encabezado usa backdrop-filter, que convierte a
 * `position: fixed` en relativo al encabezado. En cada ancho hay un solo botón visible (el otro es display: none).
 */
import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const loadPanel = () => import("./copilot-panel");
const CopilotPanel = lazy(loadPanel);

const noopSubscribe = () => () => {};

export function CopilotLauncher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

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

  const button = (floating: boolean) => (
    <button
      type="button"
      onClick={show}
      onMouseEnter={() => void loadPanel()}
      onFocus={() => void loadPanel()}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="Control+I Meta+I"
      title="Asistente IA (Ctrl + I)"
      className={
        floating
          ? "fixed right-4 bottom-[calc(1rem_+_env(safe-area-inset-bottom))] z-[var(--z-float)] inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink shadow-[var(--shadow-float)] sm:hidden"
          : "hidden h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-ink sm:inline-flex"
      }
    >
      <span aria-hidden="true" className="text-brick">
        ✦
      </span>
      Asistente IA
    </button>
  );

  return (
    <>
      {button(false)}
      {isClient ? createPortal(button(true), document.body) : null}
      {mounted ? (
        <Suspense fallback={null}>
          <CopilotPanel open={open} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
