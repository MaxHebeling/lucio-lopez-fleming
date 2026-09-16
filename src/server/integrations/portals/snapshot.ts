/** Carga la propiedad en el formato neutral que consumen los adaptadores (solo datos publicables). */
import { createHash } from "node:crypto";
import type { Executor } from "../../db";
import { propertyImages } from "../../media/public-url";
import type { PortalOperation, PortalProperty } from "./types";

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export async function loadPortalProperty(db: Executor, propertyId: string): Promise<PortalProperty | null> {
  const p = await db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .select([
      "p.id", "p.code", "p.slug", "p.title", "p.description", "p.type_key", "t.name as type_name", "p.status", "p.is_published", "p.location_id",
      "p.address_street", "p.address_number", "p.hide_exact_address", "p.latitude", "p.longitude",
      "p.total_area_m2", "p.covered_area_m2", "p.uncovered_area_m2", "p.land_area_m2",
      "p.rooms", "p.bedrooms", "p.bathrooms", "p.toilets", "p.garages", "p.age_years", "p.allows_pets", "p.credit_eligible", "p.branch_id",
    ])
    .where("p.id", "=", propertyId)
    .where("p.deleted_at", "is", null)
    .executeTakeFirst();
  if (!p) return null;

  const ops = await db
    .selectFrom("property_operations")
    .select(["operation", "currency", "amount", "price_hidden", "expenses_amount", "expenses_currency"])
    .where("property_id", "=", propertyId)
    .where("is_active", "=", true)
    .execute();

  const chain: PortalProperty["locationChain"] = [];
  let loc = p.location_id;
  for (let depth = 0; loc && depth < 8; depth++) {
    const l = await db.selectFrom("locations").select(["id", "parent_id", "kind", "name"]).where("id", "=", loc).executeTakeFirst();
    if (!l) break;
    chain.push({ id: l.id, kind: l.kind, name: l.name });
    loc = l.parent_id;
  }

  const refs = chain.length
    ? await db
        .selectFrom("external_refs")
        .select(["source", "external_type", "external_id", "entity_id"])
        .where("entity_type", "=", "location")
        .where("entity_id", "in", chain.map((c) => c.id))
        .execute()
    : [];
  const externalLocationRefs: PortalProperty["externalLocationRefs"] = {};
  // Orden de la cadena: el vínculo más específico primero.
  for (const c of chain) {
    for (const r of refs.filter((x) => x.entity_id === c.id)) {
      (externalLocationRefs[r.source] ??= []).push({ externalType: r.external_type, externalId: r.external_id });
    }
  }

  const features = await db
    .selectFrom("property_features as pf")
    .innerJoin("features as f", "f.id", "pf.feature_id")
    .select("f.name")
    .where("pf.property_id", "=", propertyId)
    .orderBy("f.sort_order")
    .execute();

  const images = await propertyImages(db, propertyId);
  const branch = await db
    .selectFrom("branches")
    .select(["name", "email", "phone"])
    .where((eb) => (p.branch_id ? eb("id", "=", p.branch_id) : eb("is_main", "=", true)))
    .executeTakeFirst();
  const org = await db.selectFrom("organizations").select("name").executeTakeFirst();

  const appUrl = process.env.APP_URL ?? "";
  return {
    id: p.id,
    code: p.code,
    slug: p.slug,
    title: p.title,
    description: p.description,
    typeKey: p.type_key,
    typeName: p.type_name,
    status: p.status,
    isPublished: p.is_published,
    operations: ops.map(
      (o): PortalOperation => ({
        operation: o.operation as PortalOperation["operation"],
        currency: o.currency as PortalOperation["currency"],
        amount: num(o.amount),
        priceHidden: o.price_hidden,
        expensesAmount: num(o.expenses_amount),
        expensesCurrency: (o.expenses_currency as PortalOperation["expensesCurrency"]) ?? null,
      }),
    ),
    locationChain: chain,
    externalLocationRefs,
    address: { street: p.address_street, number: p.address_number, hideExact: p.hide_exact_address, latitude: num(p.latitude), longitude: num(p.longitude) },
    areas: { totalM2: num(p.total_area_m2), coveredM2: num(p.covered_area_m2), uncoveredM2: num(p.uncovered_area_m2), landM2: num(p.land_area_m2) },
    rooms: p.rooms,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    toilets: p.toilets,
    garages: p.garages,
    ageYears: p.age_years,
    allowsPets: p.allows_pets,
    creditEligible: p.credit_eligible,
    features: features.map((f) => f.name),
    photos: images.filter((i) => i.publicUrl).map((i) => ({ mediaId: i.id, url: i.publicUrl!, isCover: i.is_cover })),
    publicUrl: appUrl ? new URL(`/propiedades/${p.slug}`, appUrl).toString() : `/propiedades/${p.slug}`,
    contact: { name: org?.name ?? "Lucio López Fleming", email: branch?.email ?? null, phone: branch?.phone ?? null },
  };
}

/** Hash estable (claves ordenadas) del payload + estado deseado: si no cambió, no se reenvía. */
export function payloadHash(payload: unknown, desiredState: string): string {
  return createHash("sha256").update(`${desiredState}|${stableStringify(payload)}`).digest("hex");
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}
