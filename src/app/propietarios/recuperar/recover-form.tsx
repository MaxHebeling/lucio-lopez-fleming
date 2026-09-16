"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { recoverAction, type RecoverState } from "./actions";

export function RecoverForm() {
  const [state, action, pending] = useActionState<RecoverState, FormData>(recoverAction, {});
  if (state.done) {
    return <Alert tone="success">Si el email corresponde a una cuenta de propietario, en unos minutos vas a recibir un link para restablecer la contraseña (vence en 1 hora).</Alert>;
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando…" : "Enviarme el link"}
      </Button>
    </form>
  );
}
