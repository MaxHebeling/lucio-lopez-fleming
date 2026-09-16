/** Helpers para searchParams (Next 16: llegan como Promise y pueden traer arrays). */
export type SearchParams = Record<string, string | string[] | undefined>;

export function first(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

export function pageParam(sp: SearchParams): number {
  const n = Number(first(sp, "page"));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Copia plana de los params (para conservar filtros en links). */
export function flatParams(sp: SearchParams, keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((k) => [k, first(sp, k)]));
}
