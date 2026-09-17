import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { isEnabled } from "@/server/flags";
import { PortalBrand } from "../brand";

export const metadata: Metadata = { title: "Portal de propietarios", robots: { index: false, follow: false } };

const NAV = [
  { href: "/propietarios", label: "Inicio" },
  { href: "/propietarios/liquidaciones", label: "Liquidaciones" },
  { href: "/propietarios/documentos", label: "Documentos" },
  { href: "/propietarios/informes", label: "Informes" },
  { href: "/propietarios/cuenta", label: "Cuenta" },
];

export default async function PortalLayout({ children }: LayoutProps<"/propietarios">) {
  const actor = await requireOwnerPage();
  const enabled = await isEnabled(getDb(), "owner_portal");
  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-line bg-paper print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-4 pb-3 pt-5 sm:px-6">
          <PortalBrand />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-stone sm:inline">{actor.fullName}</span>
            <form action="/propietarios/logout" method="post">
              <button type="submit" className="rounded-[var(--radius-md)] border border-line px-3 py-1.5 font-semibold hover:border-ink">
                Salir
              </button>
            </form>
          </div>
        </div>
        <nav aria-label="Portal" className="mx-auto max-w-5xl overflow-x-auto px-4 sm:px-6">
          <ul className="flex gap-1 pb-2 text-sm">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-ink-2 hover:bg-paper-2 hover:text-ink">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        {enabled ? (
          children
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line bg-white p-6 text-sm">El portal de propietarios no está disponible en este momento. Si necesitás información, contactanos.</div>
        )}
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-stone sm:px-6 print:hidden">Lucio López Fleming Inmobiliaria · Av. Entre Ríos 639, Salta · Tus datos son privados: solo vos ves la información de tus propiedades.</footer>
    </div>
  );
}
