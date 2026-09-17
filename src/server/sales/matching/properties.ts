/** Propiedades en el formato del motor de coincidencias (columnas explícitas, organización, sin demo). */
import "server-only";
import { sql, type Executor } from "../../db";
import type { MatchProperty } from "./score";

type LocRow = { id: string; parent_id: string | null; kind: string; name: string; slug: string };

async function locationResolver(db: Executor) {
  const rows = await db.selectFrom("locations").select(["id", "parent_id", "kind", "name", "slug"]).execute();
  const byId = new Map<string, LocRow>(rows.map((r) => [r.id, r]));
  return (id: string | null) => {
    let cur = id ? byId.get(id) : undefined;
    let locality: LocRow | null = null;
    let area: LocRow | null = null;
    for (let guard = 0; cur && guard < 10; guard++) {
      if (cur.kind === "locality" && !locality) locality = cur;
      else if (["neighborhood", "gated_community", "zone"].includes(cur.kind) && !area) area = cur;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    if (area && locality && area.name.localeCompare(locality.name, "es", { sensitivity: "base" }) === 0) area = null;
    return { localitySlug: locality?.slug ?? null, areaSlug: area?.slug ?? null, label: area && locality ? `${area.name}, ${locality.name}` : (area?.name ?? locality?.name ?? null) };
  };
}

type PropertyRow = {
  id: string;
  code: number;
  title: string;
  slug: string;
  is_published: boolean;
  status: string;
  type_key: string;
  type_name: string;
  location_id: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  surface: string | null;
  operations: Array<{ operation: string; currency: string; amount: string | number | null; price_hidden: boolean }> | null;
  features: string[] | null;
};

export async function loadMatchProperties(db: Executor, organizationId: string, where: { ids?: string[]; availableOnly?: boolean }): Promise<Array<MatchProperty & { title: string; slug: string }>> {
  if (where.ids && !where.ids.length) return [];
  const conds = [sql`p.organization_id = ${organizationId}`, sql`p.deleted_at is null`, sql`not p.is_demo`];
  if (where.ids) conds.push(sql`p.id = any(${where.ids}::uuid[])`);
  if (where.availableOnly) conds.push(sql`p.is_published and p.status = 'available'`);
  const r = await sql<PropertyRow>`
    select p.id, p.code, p.title, p.slug, p.is_published, p.status, p.type_key, t.name as type_name, p.location_id,
      p.bedrooms, p.bathrooms, coalesce(p.total_area_m2, p.land_area_m2, p.covered_area_m2)::text as surface,
      (select jsonb_agg(jsonb_build_object('operation', o.operation, 'currency', o.currency, 'amount', o.amount, 'price_hidden', o.price_hidden))
         from property_operations o where o.property_id = p.id and o.is_active) as operations,
      (select array_agg(fe.key) from property_features pf join features fe on fe.id = pf.feature_id where pf.property_id = p.id) as features
    from properties p join property_types t on t.key = p.type_key
    where ${sql.join(conds, sql` and `)}`.execute(db);
  const zone = await locationResolver(db);
  return r.rows.map((row) => {
    const z = zone(row.location_id);
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      slug: row.slug,
      published: row.is_published,
      status: row.status,
      typeKey: row.type_key,
      typeName: row.type_name,
      localitySlug: z.localitySlug,
      areaSlug: z.areaSlug,
      zoneLabel: z.label,
      operations: (row.operations ?? []).map((o) => ({ operation: o.operation, currency: o.currency === "ARS" ? "ARS" : "USD", amount: o.amount === null ? null : Number(o.amount), priceHidden: o.price_hidden })),
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      surfaceM2: row.surface === null ? null : Number(row.surface),
      featureKeys: row.features ?? [],
    };
  });
}

export async function featureNames(db: Executor): Promise<Map<string, string>> {
  const rows = await db.selectFrom("features").select(["key", "name"]).execute();
  return new Map(rows.map((r) => [r.key, r.name]));
}


export async function loadMatchPropertiesByIds(db: Executor, organizationId: string, ids: string[]) {
  return loadMatchProperties(db, organizationId, { ids });
}
