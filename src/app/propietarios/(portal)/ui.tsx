import type { ReactNode } from "react";

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-2 border-b border-line pb-2">
        <h2 className="font-display text-2xl leading-none text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-lg)] border border-dashed border-line bg-white/60 px-4 py-6 text-center text-sm text-stone">{children}</p>;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
