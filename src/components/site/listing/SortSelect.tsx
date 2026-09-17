"use client";

import { useRouter } from "next/navigation";
import { SORTS, SORT_LABEL, type SortKey } from "@/server/properties/public-constants";

/** Orden: cambia la URL al elegir (con JS). Sin JS, el formulario GET que lo envuelve tiene su botón. */
export function SortSelect({ value, hrefFor }: { value: SortKey; hrefFor: Record<SortKey, string> }) {
  const router = useRouter();
  return (
    <select
      id="orden"
      name="orden"
      className="field-control !min-h-11 w-auto !py-2"
      defaultValue={value}
      onChange={(e) => router.push(hrefFor[e.target.value as SortKey], { scroll: false })}
    >
      {SORTS.map((s) => (
        <option key={s} value={s}>
          {SORT_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
