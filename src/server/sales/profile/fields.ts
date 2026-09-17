/**
 * Perfil del comprador: lista CERRADA de campos inmobiliarios y sus valores válidos (puro, sin base).
 * Nada de atributos sensibles (salud, religión, etnia, situación familiar, ingresos, documentos): no hay campo donde
 * guardarlos y los valores son objetos estrictos (una clave extra se rechaza).
 */
import { z } from "zod";
import { FINANCING, MOVE_TIMEFRAMES, TRANSACTION_TYPES, type SearchIntent } from "../intent/schema";

export const PROFILE_FIELDS = [
  "transaction_type",
  "goal",
  "property_types",
  "budget",
  "locations",
  "bedrooms_min",
  "bathrooms_min",
  "surface",
  "features",
  "move_timeframe",
  "financing",
  "notes",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

// `visit_report`: reacción de IA al confirmar un informe de visita (Fase 6); siempre SUGERIDO.
export const PREFERENCE_SOURCES = ["form", "concierge", "conversation", "agent", "lead_message", "visit_report"] as const;
export type PreferenceSource = (typeof PREFERENCE_SOURCES)[number];

export const GOALS = ["live", "invest", "business", "other"] as const;
export const PROFILE_FINANCING = [...FINANCING, "undecided"] as const;

const slug = z.string().regex(/^[a-z0-9_-]{1,140}$/);
const key = z.string().regex(/^[a-z0-9_]{2,80}$/);
const positive = z.number().finite().positive().max(1e12);

export const locationValueSchema = z.strictObject({ kind: z.enum(["locality", "area"]), slug, name: z.string().trim().min(1).max(120), localitySlug: slug.nullable() });
export type LocationValue = z.infer<typeof locationValueSchema>;

export const FIELD_VALUE_SCHEMAS = {
  transaction_type: z.enum(TRANSACTION_TYPES),
  goal: z.enum(GOALS),
  property_types: z.array(key).min(1).max(6),
  budget: z
    .strictObject({ min: positive.nullable(), max: positive.nullable(), currency: z.enum(["USD", "ARS"]) })
    .refine((b) => b.min !== null || b.max !== null, "Indicá un mínimo o un máximo")
    .refine((b) => b.min === null || b.max === null || b.min <= b.max, "El mínimo no puede superar al máximo"),
  locations: z.array(locationValueSchema).min(1).max(8),
  bedrooms_min: z.number().int().min(0).max(20),
  bathrooms_min: z.number().int().min(1).max(20),
  surface: z
    .strictObject({ min: z.number().positive().max(1e9).nullable(), max: z.number().positive().max(1e9).nullable() })
    .refine((s) => s.min !== null || s.max !== null, "Indicá un mínimo o un máximo")
    .refine((s) => s.min === null || s.max === null || s.min <= s.max, "El mínimo no puede superar al máximo"),
  features: z.array(key).min(1).max(20),
  move_timeframe: z.enum(MOVE_TIMEFRAMES),
  financing: z.enum(PROFILE_FINANCING),
  notes: z.string().trim().min(1).max(1000),
} satisfies Record<ProfileField, z.ZodType>;

export type FieldValue<F extends ProfileField> = z.infer<(typeof FIELD_VALUE_SCHEMAS)[F]>;

export const FIELD_LABEL: Record<ProfileField, string> = {
  transaction_type: "Operación",
  goal: "Objetivo",
  property_types: "Tipo de propiedad",
  budget: "Presupuesto",
  locations: "Zonas",
  bedrooms_min: "Dormitorios (mínimo)",
  bathrooms_min: "Baños (mínimo)",
  surface: "Superficie",
  features: "Prioridades / características",
  move_timeframe: "Plazo",
  financing: "Financiación",
  notes: "Notas de la búsqueda",
};

export const SOURCE_LABEL: Record<PreferenceSource, string> = {
  form: "Formulario del sitio",
  concierge: "Búsqueda en el sitio (concierge)",
  conversation: "Conversación",
  agent: "Cargado por el equipo",
  lead_message: "Consulta escrita",
  visit_report: "Informe de visita",
};

export const TRANSACTION_LABEL = { sale: "Compra", rent: "Alquiler", temporary_rent: "Alquiler temporario" } as const;
export const GOAL_LABEL = { live: "Vivienda propia", invest: "Inversión", business: "Uso comercial", other: "Otro" } as const;
export const FINANCING_LABEL = { credit: "Crédito hipotecario", cash: "Contado", undecided: "Todavía no lo sabe" } as const;
export const TIMEFRAME_PROFILE_LABEL = { immediate: "Lo antes posible", within_3_months: "En 3 meses", within_6_months: "En 6 meses", later: "Más adelante" } as const;

export function parseFieldValue<F extends ProfileField>(field: F, value: unknown): { ok: true; value: FieldValue<F> } | { ok: false; error: string } {
  const r = FIELD_VALUE_SCHEMAS[field].safeParse(value);
  return r.success ? { ok: true, value: r.data as FieldValue<F> } : { ok: false, error: r.error.issues[0]?.message ?? "Valor inválido" };
}

/** JSON estable (claves ordenadas) para comparar valores. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export type Names = { types?: Map<string, string>; features?: Map<string, string> };
const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** Valor legible para la ficha del contacto. */
export function formatFieldValue(field: ProfileField, value: unknown, names: Names = {}): string {
  const parsed = parseFieldValue(field, value);
  if (!parsed.ok) return "—";
  const v = parsed.value as never;
  switch (field) {
    case "transaction_type":
      return TRANSACTION_LABEL[v as keyof typeof TRANSACTION_LABEL];
    case "goal":
      return GOAL_LABEL[v as keyof typeof GOAL_LABEL];
    case "property_types":
      return (v as string[]).map((k) => names.types?.get(k) ?? k).join(", ");
    case "budget": {
      const b = v as FieldValue<"budget">;
      const m = (n: number) => `${b.currency === "USD" ? "USD" : "$"} ${nf.format(n)}`;
      return b.min !== null && b.max !== null ? `${m(b.min)} a ${m(b.max)}` : b.max !== null ? `Hasta ${m(b.max)}` : `Desde ${m(b.min!)}`;
    }
    case "locations":
      return (v as LocationValue[]).map((l) => l.name).join(" · ");
    case "bedrooms_min":
      return `${v}+`;
    case "bathrooms_min":
      return `${v}+`;
    case "surface": {
      const s = v as FieldValue<"surface">;
      return s.min !== null && s.max !== null ? `${nf.format(s.min)} a ${nf.format(s.max)} m²` : s.min !== null ? `Desde ${nf.format(s.min)} m²` : `Hasta ${nf.format(s.max!)} m²`;
    }
    case "features":
      return (v as string[]).map((k) => names.features?.get(k) ?? k.replace(/_/g, " ")).join(", ");
    case "move_timeframe":
      return TIMEFRAME_PROFILE_LABEL[v as keyof typeof TIMEFRAME_PROFILE_LABEL];
    case "financing":
      return FINANCING_LABEL[v as keyof typeof FINANCING_LABEL];
    case "notes":
      return v as string;
  }
}

export type ProposedItem = { field: ProfileField; value: unknown; confidence: number };

/**
 * Intención del concierge (filtros que la persona usó en el sitio) → datos SUGERIDOS del perfil.
 * Solo campos filtrables y validados; la confianza sale de la intención (lo inferido pesa menos).
 */
export function intentToProposals(i: SearchIntent): ProposedItem[] {
  const out: ProposedItem[] = [];
  const conf = (c: number) => Math.round(Math.min(0.9, c * 0.9) * 100) / 100; // nunca «confirmado»: lo confirma una persona
  if (i.transactionType) out.push({ field: "transaction_type", value: i.transactionType.value, confidence: conf(i.transactionType.confidence) });
  if (i.propertyTypes) out.push({ field: "property_types", value: i.propertyTypes.value, confidence: conf(i.propertyTypes.confidence) });
  if (i.currency && (i.budgetMin || i.budgetMax)) {
    out.push({ field: "budget", value: { min: i.budgetMin?.value ?? null, max: i.budgetMax?.value ?? null, currency: i.currency.value }, confidence: conf(Math.min(i.budgetMin?.confidence ?? 1, i.budgetMax?.confidence ?? 1)) });
  }
  if (i.locations) out.push({ field: "locations", value: i.locations.value.map((l) => ({ kind: l.kind, slug: l.slug, name: l.name, localitySlug: l.localitySlug })), confidence: conf(i.locations.confidence) });
  if (i.bedrooms && i.bedrooms.value > 0) out.push({ field: "bedrooms_min", value: i.bedrooms.value, confidence: conf(i.bedrooms.confidence) });
  if (i.bathrooms) out.push({ field: "bathrooms_min", value: i.bathrooms.value, confidence: conf(i.bathrooms.confidence) });
  if (i.surface) out.push({ field: "surface", value: i.surface.value, confidence: conf(i.surface.confidence) });
  if (i.features) out.push({ field: "features", value: i.features.value, confidence: conf(i.features.confidence) });
  if (i.moveTimeframe) out.push({ field: "move_timeframe", value: i.moveTimeframe.value, confidence: conf(i.moveTimeframe.confidence) });
  if (i.financing) out.push({ field: "financing", value: i.financing.value, confidence: conf(i.financing.confidence) });
  if (i.preferences.includes("investment")) out.push({ field: "goal", value: "invest", confidence: 0.7 });
  return out.filter((p) => parseFieldValue(p.field, p.value).ok);
}
