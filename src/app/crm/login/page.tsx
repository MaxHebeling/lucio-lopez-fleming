import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/next/context";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar al CRM", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: PageProps<"/crm/login">) {
  const actor = await getActor();
  if (actor.kind === "staff") redirect("/crm");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="font-display text-4xl leading-none text-ink">Lucio López Fleming</p>
        <p className="mb-8 mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-brick">CRM · Equipo</p>
        <div className="rounded-[var(--radius-lg)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <LoginForm next={next} />
        </div>
        <p className="mt-4 text-center text-sm text-stone">
          <Link href="/crm/recuperar" className="underline underline-offset-4 hover:text-ink">
            Olvidé mi contraseña
          </Link>
        </p>
      </div>
    </main>
  );
}
