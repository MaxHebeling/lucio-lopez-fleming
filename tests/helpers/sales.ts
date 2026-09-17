/** Mundo de prueba para la Fase 2 · Ventas: ubicaciones, características y propiedades publicadas reales. */
import type { Database } from "../../src/server/db";
import type { StaffActor } from "../../src/server/auth/actor";
import { changeStatus, createProperty, publishProperty } from "../../src/server/properties/service";
import { resetPublicLocationCache } from "../../src/server/properties/public";
import { resetSalesCatalogCache } from "../../src/server/sales/catalog";
import { resetFlagCache } from "../../src/server/flags";

export const FEATURES = [
  { key: "jardin", name: "Jardín", grp: "amenity" },
  { key: "pileta", name: "Pileta", grp: "amenity" },
  { key: "parrilla", name: "Parrilla", grp: "amenity" },
  { key: "calefaccion", name: "Calefacción", grp: "amenity" },
];

export async function salesCatalog(db: Database) {
  for (const f of FEATURES) await db.insertInto("features").values({ key: f.key, name: f.name, grp: f.grp }).onConflict((oc) => oc.column("key").doNothing()).execute();
  const loc = async (kind: string, name: string, slug: string, parentId: string | null) =>
    (await db.insertInto("locations").values({ kind, name, slug, parent_id: parentId }).onConflict((oc) => oc.doNothing()).returning("id").executeTakeFirst())?.id ??
    (await db.selectFrom("locations").select("id").where("slug", "=", slug).where("kind", "=", kind).executeTakeFirstOrThrow()).id;
  const salta = await loc("locality", "Salta", "salta", null);
  const tresCerritos = await loc("neighborhood", "Tres Cerritos", "tres-cerritos", salta);
  const vsl = await loc("locality", "Villa San Lorenzo", "villa-san-lorenzo", null);
  resetPublicLocationCache();
  resetSalesCatalogCache();
  return { salta, tresCerritos, vsl };
}

let seq = 0;

export type ListedOpts = {
  title?: string;
  typeKey?: string;
  locationId: string;
  amount?: number | null;
  currency?: "USD" | "ARS";
  operation?: "sale" | "rent";
  priceHidden?: boolean;
  bedrooms?: number | null;
  bathrooms?: number | null;
  coveredAreaM2?: number | null;
  landAreaM2?: number | null;
  features?: string[];
  status?: "available" | "reserved";
  publish?: boolean;
  description?: string | null;
  hideExactAddress?: boolean;
  addressStreet?: string | null;
  addressNumber?: string | null;
  creditEligible?: boolean | null;
};

export async function listedProperty(db: Database, admin: StaffActor, o: ListedOpts) {
  seq++;
  const p = await createProperty(db, admin, {
    title: o.title ?? `Casa de prueba ${seq}`,
    typeKey: o.typeKey ?? "casa",
    description: o.description ?? null,
    locationId: o.locationId,
    bedrooms: o.bedrooms ?? null,
    bathrooms: o.bathrooms ?? null,
    coveredAreaM2: o.coveredAreaM2 ?? null,
    landAreaM2: o.landAreaM2 ?? null,
    featureKeys: o.features ?? [],
    hideExactAddress: o.hideExactAddress ?? true,
    addressStreet: o.addressStreet ?? null,
    addressNumber: o.addressNumber ?? null,
    creditEligible: o.creditEligible ?? null,
    operations: [{ operation: o.operation ?? "sale", currency: o.currency ?? "USD", amount: o.amount === undefined ? 175000 : o.amount, priceHidden: o.priceHidden ?? false }],
  } as never);
  await db.insertInto("property_media").values({ property_id: p.id, kind: "image", source_url: `https://static1.adinco.net/test/sales-${seq}.jpg`, status: "verified", is_cover: true, sort_order: 0 }).execute();
  await changeStatus(db, admin, p.id, o.status ?? "available");
  if (o.publish !== false) await publishProperty(db, admin, p.id);
  resetSalesCatalogCache();
  return p;
}

export async function contactIn(db: Database, orgId: string, name: string, assignedUserId: string | null = null) {
  return (await db.insertInto("contacts").values({ organization_id: orgId, display_name: name, kind: "person", assigned_user_id: assignedUserId }).returning("id").executeTakeFirstOrThrow()).id;
}

export function resetSalesCaches() {
  resetFlagCache();
  resetSalesCatalogCache();
  resetPublicLocationCache();
}
