import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/next/context";
import { AuthShell } from "../brand";
import { OwnerLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar · Portal de propietarios", robots: { index: false, follow: false } };

export default async function OwnerLoginPage() {
  const actor = await getActor();
  if (actor.kind === "owner") redirect("/propietarios");
  return (
    <AuthShell
      title="Ingresá a tu cuenta"
      footer={
        <Link href="/propietarios/recuperar" className="underline underline-offset-4 hover:text-ink">
          Olvidé mi contraseña
        </Link>
      }
    >
      <OwnerLoginForm />
      <p className="mt-4 text-xs text-stone">El acceso es por invitación de la inmobiliaria. Si todavía no la recibiste, consultanos.</p>
    </AuthShell>
  );
}
