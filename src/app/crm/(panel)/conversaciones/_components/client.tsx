"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, cx } from "@/components/ui";
import type { ConversationActionState } from "../actions";

type Action = (prev: ConversationActionState, fd: FormData) => Promise<ConversationActionState>;

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Botón que ejecuta una Server Action con campos ocultos y muestra el error real si falla. */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = "secondary",
  size = "sm",
  withKey = false,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  withKey?: boolean;
}) {
  const [key, setKey] = useState(newKey);
  const [state, formAction, pending] = useActionState<ConversationActionState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r?.ok) setKey(newKey());
    return r;
  }, null);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {withKey ? <input type="hidden" name="idempotencyKey" value={key} /> : null}
      <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

const MAX = 4096;

export function ReplyForm({ action, conversationId, disabledReason }: { action: Action; conversationId: string; disabledReason?: string | null }) {
  const [key, setKey] = useState(newKey);
  const [text, setText] = useState("");
  const [state, formAction, pending] = useActionState<ConversationActionState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r?.ok) {
      // Mensaje en cola: se limpia el borrador y se genera otra clave para el próximo envío
      setText("");
      setKey(newKey());
    }
    return r;
  }, null);
  const id = useId();

  const disabled = Boolean(disabledReason);
  return (
    <form action={formAction} className="flex flex-col gap-2 border-t border-line bg-white p-3 sm:p-4">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <label htmlFor={`${id}-body`} className="text-xs font-semibold uppercase tracking-wide text-ink-2">
        Responder por WhatsApp
      </label>
      {disabledReason ? <p className="text-sm text-stone">{disabledReason}</p> : null}
      <textarea
        id={`${id}-body`}
        name="body"
        required
        maxLength={MAX}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || pending}
        aria-invalid={state && !state.ok ? true : undefined}
        aria-describedby={`${id}-help`}
        className="min-h-20 w-full resize-y rounded-[var(--radius-md)] border border-line bg-white px-3 py-2 text-base text-ink placeholder:text-stone focus:border-ink focus:outline-none disabled:bg-paper-2 sm:text-sm"
        placeholder="Escribí tu respuesta…"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-help`} className="text-xs text-stone">
          {text.length}/{MAX} · Al responder, la conversación pasa a vos y el asistente deja de contestar.
        </span>
        <Button type="submit" disabled={disabled || pending || !text.trim()}>
          {pending ? "Encolando…" : "Enviar"}
        </Button>
      </div>
      {state && !state.ok ? <Alert tone="danger">{state.fieldErrors?.body?.[0] ?? state.error}</Alert> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-success">
          Mensaje en cola. El estado de envío se actualiza abajo.
        </p>
      ) : null}
    </form>
  );
}

/** Actualiza la vista cada `seconds` mientras la pestaña está visible (estados de envío y mensajes nuevos). */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

export function ScrollToEnd({ targetId, className }: { targetId: string; className?: string }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (el) el.scrollTop = el.scrollHeight;
  }, [targetId]);
  return <span className={cx("sr-only", className)} aria-hidden="true" />;
}
