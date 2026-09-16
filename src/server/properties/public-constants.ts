/** Constantes del sitio público sin dependencias (se pueden importar desde componentes cliente). */
export const PAGE_SIZE = 24;

/** Slugs públicos de operación (URL en castellano) ↔ valores de la base. */
export const OPERATION_SLUGS = { venta: "sale", alquiler: "rent", temporario: "temporary_rent" } as const;
export type OperationSlug = keyof typeof OPERATION_SLUGS;
export type PublicOperation = (typeof OPERATION_SLUGS)[OperationSlug];
export const OPERATION_TO_SLUG: Record<PublicOperation, OperationSlug> = { sale: "venta", rent: "alquiler", temporary_rent: "temporario" };
export const OPERATION_NOUN: Record<PublicOperation, string> = { sale: "venta", rent: "alquiler", temporary_rent: "alquiler temporario" };

export const SORTS = ["recientes", "precio-asc", "precio-desc", "superficie"] as const;
export type SortKey = (typeof SORTS)[number];
export const SORT_LABEL: Record<SortKey, string> = {
  recientes: "Más recientes",
  "precio-asc": "Menor precio",
  "precio-desc": "Mayor precio",
  superficie: "Mayor superficie",
};

