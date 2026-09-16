import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { CRM_NAV, NAV_PERMISSION_ALIASES } from "../nav";
import { NavLinks } from "@/components/crm/nav-links";
import { MobileNav } from "@/components/crm/mobile-nav";

export default async function PanelLayout({ children }: LayoutProps<"/crm">) {
  const actor = await requireStaffPage();
  const items = CRM_NAV.filter((i) => can(actor, i.permission) || (NAV_PERMISSION_ALIASES[i.permission] ?? []).some((p) => can(actor, p))).map(
    ({ href, label, group }) => ({ href, label, group }),
  );
  const unread = await getDb()
    .selectFrom("notifications")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("user_id", "=", actor.userId)
    .where("read_at", "is", null)
    .executeTakeFirst();

  return (
    <div className="min-h-svh bg-paper lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-svh overflow-y-auto border-r border-line bg-paper px-3 py-5 lg:block">
        <Link href="/crm" className="mb-6 block px-3">
          <span className="font-display text-2xl leading-none">Lucio López Fleming</span>
          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-brick">Buenos negocios</span>
        </Link>
        <NavLinks items={items} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-[var(--z-header)] flex h-14 items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <MobileNav items={items} />
            <span className="hidden text-sm text-stone sm:inline">{actor.fullName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/crm/notificaciones" className="relative rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-semibold hover:bg-paper-2">
              Avisos
              {Number(unread?.n ?? 0) > 0 ? (
                <span className="ml-1.5 rounded-full bg-brick px-1.5 py-0.5 text-[11px] text-white" aria-label={`${unread?.n} sin leer`}>
                  {unread?.n}
                </span>
              ) : null}
            </Link>
            <Link href="/crm/cuenta" className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm hover:bg-paper-2">
              Cuenta
            </Link>
            <form action="/crm/logout" method="post">
              <button type="submit" className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm hover:bg-paper-2">
                Salir
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
