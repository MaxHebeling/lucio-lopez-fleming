/**
 * Contrato de adaptadores de portales inmobiliarios.
 * - `prepare` es PURO: mapea el modelo interno al formato del portal (o devuelve qué falta). Su salida se hashea
 *   para no reenviar publicaciones sin cambios.
 * - publish/update/remove/getStatus hablan con el portal y devuelven resultados tipados (no lanzan por rechazos
 *   esperables): awaiting_credentials, invalid_data (dato faltante o rechazado: no se reintenta), transient (se reintenta)
 *   o uncertain (una creación pudo haberse aplicado: no se reintenta sola; verificación humana).
 * - Un adaptador NUNCA modifica datos del CRM.
 */
import type { Database } from "../../db";

export type PortalOperation = {
  operation: "sale" | "rent" | "temporary_rent";
  currency: "USD" | "ARS";
  amount: number | null;
  priceHidden: boolean;
  expensesAmount: number | null;
  expensesCurrency: "USD" | "ARS" | null;
};

export type PortalPhoto = { mediaId: string; url: string; isCover: boolean };

/** Foto de la propiedad tal como la ven los portales (datos reales, sin campos privados: ni propietarios ni notas). */
export type PortalProperty = {
  id: string;
  code: number;
  slug: string;
  title: string;
  description: string | null;
  typeKey: string;
  typeName: string;
  status: string;
  isPublished: boolean;
  operations: PortalOperation[];
  /** De lo más específico a lo más general (barrio → localidad → provincia → país). */
  locationChain: Array<{ id: string; kind: string; name: string }>;
  /** Vínculos cargados a mano entre ubicaciones internas y las del portal (external_refs). */
  externalLocationRefs: Record<string, Array<{ externalType: string; externalId: string }>>;
  address: { street: string | null; number: string | null; hideExact: boolean; latitude: number | null; longitude: number | null };
  areas: { totalM2: number | null; coveredM2: number | null; uncoveredM2: number | null; landM2: number | null };
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  toilets: number | null;
  garages: number | null;
  ageYears: number | null;
  allowsPets: boolean | null;
  creditEligible: boolean | null;
  features: string[];
  photos: PortalPhoto[];
  publicUrl: string;
  contact: { name: string; email: string | null; phone: string | null };
};

export type PortalFailure = { ok: false; reason: "awaiting_credentials" | "invalid_data" | "transient" | "uncertain"; error: string };
/** `adopted`: se encontró un aviso propio ya existente (por referencia) y se usó en lugar de crear otro. */
export type PortalOpResult = { ok: true; externalId: string; externalUrl: string | null; adopted?: boolean } | PortalFailure;
export type PortalPublishOptions = {
  /** Hubo un intento anterior de resultado incierto: buscar el aviso por referencia propia antes de crear. */
  searchExisting?: boolean;
};
export type PortalFindResult = { ok: true; item: { externalId: string; externalUrl: string | null; state: PortalRemoteState } | null } | PortalFailure;
export type PortalRemoveResult = { ok: true } | PortalFailure;
export type PortalRemoteState = "active" | "paused" | "closed" | "under_review" | "unknown";
export type PortalStatusResult = { ok: true; state: PortalRemoteState; externalUrl: string | null } | PortalFailure;
export type PortalPrepared<T = unknown> = { ok: true; payload: T } | { ok: false; errors: string[] };
export type PortalConfiguration = { configured: true } | { configured: false; reason: string };

export interface PortalAdapter {
  readonly channelKey: string;
  readonly integrationKey: string;
  readonly name: string;
  configuration(db: Database): Promise<PortalConfiguration>;
  prepare(property: PortalProperty): PortalPrepared;
  publish(db: Database, property: PortalProperty, opts?: PortalPublishOptions): Promise<PortalOpResult>;
  update(db: Database, externalId: string, property: PortalProperty, opts?: PortalPublishOptions): Promise<PortalOpResult>;
  remove(db: Database, externalId: string): Promise<PortalRemoveResult>;
  getStatus(db: Database, externalId: string): Promise<PortalStatusResult>;
  /** Busca un aviso propio por referencia (para no duplicar tras un resultado incierto). Opcional. */
  findByReference?(db: Database, property: Pick<PortalProperty, "id" | "code">): Promise<PortalFindResult>;
}

/** Operación principal para portales que admiten una sola por aviso: venta, luego alquiler, luego temporario. */
export function primaryOperation(p: PortalProperty): PortalOperation | null {
  for (const op of ["sale", "rent", "temporary_rent"] as const) {
    const found = p.operations.find((o) => o.operation === op);
    if (found) return found;
  }
  return null;
}

/** Fotos en orden de publicación: portada primero, luego el orden cargado. */
export function orderedPhotos(p: PortalProperty, max: number): PortalPhoto[] {
  return [...p.photos].sort((a, b) => Number(b.isCover) - Number(a.isCover)).slice(0, max);
}
