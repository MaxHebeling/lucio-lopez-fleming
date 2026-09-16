import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../brand";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Recuperar contraseña · Portal de propietarios", robots: { index: false, follow: false } };

export default function RecoverPage() {
  return (
    <AuthShell
      title="Recuperar contraseña"
      footer={
        <Link href="/propietarios/login" className="underline underline-offset-4 hover:text-ink">
          Volver a ingresar
        </Link>
      }
    >
      <RecoverForm />
    </AuthShell>
  );
}
