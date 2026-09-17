/**
 * Normalización Adinco → modelo propio. Funciones PURAS (sin base ni red) para poder testearlas con datos reales.
 * Regla: no se corrige nada en silencio. Toda anomalía produce una advertencia; las de severidad `error`
 * dejan la propiedad en revisión (no se publica hasta que una persona la verifique).
 */
import { z } from "zod";
import { slugify } from "../../properties/schema";

export const ADINCO_SOURCE = "adinco";
export const ADINCO_MEDIA_BASE = "https://static1.adinco.net/";

const zone = z.object({ id: z.number(), name: z.string(), parent_id: z.number().nullable().optional(), category: z.string().nullable().optional() }).nullable().optional();
const named = z.array(z.object({ id: z.number(), name: z.string().nullable() })).nullable().optional();
const boolish = z.union([z.boolean(), z.number()]).nullable().optional().transform((v) => (v === null || v === undefined ? null : v === true || v === 1));
const num = z.number().nullable().optional();

export const adincoPropertySchema = z.object({
  id: z.number(),
  code: z.number(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  type: z.string(),
  typeId: z.number(),
  operation: z.string(),
  operationId: z.number(),
  currencyId: z.string().nullable().optional(),
  price: num,
  hiddenPrice: z.boolean().nullable().optional(),
  hiddenAddress: z.boolean().nullable().optional(),
  statusId: z.number(),
  address: z.object({ street: z.string().nullable().optional(), number: z.string().nullable().optional(), floor: z.string().nullable().optional(), apartment: z.string().nullable().optional() }).nullable().optional(),
  zp_1: zone,
  zp_2: zone,
  zp_3: zone,
  latitude: num,
  longitude: num,
  totalArea: num,
  totalAreaUnit: num,
  coveredArea: num,
  landArea: num,
  landAreaUnit: num,
  rooms: num,
  bedrooms: num,
  bathrooms: num,
  garages: num,
  coveredGarages: num,
  semiCoveredGarages: num,
  old: num,
  expenses: num,
  aptoCredito: boolish,
  professional: num,
  allowsPets: boolish,
  possessionDate: z.string().nullable().optional(),
  flats: num,
  services: named,
  others: named,
  ambients: named,
  buildingServices: named,
  buildingOthers: named,
  multimedia: z.array(z.object({ src: z.string(), multimediaTypeId: z.number() })).default([]),
  noteSellerId: num,
  sellerId: num,
  officeId: num,
});
export type AdincoProperty = z.infer<typeof adincoPropertySchema>;

export type Severity = "info" | "warning" | "error";
export type MigrationWarning = { code: string; field: string; severity: Severity; message: string; valueA?: string | null; valueB?: string | null };

export type NormalizedLocation = { externalId: string; kind: "province" | "locality" | "neighborhood" | "gated_community"; name: string; slug: string };

export type NormalizedProperty = {
  externalId: string;
  code: number;
  slug: string;
  title: string;
  description: string | null;
  typeKey: string;
  status: "available" | "reserved";
  operation: "sale" | "rent" | "temporary_rent";
  currency: "USD" | "ARS";
  amount: number | null;
  priceHidden: boolean;
  expensesAmount: number | null;
  locations: NormalizedLocation[];
  addressStreet: string | null;
  addressNumber: string | null;
  addressFloor: string | null;
  addressUnit: string | null;
  hideExactAddress: boolean;
  latitude: number | null;
  longitude: number | null;
  totalAreaM2: number | null;
  coveredAreaM2: number | null;
  landAreaM2: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  ageYears: number | null;
  creditEligible: boolean | null;
  professionalUse: boolean | null;
  allowsPets: boolean | null;
  attributes: Record<string, string | number | boolean>;
  features: Array<{ key: string; name: string; grp: "service" | "amenity" | "ambient" | "building_service" | "building_amenity" }>;
  media: Array<{ sourceUrl: string; kind: "image" | "video" | "floor_plan"; sortOrder: number; isCover: boolean }>;
  sellerExternalId: string | null;
  officeExternalId: string | null;
  redirectPath: string;
};

const TYPE_MAP: Record<string, string> = {
  casa: "casa",
  departamento: "departamento",
  ph: "ph",
  terreno: "terreno",
  lote: "lote",
  local: "local",
  oficina: "oficina",
  deposito: "deposito",
  galpon: "galpon",
  campo: "campo",
  quinta: "campo",
  cochera: "cochera",
  hotel: "hotel",
  "negocio-especial": "negocio_especial",
  emprendimiento: "emprendimiento",
};

const OPERATION_MAP: Record<string, NormalizedProperty["operation"]> = {
  venta: "sale",
  alquiler: "rent",
  "alquiler-temporario": "temporary_rent",
};

const HECTARE = 10_000;
// Límites de Argentina continental (para detectar coordenadas absurdas, no para "corregirlas")
const AR_BOUNDS = { latMin: -55.1, latMax: -21.7, lngMin: -73.6, lngMax: -53.6 };
const SALTA_BOUNDS = { latMin: -26.4, latMax: -21.9, lngMin: -68.6, lngMax: -62.3 };

function nonEmpty(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function zoneKind(level: 1 | 2 | 3, category: string | null | undefined): NormalizedLocation["kind"] {
  if (level === 1) return "province";
  if (level === 2) return "locality";
  return (category ?? "").toLowerCase().includes("cerrado") ? "gated_community" : "neighborhood";
}

export function mapAdincoProperty(raw: unknown): { property: NormalizedProperty | null; warnings: MigrationWarning[] } {
  const warnings: MigrationWarning[] = [];
  const parsed = adincoPropertySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      property: null,
      warnings: [{ code: "invalid_source_payload", field: "*", severity: "error", message: `Formato inesperado: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }],
    };
  }
  const a = parsed.data;
  const warn = (w: MigrationWarning) => warnings.push(w);

  const typeKey = /development|emprendimiento/i.test(a.type) ? "emprendimiento" : (TYPE_MAP[slugify(a.type)] ?? "otro");
  const isDevelopment = typeKey === "emprendimiento";
  if (typeKey === "otro") warn({ code: "unknown_type", field: "type_key", severity: "warning", message: `Tipo "${a.type}" sin equivalente: importado como Otro`, valueA: a.type });

  const operation = OPERATION_MAP[slugify(a.operation)];
  if (!operation) {
    return { property: null, warnings: [...warnings, { code: "unknown_operation", field: "operation", severity: "error", message: `Operación "${a.operation}" desconocida`, valueA: a.operation }] };
  }

  const priceHidden = Boolean(a.hiddenPrice);
  const amount = positive(a.price);
  const currency = a.currencyId === "usd" ? "USD" : a.currencyId === "pesos" ? "ARS" : null;
  // Sin precio la moneda no se muestra: solo es un error si hay monto con moneda desconocida.
  if (!currency && amount !== null) warn({ code: "unknown_currency", field: "currency", severity: "error", message: `Moneda "${a.currencyId}" desconocida`, valueA: a.currencyId ?? null });
  if (!priceHidden && amount === null) {
    if (isDevelopment) warn({ code: "development_price_on_request", field: "price", severity: "info", message: "Emprendimiento sin precio: se muestra 'Consultar'" });
    else warn({ code: "missing_price", field: "price", severity: "error", message: "Sin precio y sin marcar como 'consultar'" });
  }

  // Precios implausibles: no se tocan, se marcan para revisión.
  if (amount !== null && currency === "USD") {
    if (operation === "sale" && amount < 1_000)
      warn({ code: "implausible_price", field: "price", severity: "error", message: `Precio de venta muy bajo (USD ${amount}): ¿precio por m² o por hectárea, o error de carga?`, valueA: String(amount) });
    if (operation === "rent" && amount < 50)
      warn({ code: "implausible_price", field: "price", severity: "error", message: `Alquiler mensual muy bajo (USD ${amount})`, valueA: String(amount) });
  }
  if (amount !== null && currency === "ARS" && operation === "sale" && amount < 1_000_000)
    warn({ code: "implausible_price", field: "price", severity: "warning", message: `Venta en pesos con monto bajo ($ ${amount})`, valueA: String(amount) });
  if (currency === "ARS" && operation === "sale") warn({ code: "sale_in_pesos", field: "currency", severity: "info", message: "Venta publicada en pesos" });

  const description = nonEmpty(a.description);
  if (description && /(por|la|el)\s+(hect[aá]rea|m2|m²|metro cuadrado)/i.test(description) && amount !== null)
    warn({ code: "price_per_unit_in_description", field: "price", severity: "error", message: "La descripción indica precio por unidad (hectárea/m²): el precio cargado podría no ser el total", valueA: String(amount) });
  if (!description) warn({ code: "missing_description", field: "description", severity: "warning", message: "Sin descripción" });
  if (description && /(\+?54)?\s?(9\s?)?(387|0387)[\s-]?\d{6,7}|[\w.-]+@[\w-]+\.[a-z]{2,}/i.test(description))
    warn({ code: "contact_data_in_description", field: "description", severity: "info", message: "La descripción incluye teléfonos o emails: revisar antes de publicar en portales" });

  const title = nonEmpty(a.title) ?? `${a.type} en ${a.operation}`;
  if (!nonEmpty(a.title)) warn({ code: "missing_title", field: "title", severity: "warning", message: "Sin título: se usó tipo y operación" });
  else if (/^(casa|departamento|terreno|local|oficina|galp[oó]n|lote|predio|hotel)\s+en\s+(venta|alquiler)$/i.test(title.trim()))
    warn({ code: "generic_title", field: "title", severity: "info", message: "Título genérico: conviene uno descriptivo", valueA: title });

  // Superficies (unidad 2 = hectáreas en Adinco)
  let total = positive(a.totalArea);
  if (total !== null && a.totalAreaUnit === 2) {
    total = total * HECTARE;
    warn({ code: "area_in_hectares", field: "total_area_m2", severity: "info", message: `Superficie cargada en hectáreas (${a.totalArea} ha) convertida a m²`, valueA: String(a.totalArea) });
  }
  let land = positive(a.landArea);
  if (land !== null && a.landAreaUnit === 2) land = land * HECTARE;
  const covered = positive(a.coveredArea);
  if (total !== null && total > 1e9) {
    warn({ code: "implausible_area", field: "total_area_m2", severity: "error", message: `Superficie total implausible (${a.totalArea}${a.totalAreaUnit === 2 ? " ha" : " m²"})`, valueA: String(a.totalArea) });
    total = null;
  }
  if (covered !== null && total !== null && covered > total * 1.05 && !["departamento", "oficina", "hotel", "local"].includes(typeKey))
    warn({ code: "covered_exceeds_total", field: "covered_area_m2", severity: "warning", message: "La superficie cubierta supera a la total", valueA: String(covered), valueB: String(total) });
  if ((typeKey === "terreno" || typeKey === "lote") && positive(a.bedrooms))
    warn({ code: "bedrooms_on_land", field: "bedrooms", severity: "warning", message: "Terreno con dormitorios cargados", valueA: String(a.bedrooms) });

  // Ubicación jerárquica
  const locations: NormalizedLocation[] = [];
  for (const [level, z] of [[1, a.zp_1], [2, a.zp_2], [3, a.zp_3]] as const) {
    if (!z?.name?.trim()) continue;
    locations.push({ externalId: String(z.id), kind: zoneKind(level, z.category), name: z.name.trim(), slug: slugify(z.name) || `zona-${z.id}` });
  }
  if (!locations.some((l) => l.kind === "locality")) warn({ code: "missing_locality", field: "location_id", severity: "error", message: "Sin localidad" });

  let latitude = typeof a.latitude === "number" && a.latitude !== 0 ? a.latitude : null;
  let longitude = typeof a.longitude === "number" && a.longitude !== 0 ? a.longitude : null;
  if (latitude === null || longitude === null) {
    warn({ code: "missing_coordinates", field: "latitude", severity: "warning", message: "Sin coordenadas: no se mostrará mapa" });
    latitude = longitude = null;
  } else if (latitude < AR_BOUNDS.latMin || latitude > AR_BOUNDS.latMax || longitude < AR_BOUNDS.lngMin || longitude > AR_BOUNDS.lngMax) {
    warn({ code: "coordinates_outside_argentina", field: "latitude", severity: "error", message: "Coordenadas fuera de Argentina", valueA: `${latitude},${longitude}` });
    latitude = longitude = null;
  } else if (locations[0]?.name.toLowerCase() === "salta" && (latitude < SALTA_BOUNDS.latMin || latitude > SALTA_BOUNDS.latMax || longitude < SALTA_BOUNDS.lngMin || longitude > SALTA_BOUNDS.lngMax)) {
    warn({ code: "coordinates_outside_province", field: "latitude", severity: "warning", message: "Coordenadas fuera de la provincia indicada (Salta)", valueA: `${latitude},${longitude}` });
  }

  const street = nonEmpty(a.address?.street);
  if (!street) warn({ code: "missing_address", field: "address_street", severity: "warning", message: "Sin calle" });

  const featureGroups: Array<[typeof a.services, NormalizedProperty["features"][number]["grp"]]> = [
    [a.services, "service"],
    [a.others, "amenity"],
    [a.ambients, "ambient"],
    [a.buildingServices, "building_service"],
    [a.buildingOthers, "building_amenity"],
  ];
  const features = new Map<string, NormalizedProperty["features"][number]>();
  for (const [list, grp] of featureGroups) {
    for (const f of list ?? []) {
      if (!f.name?.trim()) continue;
      const key = slugify(f.name).replace(/-/g, "_").slice(0, 80);
      if (key.length >= 2 && !features.has(key)) features.set(key, { key, name: f.name.trim(), grp });
    }
  }

  const MEDIA_KIND: Record<number, NormalizedProperty["media"][number]["kind"]> = { 1: "image", 2: "video", 3: "floor_plan" };
  const media: NormalizedProperty["media"] = [];
  for (const [i, m] of a.multimedia.entries()) {
    const kind = MEDIA_KIND[m.multimediaTypeId];
    if (!kind || !/^[\w/.-]+$/.test(m.src)) {
      warn({ code: "unsupported_media", field: "media", severity: "info", message: `Multimedia no soportada (tipo ${m.multimediaTypeId})`, valueA: m.src });
      continue;
    }
    media.push({ sourceUrl: m.src.startsWith("http") ? m.src : `${ADINCO_MEDIA_BASE}${m.src}`, kind, sortOrder: i, isCover: media.length === 0 && kind === "image" });
  }
  if (!media.some((m) => m.kind === "image")) warn({ code: "missing_images", field: "media", severity: "error", message: "Sin fotos" });
  else if (media.filter((m) => m.kind === "image").length < 3) warn({ code: "few_images", field: "media", severity: "info", message: "Menos de 3 fotos" });

  const attributes: Record<string, string | number | boolean> = {};
  if (typeKey === "casa" && positive(a.flats)) attributes.floors = a.flats!;
  if (isDevelopment && a.possessionDate && /^\d{4}-\d{2}-\d{2}/.test(a.possessionDate)) attributes.possession_date = a.possessionDate.slice(0, 10);
  if ((typeKey === "campo" || (typeKey === "terreno" && a.totalAreaUnit === 2)) && positive(a.totalArea) && a.totalAreaUnit === 2) attributes.hectares = a.totalArea!;

  const garages = positive(a.garages) ?? (positive(a.coveredGarages) ?? 0) + (positive(a.semiCoveredGarages) ?? 0);
  const locality = locations.find((l) => l.kind === "locality")?.slug ?? locations[0]?.slug ?? "salta";
  const status = a.statusId === 2 ? "reserved" : "available";
  if (a.statusId !== 1 && a.statusId !== 2) warn({ code: "unknown_status", field: "status", severity: "warning", message: `Estado de origen ${a.statusId}: importado como disponible` });

  return {
    property: {
      externalId: String(a.id),
      code: a.code,
      slug: `${slugify(`${a.type} ${a.operation} ${locality}`)}-${a.code}`.slice(0, 160),
      title,
      description,
      typeKey,
      status,
      operation,
      currency: currency ?? "USD",
      amount,
      priceHidden: priceHidden || amount === null,
      expensesAmount: positive(a.expenses),
      locations,
      addressStreet: street,
      addressNumber: nonEmpty(a.address?.number),
      addressFloor: nonEmpty(a.address?.floor),
      addressUnit: nonEmpty(a.address?.apartment),
      // Privacidad por defecto: el sitio muestra calle sin altura exacta salvo decisión explícita.
      hideExactAddress: true,
      latitude,
      longitude,
      totalAreaM2: total,
      coveredAreaM2: covered,
      landAreaM2: land,
      rooms: positive(a.rooms),
      bedrooms: typeof a.bedrooms === "number" && a.bedrooms >= 0 ? a.bedrooms : null,
      bathrooms: positive(a.bathrooms),
      garages: garages || null,
      ageYears: typeof a.old === "number" && a.old >= 0 && a.old < 500 ? a.old : null,
      creditEligible: a.aptoCredito ?? null,
      professionalUse: a.professional == null ? null : a.professional === 1,
      allowsPets: a.allowsPets ?? null,
      attributes,
      features: [...features.values()],
      media,
      sellerExternalId: a.noteSellerId ? String(a.noteSellerId) : a.sellerId ? String(a.sellerId) : null,
      officeExternalId: a.officeId ? String(a.officeId) : null,
      redirectPath: `/luciolopez-${a.code}`,
    },
    warnings,
  };
}

export function hasBlockingWarning(warnings: MigrationWarning[]): boolean {
  return warnings.some((w) => w.severity === "error");
}
