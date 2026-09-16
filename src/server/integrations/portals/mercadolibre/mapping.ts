/**
 * Mapeo PURO propiedad → aviso de Mercado Libre Inmuebles (Argentina, site MLA).
 * Fuente: developers.mercadolibre.com.ar (guía de inmuebles: Categorías, Atributos, Publica Inmuebles,
 * Actualiza tus publicaciones; consultadas 2026-09).
 *
 * Categorías: Inmuebles (MLA1459) → tipo (p. ej. Casas MLA1466) → operación (Venta/Alquiler/Alquiler Temporario)
 * → subtipo (p. ej. "Propiedades Individuales"). Acá se fija el TIPO (IDs públicos del árbol MLA); la operación y
 * el subtipo se resuelven en runtime contra GET /categories/{id} (sin inventar IDs).
 * Atributos obligatorios varían por categoría final: se validan en runtime contra GET /categories/{id}/attributes.
 */
import type { PortalPrepared, PortalProperty } from "../types";
import { orderedPhotos, primaryOperation } from "../types";

/** Tipo interno → categoría de tipo de inmueble en MLA (árbol público de /categories/MLA1459). */
export const ML_TYPE_CATEGORY: Record<string, { categoryId: string; name: string } | null> = {
  casa: { categoryId: "MLA1466", name: "Casas" },
  departamento: { categoryId: "MLA1472", name: "Departamentos" },
  ph: { categoryId: "MLA105179", name: "PH" },
  terreno: { categoryId: "MLA1493", name: "Terrenos y Lotes" },
  lote: { categoryId: "MLA1493", name: "Terrenos y Lotes" },
  local: { categoryId: "MLA79242", name: "Locales" },
  oficina: { categoryId: "MLA50538", name: "Oficinas" },
  deposito: { categoryId: "MLA1475", name: "Depósitos y Galpones" },
  galpon: { categoryId: "MLA1475", name: "Depósitos y Galpones" },
  campo: { categoryId: "MLA1496", name: "Campos" },
  cochera: { categoryId: "MLA50541", name: "Cocheras" },
  hotel: { categoryId: "MLA1892", name: "Otros Inmuebles" },
  negocio_especial: { categoryId: "MLA1892", name: "Otros Inmuebles" },
  otro: { categoryId: "MLA1892", name: "Otros Inmuebles" },
  // Emprendimientos: Mercado Libre exige paquetes y permisos específicos de desarrollos inmobiliarios.
  emprendimiento: null,
};

/** Nombre de la subcategoría de operación en el árbol MLA. */
export const ML_OPERATION_NAME = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler Temporario" } as const;
/** Subtipo para propiedades usadas/individuales (no emprendimientos). */
export const ML_INDIVIDUAL_SUBTYPE = "Propiedades Individuales";

export type MercadoLibreConfig = {
  listingTypeId: string;
  /** WhatsApp E.164 argentino (obligatorio en seller_contact desde 2026-10-01). */
  whatsappE164: string;
};

export type MlAttribute = { id: string; value_name: string };

export type MercadoLibreItemDraft = {
  typeCategoryId: string;
  operationName: string;
  item: {
    title: string;
    price: number;
    currency_id: "USD" | "ARS";
    available_quantity: 1;
    buying_mode: "classified";
    condition: "not_specified";
    listing_type_id: string;
    channels: ["marketplace"];
    description: { plain_text: string };
    pictures: Array<{ source: string }>;
    attributes: MlAttribute[];
    location: {
      address_line: string;
      latitude?: number;
      longitude?: number;
      neighborhood?: { id: string };
      city?: { id: string };
    };
    seller_contact: {
      contact: string;
      other_info: string;
      country_code: string;
      area_code: string;
      phone: string;
      country_code2: string;
      phone2: string;
      email: string;
      webpage: string;
    };
  };
};

const MAX_PICTURES = 30; // settings.max_pictures_per_item de MLA1459
const MAX_TITLE = 200; // settings.max_title_length de MLA1459
const MAX_DESCRIPTION = 50_000;

export function splitArgentineWhatsApp(e164: string): { countryCode: string; number: string } | null {
  const m = /^\+54(\d{8,12})$/.exec(e164.replace(/[\s-]/g, ""));
  return m ? { countryCode: "54", number: m[1]! } : null;
}

