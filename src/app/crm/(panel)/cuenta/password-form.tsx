"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { formValues, useAction } from "@/components/crm/use-action";
import { changePasswordAction } from "./actions";

export function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const { run, pending, error, fieldErrors, ok } = useAction(changePasswordAction);
  return (
    <form
      ref={ref}
      noValidate
      className="flex max-w-md flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(formValues(e.currentTarget));
        if (r.ok) {
          ref.current?.reset();
          if (forced) router.push("/crm");
          else router.refresh();
        }
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {ok ? <Alert tone="success">Contraseña actualizada. Se cerraron tus otras sesiones.</Alert> : null}
      <Field label="Contraseña actual" htmlFor="current" error={fieldErrors?.current}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required aria-invalid={fieldErrors?.current ? true : undefined} />
      </Field>
      <Field label="Contraseña nueva" htmlFor="password" hint="Mínimo 10 caracteres, con letras y números." error={fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} aria-invalid={fieldErrors?.password ? true : undefined} />
      </Field>
      <Field label="Repetí la contraseña nueva" htmlFor="confirm" error={fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={fieldErrors?.confirm ? true : undefined} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
