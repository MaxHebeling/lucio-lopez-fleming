import Link from "next/link";
import { buttonClass, cx } from "@/components/ui";

/** Paginación por query string conservando los filtros. */
export function Pagination({ basePath, params, page, pageSize, total }: { basePath: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>
          Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-stone">
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>
          Siguiente
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Convierte searchParams de Next en un objeto plano de strings (primer valor). */
export function flatParams(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}


type BarProps = { page: number; pageCount: number; total: number; pathname: string; params: Record<string, string | undefined>; label?: string };

export function hrefWith(pathname: string, params: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) if (v !== undefined && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/** Paginación con total y conteo (funciona sin JS, conserva los filtros). */
export function PaginationBar({ page, pageCount, total, pathname, params, label = "resultados" }: BarProps) {
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
