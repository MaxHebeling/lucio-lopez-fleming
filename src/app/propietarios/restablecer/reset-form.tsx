"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Field, Input, buttonClass } from "@/components/ui";
import { resetAction, type ResetState } from "./actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetAction, {});
  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">Contraseña guardada. Ya podés ingresar.</Alert>
        <Link href="/propietarios/login" className={buttonClass("primary", "md", "w-full")}>
          Ingresar
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <input type="hidden" name="token" value={token} />
      <Field label="Nueva contraseña" htmlFor="password" hint="Al menos 10 caracteres, con letras y números">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus />
      </Field>
      <Field label="Repetila" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Guardando…" : "Guardar contraseña"}
      </Button>
    </form>
  );
}
