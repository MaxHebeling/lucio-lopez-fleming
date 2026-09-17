import type { Metadata } from "next";
import Link from "next/link";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Recuperar contraseña", robots: { index: false, follow: false } };

export default function RecoverPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <h1>
          <span className="block font-display text-4xl leading-none text-ink">Lucio López Fleming</span>
          <span className="mb-8 mt-2 block text-xs font-semibold uppercase tracking-[0.2em] text-brick">CRM · Recuperar contraseña</span>
        </h1>
        <div className="rounded-[var(--radius-lg)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <p className="mb-4 text-sm text-ink-2">Ingresá el email con el que entrás al CRM y te enviamos un link para definir una contraseña nueva.</p>
          <RecoverForm />
        </div>
        <p className="mt-4 text-center text-sm text-stone">
          <Link href="/crm/login" className="underline underline-offset-4 hover:text-ink">
            Volver a ingresar
          </Link>
        </p>
      </div>
    </main>
  );
}
