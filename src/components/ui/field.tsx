import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

const control =
  "w-full rounded-[var(--radius-md)] border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-stone focus:border-ink focus:outline-none aria-[invalid=true]:border-danger";

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string[] | string; hint?: string; children: ReactNode; className?: string }) {
  const errors = Array.isArray(error) ? error : error ? [error] : [];
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-ink-2">
        {label}
      </label>
      {children}
      {hint && !errors.length ? <p className="text-xs text-stone">{hint}</p> : null}
      {errors.map((e) => (
        <p key={e} id={`${htmlFor}-error`} className="text-xs text-danger" role="alert">
          {e}
        </p>
      ))}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(control, "min-h-24", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cx(control, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className={cx("inline-flex items-center gap-2 text-sm text-ink", className)}>
      <input type="checkbox" className="size-4 accent-[var(--ink)]" {...props} />
      {label}
    </label>
  );
}
