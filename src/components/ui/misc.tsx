import type { ReactNode } from "react";
import { cx } from "./cx";

type Tone = "neutral" | "success" | "warning" | "danger" | "brand" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-paper-2 text-ink-2",
  success: "bg-[#e3efe6] text-success",
  warning: "bg-[#f6ecd6] text-warning",
  danger: "bg-[#f5dfdd] text-danger",
  brand: "bg-ink text-paper",
  info: "bg-[#e3e9f0] text-[#2c4a6b]",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-stone">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-[var(--radius-lg)] border border-line bg-white p-4 sm:p-5", className)}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-line px-6 py-12 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-stone">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "danger" | "success" | "warning"; children: ReactNode }) {
  const t = { info: "border-line bg-white", danger: "border-danger/30 bg-[#fbeeed] text-danger", success: "border-success/30 bg-[#eef6f0] text-success", warning: "border-warning/30 bg-[#fbf4e6] text-warning" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-[var(--radius-md)] border px-4 py-3 text-sm", t)}>
      {children}
    </div>
  );
}

/** Tabla con scroll horizontal propio (la página nunca scrollea en horizontal). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-white", className)}>
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-stone">
        {children}
      </table>
    </div>
  );
}
