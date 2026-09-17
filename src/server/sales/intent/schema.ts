/**
 * Intención de búsqueda inmobiliaria (concierge del sitio). Esquema ÚNICO para la capa determinista y la de IA:
 * solo lo que la persona expresó (o se infiere con certeza), cada campo con su origen y confianza. Nada se inventa:
 * lo no reconocido va a `unparsed` y no filtra.
 *
 * Sin dependencias de base ni de Next: lo importan también componentes cliente (tipos) y tests.
 */
import { z } from "zod";

export const TRANSACTION_TYPES = ["sale", "rent", "temporary_rent"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const MOVE_TIMEFRAMES = ["immediate", "within_3_months", "within_6_months", "later"] as const;
export type MoveTimeframe = (typeof MOVE_TIMEFRAMES)[number];

export const FINANCING = ["credit", "cash"] as const;
export type Financing = (typeof FINANCING)[number];

/** Preferencias blandas reconocidas: se muestran, NO filtran (el buscador no tiene un dato real para eso). */
export const SOFT_PREFERENCES = ["quiet", "bright", "near_city", "brand_new", "view", "gated_community", "spacious", "investment", "pets"] as const;
export type SoftPreference = (typeof SOFT_PREFERENCES)[number];

/** text = dicho literalmente · inferred = convención inequívoca (p. ej. 2 ambientes ≈ 1 dormitorio) · ai = extraído por el modelo y validado. */
export const ORIGINS = ["text", "inferred", "ai"] as const;
export type Origin = (typeof ORIGINS)[number];

const meta = { origin: z.enum(ORIGINS), confidence: z.number().min(0).max(1), evidence: z.string().max(80).nullable() };
const sourced = <T extends z.ZodType>(value: T) => z.object({ value, ...meta });

export const intentLocationSchema = z.object({
  kind: z.enum(["locality", "area"]),
  slug: z.string().regex(/^[a-z0-9_-]{1,140}$/),
  name: z.string().max(120),
  /** Localidad a la que pertenece un barrio (para la URL zona+barrio). */
  localitySlug: z.string().regex(/^[a-z0-9_-]{1,140}$/).nullable(),
});
export type IntentLocation = z.infer<typeof intentLocationSchema>;

export const searchIntentSchema = z.object({
  transactionType: sourced(z.enum(TRANSACTION_TYPES)).nullable(),
  propertyTypes: sourced(z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).min(1).max(4)).nullable(),
  budgetMin: sourced(z.number().positive().max(1e12)).nullable(),
  budgetMax: sourced(z.number().positive().max(1e12)).nullable(),
  currency: sourced(z.enum(["USD", "ARS"])).nullable(),
  locations: sourced(z.array(intentLocationSchema).min(1).max(4)).nullable(),
  bedrooms: sourced(z.number().int().min(0).max(20)).nullable(),
  bathrooms: sourced(z.number().int().min(1).max(20)).nullable(),
  surface: sourced(z.object({ min: z.number().positive().max(1e9).nullable(), max: z.number().positive().max(1e9).nullable() })).nullable(),
  garages: sourced(z.number().int().min(1).max(20)).nullable(),
  features: sourced(z.array(z.string().regex(/^[a-z0-9_]{2,80}$/)).min(1).max(12)).nullable(),
  moveTimeframe: sourced(z.enum(MOVE_TIMEFRAMES)).nullable(),
  financing: sourced(z.enum(FINANCING)).nullable(),
  preferences: z.array(z.enum(SOFT_PREFERENCES)).max(9),
  /** Monto dicho sin moneda: no filtra; la UI ofrece elegir USD o pesos. */
  ambiguousAmount: z.object({ min: z.number().positive().nullable(), max: z.number().positive().nullable() }).nullable(),
  /** Fragmentos del texto que no se pudieron interpretar (se muestran, no filtran). */
  unparsed: z.array(z.string().max(80)).max(8),
});
export type SearchIntent = z.infer<typeof searchIntentSchema>;
export type Sourced<T> = { value: T; origin: Origin; confidence: number; evidence: string | null };

export function emptyIntent(): SearchIntent {
  return {
    transactionType: null,
    propertyTypes: null,
    budgetMin: null,
    budgetMax: null,
    currency: null,
    locations: null,
    bedrooms: null,
    bathrooms: null,
    surface: null,
    garages: null,
    features: null,
    moveTimeframe: null,
    financing: null,
    preferences: [],
    ambiguousAmount: null,
    unparsed: [],
  };
}

/** ¿Hay algo que filtre de verdad? */
export function intentHasFilters(i: SearchIntent): boolean {
  return Boolean(
    i.transactionType || i.propertyTypes || i.budgetMax || i.budgetMin || i.locations || i.bedrooms || i.bathrooms || i.surface || i.garages || i.features || i.financing?.value === "credit",
  );
}

/** Catálogo real contra el que se valida todo (tipos activos, zonas con inventario publicado, características). */
export type SalesCatalog = {
  types: Array<{ key: string; name: string; plural: string; count: number }>;
  localities: Array<{ slug: string; name: string; count: number }>;
  areas: Array<{ slug: string; name: string; localitySlug: string; localityName: string; count: number }>;
  features: Array<{ key: string; name: string }>;
};
