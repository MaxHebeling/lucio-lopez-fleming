import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Restablecer contraseña", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: PageProps<"/crm/restablecer">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(sp.token) ? sp.token : null;
  const invitation = sp.invitacion === "1";
  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <h1>
          <span className="block font-display text-4xl leading-none text-ink">Lucio López Fleming</span>
          <span className="mb-8 mt-2 block text-xs font-semibold uppercase tracking-[0.2em] text-brick">{invitation ? "CRM · Bienvenida" : "CRM · Nueva contraseña"}</span>
        </h1>
        <div className="rounded-[var(--radius-lg)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          {token ? (
            <>
              {invitation ? <p className="mb-4 text-sm text-ink-2">Te invitaron al CRM. Definí tu contraseña para ingresar.</p> : null}
              <ResetForm token={token} invitation={invitation} />
            </>
          ) : (
            <Alert tone="danger">El link no es válido. Pedí uno nuevo desde “Olvidé mi contraseña”.</Alert>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-stone">
          <Link href="/crm/recuperar" className="underline underline-offset-4 hover:text-ink">
            Pedir un link nuevo
          </Link>
        </p>
      </div>
    </main>
  );
}
