import type { ReactNode } from "react";

/** Página legal sobria. Marcada visiblemente como borrador hasta la revisión legal de la inmobiliaria. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="container-site pb-24 pt-12 lg:pt-20">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow text-brick">Información legal</p>
        <h1 className="display mt-6 text-[clamp(2.6rem,6vw,5rem)] leading-[0.98]">{title}</h1>
        <p className="mt-4 text-sm text-ink-2">Última actualización: {updated}</p>
        <p className="mt-6 rounded-[var(--radius-md)] border border-warning/40 bg-warning/10 p-4 text-sm text-ink" role="note">
          Texto base pendiente de revisión legal por la inmobiliaria. No reemplaza el asesoramiento de un profesional.
        </p>
        <div className="legal mt-10 grid gap-8 text-[1.0625rem] leading-relaxed text-ink-2 [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:text-xl [&_li]:ml-5 [&_li]:list-disc [&_ul]:mt-3 [&_ul]:grid [&_ul]:gap-1.5 [&_p+p]:mt-3">
          {children}
        </div>
      </div>
    </div>
  );
}
