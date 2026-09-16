"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/** Botón que abre un diálogo modal nativo (foco atrapado, Esc cierra). El contenido recibe `close`. */
export function DialogButton({
  label,
  title,
  variant = "secondary",
  size = "sm",
  className,
  children,
}: {
  label: ReactNode;
  title: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </Button>
      {open ? <Modal title={title} onClose={() => setOpen(false)}>{children(() => setOpen(false))}</Modal> : null}
    </>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // Sin close() en el cleanup: dispararía onClose y cerraría el diálogo recién abierto (Strict Mode).
    // Al desmontarse, el <dialog> sale del DOM y del top layer.
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dlg-title"
      className="m-auto w-[min(100vw-2rem,32rem)] max-w-none rounded-[var(--radius-lg)] border border-line bg-paper p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/40"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id="dlg-title" className="text-base font-bold">
          {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <div className="max-h-[75svh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}
