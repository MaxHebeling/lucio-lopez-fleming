import type { ReactNode } from "react";

/** Dato clave de la ficha (se omite si no hay valor). Compartido por la ficha real y la demo del tour. */
export function Fact({ label, value }: { label: string; value: ReactNode | string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="border-t border-line py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

export function Paragraphs({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}|\r\n\r\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="prose-llf max-w-[68ch] text-[1.0625rem] leading-relaxed text-ink-2">
      {blocks.map((b, i) => (
        <p key={i} className="whitespace-pre-line">
          {b}
        </p>
      ))}
    </div>
  );
}
