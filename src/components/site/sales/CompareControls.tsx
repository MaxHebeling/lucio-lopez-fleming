"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { Check, Columns3, Plus, X } from "lucide-react";
import { COMPARE_MAX, compareSnapshot, hydrationStore, parseCompare, subscribeCompare, writeCompare, type CompareItem } from "./site-track";
import "./sales.css";

function useCompare(): [CompareItem[], (next: CompareItem[]) => void] {
  const raw = useSyncExternalStore(subscribeCompare, compareSnapshot, () => "[]");
  const list = useMemo(() => parseCompare(raw), [raw]);
  return [list, (next) => writeCompare(next)];
}

/**
 * «Comparar» discreto (tarjeta o ficha). Selección de hasta 3 propiedades en esta pestaña (sessionStorage); la
 * comparación vive en una URL compartible (/propiedades/comparar?codigos=…). Sin JS no se muestra (no hay botones muertos).
 */
export function CompareToggle({ code, label, className = "" }: { code: number; label: string; className?: string }) {
  const [list, save] = useCompare();
  const ready = useSyncExternalStore(hydrationStore.subscribe, hydrationStore.client, hydrationStore.server);
  if (!ready) return null;
  const selected = list.some((x) => x.code === code);
  const full = !selected && list.length >= COMPARE_MAX;
  return (
    <button
      type="button"
      className={`compare-toggle ${className}`}
      aria-pressed={selected}
      disabled={full}
      title={full ? `Podés comparar hasta ${COMPARE_MAX} propiedades` : undefined}
      onClick={() => save(selected ? list.filter((x) => x.code !== code) : [...list, { code, label }])}
    >
      {selected ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
      {selected ? "En comparación" : "Comparar"}
      <span className="sr-only"> la propiedad código {code}</span>
    </button>
  );
}

/** Barra flotante con la selección: ir a la comparación o limpiar. */
export function CompareTray({ aboveContactBar = false }: { aboveContactBar?: boolean }) {
  const [list, save] = useCompare();
  if (!list.length) return null;
  const href = `/propiedades/comparar?codigos=${list.map((x) => x.code).join(",")}`;
  return (
    <div className={`compare-tray ${aboveContactBar ? "compare-tray-with-bar" : ""}`} role="region" aria-label="Propiedades para comparar">
      <Columns3 aria-hidden className="size-5 flex-none opacity-80" strokeWidth={1.6} />
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold">
          {list.length} de {COMPARE_MAX}
        </span>
        <span className="hidden sm:inline"> · {list.map((x) => `#${x.code}`).join(", ")}</span>
      </p>
      <button type="button" onClick={() => save([])} className="grid size-10 flex-none place-items-center rounded-full hover:bg-paper/10" aria-label="Quitar todas de la comparación">
        <X aria-hidden className="size-4" />
      </button>
      {list.length >= 2 ? (
        <Link href={href} className="btn btn-light min-h-11 flex-none px-5 text-sm">
          Comparar
        </Link>
      ) : (
        <span className="flex-none px-3 text-xs text-paper/75">Elegí otra</span>
      )}
    </div>
  );
}
