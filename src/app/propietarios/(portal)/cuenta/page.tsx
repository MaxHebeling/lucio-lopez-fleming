import { requireOwnerPage } from "@/server/next/context";
import { Section } from "../ui";
import { PasswordForm } from "./password-form";

export default async function OwnerAccountPage() {
  const actor = await requireOwnerPage();
  return (
    <>
      <Section title="Tu cuenta">
        <p className="text-sm text-ink-2">
          {actor.fullName} · {actor.email}
        </p>
        <p className="mt-1 text-xs text-stone">Para cambiar tu email o datos de contacto, escribinos a la inmobiliaria.</p>
      </Section>
      <Section title="Cambiar contraseña">
        <PasswordForm />
      </Section>
    </>
  );
}
