/** Paginación server-side por offset (listados operativos del CRM). */
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

export const MAX_PAGE_SIZE = 100;

export function pageWindow(page: number | undefined, pageSize: number | undefined, defaultSize = 25) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize ?? defaultSize) || defaultSize));
  const p = Math.max(1, Math.trunc(page ?? 1) || 1);
  return { page: p, pageSize: size, limit: size, offset: (p - 1) * size };
}

export function toPage<T>(items: T[], total: number, win: { page: number; pageSize: number }): Page<T> {
  return { items, total, page: win.page, pageSize: win.pageSize, pageCount: Math.max(1, Math.ceil(total / win.pageSize)) };
}

/** Escapa comodines de LIKE en texto ingresado por el usuario. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
