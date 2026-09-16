import Link from "next/link";
import { cx } from "@/components/ui";

type Props = { page: number; pageCount: number; total: number; pathname: string; params: Record<string, string | undefined>; label?: string };

export function hrefWith(pathname: string, params: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) if (v !== undefined && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/** Paginación por links (funciona sin JS, conserva los filtros). */
export function Pagination({ page, pageCount, total, pathname, params, label = "resultados" }: Props) {
  if (total === 0) return null;
  const link = (p: number) => hrefWith(pathname, params, { page: p > 1 ? String(p) : undefined });
  const base = "inline-flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-md)] border border-line bg-white px-3 text-sm font-semibold";
  return (
    <nav aria-label="Paginación" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-stone">
      <p>
        {total.toLocaleString("es-AR")} {label} · página {page} de {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={base} href={link(page - 1)} rel="prev">
            Anterior
          </Link>
        ) : (
          <span className={cx(base, "opacity-40")} aria-disabled="true">
            Anterior
          </span>
        )}
        {page < pageCount ? (
          <Link className={base} href={link(page + 1)} rel="next">
            Siguiente
          </Link>
        ) : (
          <span className={cx(base, "opacity-40")} aria-disabled="true">
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
