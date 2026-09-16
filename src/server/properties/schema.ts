import { z } from "zod";

export const OPERATIONS = ["sale", "rent", "temporary_rent"] as const;
export const CURRENCIES = ["USD", "ARS"] as const;
export const PROPERTY_STATUSES = ["draft", "available", "reserved", "sold", "rented", "paused", "archived"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export type Operation = (typeof OPERATIONS)[number];

export const OPERATION_LABEL: Record<Operation, string> = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler temporario" };
export const STATUS_LABEL: Record<PropertyStatus, string> = {
  draft: "Borrador",
  available: "Disponible",
  reserved: "Reservada",
  sold: "Vendida",
  rented: "Alquilada",
  paused: "Pausada",
  archived: "Archivada",
};

/** Transiciones de estado permitidas. Cualquier otra se rechaza en el servidor. */
export const STATUS_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  draft: ["available", "archived"],
  available: ["reserved", "sold", "rented", "paused", "archived"],
  reserved: ["available", "sold", "rented", "paused", "archived"],
  sold: ["available", "archived"],
  rented: ["available", "archived"],
  paused: ["available", "archived"],
  archived: ["draft", "available"],
};

const optionalNumber = (max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(0).max(max).nullable());
const optionalInt = (max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(max).nullable());
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v ?? null), z.string().max(max).nullable());
const optionalBool = z.preprocess((v) => (v === "" || v === undefined ? null : v === "true" || v === "on" ? true : v === "false" ? false : v), z.boolean().nullable());

export const operationInputSchema = z
  .object({
    operation: z.enum(OPERATIONS),
    currency: z.enum(CURRENCIES),
    amount: optionalNumber(1e12),
    priceHidden: z.boolean().default(false),
    expensesAmount: optionalNumber(1e10).optional(),
    expensesCurrency: z.enum(CURRENCIES).nullable().optional(),
  })
  .refine((o) => o.priceHidden || o.amount !== null, { message: "Indicá el precio o marcalo como 'consultar'", path: ["amount"] });
export type OperationInput = z.infer<typeof operationInputSchema>;

export const propertyFieldsSchema = z.object({
  title: z.string().trim().min(3, "El título es muy corto").max(200),
  description: optionalText(20_000),
  typeKey: z.string().regex(/^[a-z_]{2,40}$/),
  branchId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  addressStreet: optionalText(200),
  addressNumber: optionalText(20),
  addressFloor: optionalText(20),
  addressUnit: optionalText(20),
  hideExactAddress: z.boolean().default(true),
  latitude: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(-90).max(90).nullable()),
  longitude: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(-180).max(180).nullable()),
  totalAreaM2: optionalNumber(1e9),
  coveredAreaM2: optionalNumber(1e9),
  uncoveredAreaM2: optionalNumber(1e9),
  landAreaM2: optionalNumber(1e11),
  rooms: optionalInt(200),
  bedrooms: optionalInt(200),
  bathrooms: optionalInt(200),
  toilets: optionalInt(200),
  garages: optionalInt(2000),
  ageYears: optionalInt(500),
  orientation: optionalText(40),
  disposition: optionalText(40),
  condition: optionalText(60),
  creditEligible: optionalBool,
  professionalUse: optionalBool,
  allowsPets: optionalBool,
  featured: z.boolean().default(false),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  featureKeys: z.array(z.string().regex(/^[a-z0-9_]{2,80}$/)).max(200).default([]),
  seoTitle: optionalText(70),
  seoDescription: optionalText(170),
});

export const createPropertySchema = propertyFieldsSchema.extend({
  operations: z.array(operationInputSchema).min(1, "Agregá al menos una operación").max(3),
});
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

// Sin defaults: en Zod 4 `.partial()` conserva los `.default()`, y una edición parcial (p. ej. solo dormitorios)
// borraba características y atributos y reseteaba destacada/ocultar dirección.
export const updatePropertySchema = propertyFieldsSchema
  .extend({
    hideExactAddress: z.boolean(),
    featured: z.boolean(),
    attributes: propertyFieldsSchema.shape.attributes.unwrap(),
    featureKeys: propertyFieldsSchema.shape.featureKeys.unwrap(),
  })
  .partial();
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

/** Mapeo campo de entrada → columna. Se usa también para campos protegidos contra reimportación. */
export const FIELD_COLUMNS = {
  title: "title",
  description: "description",
  typeKey: "type_key",
  branchId: "branch_id",
  locationId: "location_id",
  addressStreet: "address_street",
  addressNumber: "address_number",
  addressFloor: "address_floor",
  addressUnit: "address_unit",
  hideExactAddress: "hide_exact_address",
  latitude: "latitude",
  longitude: "longitude",
  totalAreaM2: "total_area_m2",
  coveredAreaM2: "covered_area_m2",
  uncoveredAreaM2: "uncovered_area_m2",
  landAreaM2: "land_area_m2",
  rooms: "rooms",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  toilets: "toilets",
  garages: "garages",
  ageYears: "age_years",
  orientation: "orientation",
  disposition: "disposition",
  condition: "condition",
  creditEligible: "credit_eligible",
  professionalUse: "professional_use",
  allowsPets: "allows_pets",
  featured: "featured",
  attributes: "attributes",
  seoTitle: "seo_title",
  seoDescription: "seo_description",
} as const;

export type FieldSchemaEntry = { key: string; label: string; type: "text" | "number" | "integer" | "boolean" | "date"; unit?: string };

/** Valida `attributes` contra el field_schema del tipo: descarta claves desconocidas y tipos incorrectos. */
export function validateAttributes(schema: FieldSchemaEntry[], attrs: Record<string, unknown>): { value: Record<string, string | number | boolean | null>; errors: Record<string, string[]> } {
  const value: Record<string, string | number | boolean | null> = {};
  const errors: Record<string, string[]> = {};
  for (const f of schema) {
    const raw = attrs[f.key];
    if (raw === undefined || raw === null || raw === "") continue;
    switch (f.type) {
      case "number":
      case "integer": {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || (f.type === "integer" && !Number.isInteger(n))) errors[`attributes.${f.key}`] = [`${f.label}: número inválido`];
        else value[f.key] = n;
        break;
      }
      case "boolean":
        value[f.key] = raw === true || raw === "true" || raw === "on";
        break;
      case "date":
        if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors[`attributes.${f.key}`] = [`${f.label}: fecha inválida`];
        else value[f.key] = raw;
        break;
      default:
        value[f.key] = String(raw).slice(0, 500);
    }
  }
  return { value, errors };
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
