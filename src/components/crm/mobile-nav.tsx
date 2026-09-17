"use client";

import { useEffect, useRef, useState } from "react";
import { NavLinks, type ShellNavItem } from "./nav-links";

export function MobileNav({ items }: { items: ShellNavItem[] }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-[var(--radius-md)] border border-line px-3 py-1.5 text-sm font-semibold lg:hidden" aria-haspopup="dialog">
        Menú
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="m-0 h-svh max-h-none w-[min(85vw,320px)] max-w-none overflow-y-auto bg-paper p-4 backdrop:bg-ink/40"
        aria-label="Menú del CRM"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-2xl">LLF</span>
          <button type="button" onClick={() => setOpen(false)} className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-semibold hover:bg-paper-2">
            Cerrar
          </button>
        </div>
        <NavLinks items={items} onNavigate={() => setOpen(false)} />
      </dialog>
    </>
  );
}