const fmtArea = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100} m²`;

export function mapToMercadoLibre(p: PortalProperty, cfg: MercadoLibreConfig): PortalPrepared<MercadoLibreItemDraft> {
  const errors: string[] = [];
  const type = ML_TYPE_CATEGORY[p.typeKey];
  if (type === undefined) errors.push(`Tipo "${p.typeName}" sin categoría de Mercado Libre`);
  if (type === null) errors.push("Mercado Libre publica emprendimientos solo con paquetes de desarrollos inmobiliarios: no se sincroniza automáticamente");

  const op = primaryOperation(p);
  if (!op) errors.push("La propiedad no tiene operación activa");
  else if (op.priceHidden || op.amount === null) errors.push("Mercado Libre exige precio: la operación tiene el precio oculto");

  const photos = orderedPhotos(p, MAX_PICTURES);
  if (!photos.length) errors.push("No hay fotos con URL pública (https) para enviar");

  const refs = p.externalLocationRefs.mercadolibre ?? [];
  const neighborhood = refs.find((r) => r.externalType === "neighborhood");
  const city = refs.find((r) => r.externalType === "city");
  if (!neighborhood && !city) errors.push("Falta vincular la ubicación con un barrio o ciudad de Mercado Libre (external_refs source=mercadolibre)");

  const wa = splitArgentineWhatsApp(cfg.whatsappE164);
  if (!wa) errors.push("MERCADOLIBRE_CONTACT_WHATSAPP debe ser un celular argentino en formato E.164 (+54…)");

  if (errors.length || !type || !op || !wa) return { ok: false, errors };

  const attributes: MlAttribute[] = [];
  const add = (id: string, v: string | null) => {
    if (v !== null) attributes.push({ id, value_name: v });
  };
  add("ROOMS", p.rooms !== null ? String(p.rooms) : null);
  add("BEDROOMS", p.bedrooms !== null ? String(p.bedrooms) : null);
  add("FULL_BATHROOMS", p.bathrooms !== null ? String(p.bathrooms) : null);
  add("PARKING_LOTS", p.garages !== null ? String(p.garages) : null);
  add("COVERED_AREA", p.areas.coveredM2 !== null ? fmtArea(p.areas.coveredM2) : null);
  const total = p.areas.totalM2 ?? p.areas.landM2;
  add("TOTAL_AREA", total !== null ? fmtArea(total) : null);
  if (op.expensesAmount !== null) add("MAINTENANCE_FEE", `${Math.round(op.expensesAmount)} ${op.expensesCurrency ?? op.currency}`);
  if (p.allowsPets !== null) add("IS_SUITABLE_FOR_PETS", p.allowsPets ? "Sí" : "No");

  const street = [p.address.street, p.address.hideExact ? null : p.address.number].filter(Boolean).join(" ");
  const locality = p.locationChain.find((l) => l.kind === "locality")?.name ?? p.locationChain[0]?.name ?? "";
  const location: MercadoLibreItemDraft["item"]["location"] = {
    address_line: (street || locality).slice(0, 255),
    ...(neighborhood ? { neighborhood: { id: neighborhood.externalId } } : { city: { id: city!.externalId } }),
  };
  // Con dirección oculta no se envían coordenadas exactas.
  if (!p.address.hideExact && p.address.latitude !== null && p.address.longitude !== null) {
    location.latitude = p.address.latitude;
    location.longitude = p.address.longitude;
  }

  const phoneDigits = (p.contact.phone ?? "").replace(/\D/g, "");
  const description = [p.description?.trim() || p.title, "", `Código de referencia: ${p.code}`, `Más información: ${p.publicUrl}`].join("\n").slice(0, MAX_DESCRIPTION);

  return {
    ok: true,
    payload: {
      typeCategoryId: type.categoryId,
      operationName: ML_OPERATION_NAME[op.operation],
      item: {
        title: p.title.slice(0, MAX_TITLE),
        price: op.amount!,
        currency_id: op.currency,
        available_quantity: 1,
        buying_mode: "classified",
        condition: "not_specified",
        listing_type_id: cfg.listingTypeId,
        channels: ["marketplace"],
        description: { plain_text: description },
        pictures: photos.map((ph) => ({ source: ph.url })),
        attributes,
        location,
        seller_contact: {
          contact: p.contact.name,
          other_info: `Código ${p.code}`,
          country_code: phoneDigits.startsWith("54") ? "54" : "",
          area_code: "",
          phone: phoneDigits.startsWith("54") ? phoneDigits.slice(2) : phoneDigits,
          country_code2: wa.countryCode,
          phone2: wa.number,
          email: p.contact.email ?? "",
          webpage: "",
        },
      },
    },
  };
}

/** Normaliza nombres para comparar categorías y valores de atributos ("Alquiler Temporario" ≈ "alquiler temporario"). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type MlCategory = { id: string; name: string; children_categories?: Array<{ id: string; name: string }> };
export type MlAttributeDef = { id: string; name: string; tags?: Record<string, unknown>; value_type?: string; values?: Array<{ id: string; name: string }> };

/** Atributos requeridos por la categoría que el aviso no trae (para informar con nombres legibles). */
export function missingRequiredAttributes(defs: MlAttributeDef[], attributes: MlAttribute[]): MlAttributeDef[] {
  const present = new Set(attributes.map((a) => a.id));
  return defs.filter((d) => d.tags?.required === true && !d.tags?.read_only && !present.has(d.id));
}

/**
 * Completa atributos de lista que la categoría exige y que se derivan sin inventar nada del propio árbol:
 * OPERATION (Venta/Alquiler…), PROPERTY_TYPE (tipo interno) y OPERATION_SUBTYPE (propiedad individual),
 * solo si el valor existe literalmente entre los valores permitidos por Mercado Libre.
 */
export function deriveListAttributes(defs: MlAttributeDef[], draft: MercadoLibreItemDraft, typeName: string): MlAttribute[] {
  const out: MlAttribute[] = [];
  const pick = (id: string, candidates: string[]) => {
    const def = defs.find((d) => d.id === id);
    if (!def?.values?.length || draft.item.attributes.some((a) => a.id === id)) return;
    const match = def.values.find((v) => candidates.some((c) => normalizeName(v.name) === normalizeName(c)));
    if (match) out.push({ id, value_name: match.name });
  };
  pick("OPERATION", [draft.operationName, draft.operationName.replace(/ Temporario$/i, " temporal")]);
  pick("PROPERTY_TYPE", [typeName]);
  pick("OPERATION_SUBTYPE", ["Propiedad individual", "Propiedades individuales"]);
  return out;
}
