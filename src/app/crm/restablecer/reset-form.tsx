"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { formValues, useAction } from "@/components/crm/use-action";
import { resetPasswordAction } from "./actions";

export function ResetForm({ token, invitation }: { token: string; invitation: boolean }) {
  const { run, pending, error, fieldErrors } = useAction(resetPasswordAction);
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{invitation ? "¡Listo! Tu contraseña quedó definida." : "Contraseña actualizada. Cerramos todas tus sesiones abiertas."}</Alert>
        <Link href="/crm/login" className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-2">
          Ingresar al CRM
        </Link>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({ ...formValues(e.currentTarget), token });
        if (r.ok) setDone(true);
      }}
    >
      {error && !fieldErrors?.password && !fieldErrors?.confirm ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Contraseña nueva" htmlFor="password" hint="Mínimo 10 caracteres, con letras y números." error={fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus aria-invalid={fieldErrors?.password ? true : undefined} />
      </Field>
      <Field label="Repetí la contraseña" htmlFor="confirm" error={fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={fieldErrors?.confirm ? true : undefined} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Guardando…" : invitation ? "Definir contraseña" : "Restablecer contraseña"}
      </Button>
    </form>
  );
}
