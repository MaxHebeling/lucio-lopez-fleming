"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { cx } from "@/components/ui";

export type InlineActionState = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> } | null;
export type InlineAction = (prev: InlineActionState, fd: FormData) => Promise<InlineActionState>;

/** Botón que ejecuta una Server Action con campos ocultos, estado de carga y mensaje de resultado. */
export function InlineAction({
  action,
  fields,
  label,
  pendingLabel,
  variant = "secondary",
  confirmText,
  className,
  children,
}: {
  action: InlineAction;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirmText?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={cx("flex flex-col items-start gap-1", className)}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? (pendingLabel ?? "Procesando…") : label}
      </Button>
      <p aria-live="polite" className={cx("text-xs", state && !state.ok ? "text-danger" : "text-success")}>
        {state ? (state.ok ? (state.message ?? "") : state.error) : ""}
      </p>
    </form>
  );
}
