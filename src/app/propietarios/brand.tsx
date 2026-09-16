import Link from "next/link";
import type { ReactNode } from "react";

/** Encabezado de marca del portal: sobrio, tinta sobre papel, acento ladrillo. */
export function PortalBrand({ href = "/propietarios" }: { href?: string }) {
  return (
    <Link href={href} className="block">
      <span className="font-display text-3xl leading-none text-ink sm:text-4xl">Lucio López Fleming</span>
      <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-brick">Portal de propietarios · desde 1974</span>
    </Link>
  );
}

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <PortalBrand href="/propietarios/login" />
        <h1 className="mb-6 mt-8 text-xl font-bold text-ink">{title}</h1>
        <div className="rounded-[var(--radius-lg)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">{children}</div>
        {footer ? <div className="mt-4 text-center text-sm text-stone">{footer}</div> : null}
      </div>
    </main>
  );
}
