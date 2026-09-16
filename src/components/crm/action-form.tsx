"use client";

/**
 * Formularios del CRM sobre Server Actions (`runAction`): errores por campo, estado de envío,
 * foco en el primer campo inválido y clave de idempotencia que se renueva tras cada alta exitosa.
 * No usa el reset automático de <form action>: si hay errores, lo escrito se conserva.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, Button, Field, cx } from "@/components/ui";

export type ClientActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type Ctx = { errors: Record<string, string[]>; pending: boolean; formId: string };
const FormCtx = createContext<Ctx>({ errors: {}, pending: false, formId: "f" });

export function useFormCtx() {
  return useContext(FormCtx);
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ActionForm<T>({
  action,
  children,
  className,
  idempotencyKey,
  successMessage,
  resetOnSuccess = false,
  onSuccess,
  "aria-label": ariaLabel,
}: {
  action: (fd: FormData) => Promise<ClientActionResult<T> | undefined>;
  children: ReactNode;
  className?: string;
  /** Clave inicial (generada en el servidor). Si se pasa, se envía como `idempotencyKey`. */
  idempotencyKey?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (data: T) => void;
  "aria-label"?: string;
}) {
  const formId = useId();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ClientActionResult<T> | null>(null);
  const [key, setKey] = useState(idempotencyKey);

  useEffect(() => {
    if (result && !result.ok) {
      const el = ref.current?.querySelector<HTMLElement>("[aria-invalid='true']") ?? ref.current?.querySelector<HTMLElement>("[data-form-error]");
      el?.focus();
    }
  }, [result]);

  return (
    <FormCtx.Provider value={{ errors: result && !result.ok ? (result.fieldErrors ?? {}) : {}, pending, formId }}>
      <form
        ref={ref}
        aria-label={ariaLabel}
        className={cx("flex flex-col gap-4", className)}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const fd = new FormData(e.currentTarget);
          const form = e.currentTarget;
          start(async () => {
            const r = await action(fd);
            // undefined = la acción redirigió
            if (!r) return;
            setResult(r);
            if (r.ok) {
              if (idempotencyKey) setKey(newKey());
              if (resetOnSuccess) form.reset();
              onSuccess?.(r.data);
            }
          });
        }}
      >
        {key ? <input type="hidden" name="idempotencyKey" value={key} /> : null}
        {result && !result.ok ? (
          <div tabIndex={-1} data-form-error className="outline-none">
            <Alert tone="danger">{result.error}</Alert>
          </div>
        ) : null}
        {result?.ok && successMessage ? <Alert tone="success">{successMessage}</Alert> : null}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

type ControlProps = { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string; disabled?: boolean };

export function FormField({
  name,
  label,
  hint,
  errorKeys,
  className,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  errorKeys?: string[];
  className?: string;
  children: (p: ControlProps) => ReactNode;
}) {
  const { errors, formId } = useFormCtx();
  const id = `${formId}-${name}`;
  const errs = [name, ...(errorKeys ?? [])].flatMap((k) => errors[k] ?? []);
  return (
    <Field label={label} htmlFor={id} error={errs} hint={hint} className={className}>
      {children({ id, name, "aria-invalid": errs.length ? true : undefined, "aria-describedby": errs.length ? `${id}-error` : undefined })}
    </Field>
  );
}

export function SubmitButton({ children, pendingLabel, variant = "primary", size = "md", className }: { children: ReactNode; pendingLabel?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; className?: string }) {
  const { pending } = useFormCtx();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} className={className}>
      {pending ? (pendingLabel ?? "Guardando…") : children}
    </Button>
  );
}

/** Botón que ejecuta una acción con datos fijos (confirmar, completar, etc.) y muestra el error al lado. */
export function ActionButton<I, T>({
  action,
  input,
  children,
  pendingLabel,
  variant = "secondary",
  size = "sm",
  className,
  confirm,
}: {
  action: (input: I) => Promise<ClientActionResult<T>>;
  input: I;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            const r = await action(input);
            if (!r.ok) setError(r.error);
          });
        }}
      >
        {pending ? (pendingLabel ?? "Procesando…") : children}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
