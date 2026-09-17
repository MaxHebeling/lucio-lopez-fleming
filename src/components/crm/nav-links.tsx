"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type ShellNavItem = { href: string; label: string; group: string };
const GROUP_LABEL: Record<string, string> = { operacion: "Operación", comercial: "Comercial", alquileres: "Alquileres", marketing: "Marketing", sistema: "Sistema" };

export function NavLinks({ items, onNavigate }: { items: ShellNavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = [...new Set(items.map((i) => i.group))];
  const active = (href: string) => (href === "/crm" ? pathname === "/crm" : pathname === href || pathname.startsWith(`${href}/`));
  // El ítem más específico gana (p. ej. /crm/alquileres/cobros frente a /crm/alquileres)
  const best = items.filter((i) => active(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="CRM" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone">{GROUP_LABEL[g] ?? g}</p>
          <ul className="flex flex-col">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={best === i.href ? "page" : undefined}
                    className={cx(
                      "block rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors",
                      best === i.href ? "bg-ink font-semibold text-paper" : "text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
