import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { isResetTokenValid } from "@/server/owners/access";
import { Alert } from "@/components/ui";
import { AuthShell } from "../brand";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Definir contraseña · Portal de propietarios", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: PageProps<"/propietarios/restablecer">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const invite = sp.invitacion === "1";
  const valid = await isResetTokenValid(getDb(), token);
  return (
    <AuthShell
      title={invite ? "Bienvenido: definí tu contraseña" : "Nueva contraseña"}
      footer={
        <Link href="/propietarios/login" className="underline underline-offset-4 hover:text-ink">
          Volver a ingresar
        </Link>
      }
    >
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <Alert tone="warning">
          {invite ? "La invitación venció o ya se usó. Pedile a la inmobiliaria que te la reenvíe." : "El link venció o ya se usó."}{" "}
          <Link href="/propietarios/recuperar" className="underline">
            Pedir un link nuevo
          </Link>
        </Alert>
      )}
    </AuthShell>
  );
}
