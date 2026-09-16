"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Alert, Button, cx } from "@/components/ui";
import type { FormState } from "./form-state";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  /** Pide confirmación antes de enviar (acciones sensibles). */
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  inline?: boolean;
};

/** Formulario operativo con Server Action: estados de envío, error y éxito accesibles. */
export function ActionForm({ action, children, submitLabel, pendingLabel, variant = "primary", size = "md", confirm, className, resetOnSuccess, inline }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cx(inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-3", className)}
    >
      {state.error ? (
        <div className={inline ? "basis-full" : undefined}>
          <Alert tone="danger">{state.error}</Alert>
        </div>
      ) : null}
      {state.ok && state.message ? (
        <div className={inline ? "basis-full" : undefined}>
          <Alert tone="success">{state.message}</Alert>
        </div>
      ) : null}
      {children}
      <div>
        <Button type="submit" variant={variant} size={size} disabled={pending}>
          {pending ? (pendingLabel ?? "Guardando…") : submitLabel}
        </Button>
      </div>
      {state.fieldErrors && Object.keys(state.fieldErrors).length ? (
        <ul className={cx("text-xs text-danger", inline && "basis-full")} role="alert">
          {Object.entries(state.fieldErrors).map(([k, v]) => (
            <li key={k}>{v.join(" · ")}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
