"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type ShellNavItem = { href: string; label: string; icon: string; group: string };

/**
 * Menú del CRM: un emoji de color por acceso y el ítem activo como pastilla. Los grupos se separan solo con espacio.
 * El emoji es decorativo (aria-hidden): lectores de pantalla leen el nombre del acceso.
 */
export function NavLinks({ items, onNavigate }: { items: ShellNavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = [...new Set(items.map((i) => i.group))];
  const active = (href: string) => (href === "/crm" ? pathname === "/crm" : pathname === href || pathname.startsWith(`${href}/`));
  // El ítem más específico gana (p. ej. /crm/alquileres/cobros frente a /crm/alquileres)
  const best = items.filter((i) => active(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="CRM" className="flex flex-col gap-3">
      {groups.map((g) => (
        <ul key={g} className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.group === g)
            .map((i) => {
              const current = best === i.href;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[15px] transition-colors duration-[var(--motion-fast)]",
                      current ? "bg-[var(--nav-active)] font-semibold text-white shadow-[var(--shadow-soft)]" : "text-ink hover:bg-paper-2",
                    )}
                  >
                    <span aria-hidden="true" className="w-6 shrink-0 text-center text-xl leading-none">
                      {i.icon}
                    </span>
                    <span className="truncate">{i.label}</span>
                  </Link>
                </li>
              );
            })}
        </ul>
      ))}
    </nav>
  );
}
