"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { changeOwnerPasswordAction, type ChangePasswordState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changeOwnerPasswordAction, {});
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4" noValidate key={state.ok ? "done" : "form"}>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">Contraseña actualizada. Se cerraron tus otras sesiones.</Alert> : null}
      <Field label="Contraseña actual" htmlFor="current">
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Nueva contraseña" htmlFor="password" hint="Al menos 10 caracteres, con letras y números">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Repetila" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Cambiar contraseña"}
        </Button>
      </div>
    </form>
  );
}
