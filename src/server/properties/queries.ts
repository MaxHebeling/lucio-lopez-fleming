/**
 * Lecturas de propiedades para el CRM. Columnas explícitas, paginación en el servidor y subconsultas agregadas
 * (sin N+1). Los datos privados (propietarios) solo se devuelven con `properties.read_private`.
 */
import { z } from "zod";
import { parseInput } from "../validate";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { sql, type Database, type Executor } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { likePattern, pageWindow, toPage, type Page } from "../pagination";
import { CURRENCIES, OPERATIONS, PROPERTY_STATUSES, type FieldSchemaEntry } from "./schema";
import { publishBlockers } from "./service";

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const PROPERTY_SORTS = ["updated_desc", "created_desc", "code_desc", "code_asc", "title_asc", "price_asc", "price_desc"] as const;
export type PropertySort = (typeof PROPERTY_SORTS)[number];

export const propertyListFiltersSchema = z.object({
  q: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  status: z.preprocess(emptyToUndef, z.enum(PROPERTY_STATUSES).optional()),
  published: z.preprocess(emptyToUndef, z.enum(["yes", "no"]).optional()),
  typeKey: z.preprocess(emptyToUndef, z.string().regex(/^[a-z_]{2,40}$/).optional()),
  operation: z.preprocess(emptyToUndef, z.enum(OPERATIONS).optional()),
  currency: z.preprocess(emptyToUndef, z.enum(CURRENCIES).optional()),
  priceMin: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(1e12).optional()),
  priceMax: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(1e12).optional()),
  branchId: z.preprocess(emptyToUndef, z.uuid().optional()),
  agentId: z.preprocess(emptyToUndef, z.uuid().optional()),
  sort: z.preprocess(emptyToUndef, z.enum(PROPERTY_SORTS).optional()),
  page: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(100_000).optional()),
  pageSize: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(100).optional()),
});
export type PropertyListFilters = z.infer<typeof propertyListFiltersSchema>;

/** Filtros desde searchParams: lo inválido se ignora (una URL editada a mano no rompe la página). */
export function parsePropertyFilters(raw: Record<string, string | string[] | undefined>): PropertyListFilters {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(propertyListFiltersSchema.shape)) {
    const v = raw[key];
    const value = Array.isArray(v) ? v[0] : v;
    const one = propertyListFiltersSchema.shape[key as keyof typeof propertyListFiltersSchema.shape].safeParse(value);
    if (one.success && one.data !== undefined) out[key] = one.data;
  }
  return out as PropertyListFilters;
}

export type PropertyListItem = {
  id: string;
  code: number;
  title: string;
  status: string;
  is_published: boolean;
  type_name: string;
  branch_name: string | null;
  location_name: string | null;
  address_street: string | null;
  address_number: string | null;
  updated_at: Date;
  cover: { file_id: string | null; source_url: string | null; file_storage_driver: string | null; file_storage_key: string | null; file_visibility: string | null } | null;
  lead_agent_name: string | null;
  operations: Array<{ operation: string; currency: string; amount: string | number | null; price_hidden: boolean }>;
};

export async function listProperties(db: Database, actor: Actor, raw: PropertyListFilters): Promise<Page<PropertyListItem>> {
  requirePermission(actor, "properties.read");
  const f = parseInput(propertyListFiltersSchema, raw);
  const win = pageWindow(f.page, f.pageSize, 25);

  let q = db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .leftJoin("branches as b", "b.id", "p.branch_id")
    .leftJoin("locations as l", "l.id", "p.location_id")
    .where("p.deleted_at", "is", null);

  if (f.q) {
    const digits = f.q.replace(/^#/, "");
    const pattern = likePattern(f.q.toLowerCase());
    q = q.where((eb) =>
      eb.or([
        ...(/^\d{1,9}$/.test(digits) ? [eb("p.code", "=", Number(digits))] : []),
        eb(sql`f_unaccent(lower(p.title || ' ' || coalesce(p.address_street, '') || ' ' || coalesce(p.description, '')))`, "like", sql`f_unaccent(${pattern})`),
        eb(sql`f_unaccent(lower(coalesce(p.address_street, '') || ' ' || coalesce(p.address_number, '')))`, "like", sql`f_unaccent(${pattern})`),
      ]),
    );
  }
  if (f.status) q = q.where("p.status", "=", f.status);
  else q = q.where("p.status", "<>", "archived");
  if (f.published) q = q.where("p.is_published", "=", f.published === "yes");
  if (f.typeKey) q = q.where("p.type_key", "=", f.typeKey);
  if (f.branchId) q = q.where("p.branch_id", "=", f.branchId);
  if (f.agentId) {
    const agentId = f.agentId;
    q = q.where((eb) => eb.exists(eb.selectFrom("property_agents as pa").select("pa.property_id").whereRef("pa.property_id", "=", "p.id").where("pa.user_id", "=", agentId)));
  }
  if (f.operation || f.priceMin !== undefined || f.priceMax !== undefined || f.currency) {
    q = q.where((eb) => {
      let sub = eb.selectFrom("property_operations as po").select("po.id").whereRef("po.property_id", "=", "p.id").where("po.is_active", "=", true);
      if (f.operation) sub = sub.where("po.operation", "=", f.operation);
      if (f.currency) sub = sub.where("po.currency", "=", f.currency);
      if (f.priceMin !== undefined) sub = sub.where("po.amount", ">=", String(f.priceMin));
      if (f.priceMax !== undefined) sub = sub.where("po.amount", "<=", String(f.priceMax));
      return eb.exists(sub);
    });
  }

  const totalRow = await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst();
  const total = totalRow?.n ?? 0;

  const priceExpr = sql`(select min(po.amount) from property_operations po where po.property_id = p.id and po.is_active
      and po.currency = ${f.currency ?? "USD"} ${f.operation ? sql`and po.operation = ${f.operation}` : sql``})`;
  let ordered = q.select([
    "p.id",
    "p.code",
    "p.title",
    "p.status",
    "p.is_published",
    "t.name as type_name",
    "b.name as branch_name",
    "l.name as location_name",
    "p.address_street",
    "p.address_number",
    "p.updated_at",
    sql<PropertyListItem["cover"]>`(select jsonb_build_object('file_id', pm.file_id, 'source_url', pm.source_url, 'file_storage_driver', f.storage_driver, 'file_storage_key', f.storage_key, 'file_visibility', f.visibility)
      from property_media pm left join files f on f.id = pm.file_id and f.deleted_at is null
      where pm.property_id = p.id and pm.deleted_at is null and pm.kind = 'image' order by pm.is_cover desc, pm.sort_order, pm.created_at limit 1)`.as("cover"),
    sql<string | null>`(select u.full_name from property_agents pa join users u on u.id = pa.user_id where pa.property_id = p.id and pa.role = 'lead' limit 1)`.as("lead_agent_name"),
    (eb) =>
      jsonArrayFrom(
        eb
          .selectFrom("property_operations as po")
          .select(["po.operation", "po.currency", "po.amount", "po.price_hidden"])
          .whereRef("po.property_id", "=", "p.id")
          .where("po.is_active", "=", true)
          .orderBy(sql`array_position(array['sale','rent','temporary_rent'], po.operation)`),
      ).as("operations"),
  ]);
  switch (f.sort ?? "updated_desc") {
    case "created_desc":
      ordered = ordered.orderBy("p.created_at", "desc");
      break;
    case "code_desc":
      ordered = ordered.orderBy("p.code", "desc");
      break;
    case "code_asc":
      ordered = ordered.orderBy("p.code", "asc");
      break;
    case "title_asc":
      ordered = ordered.orderBy(sql`f_unaccent(lower(p.title))`, "asc");
      break;
    case "price_asc":
      ordered = ordered.orderBy(sql`${priceExpr} asc nulls last`);
      break;
    case "price_desc":
      ordered = ordered.orderBy(sql`${priceExpr} desc nulls last`);
      break;
    default:
      ordered = ordered.orderBy("p.updated_at", "desc");
  }
  const items = await ordered.orderBy("p.id").limit(win.limit).offset(win.offset).execute();
  return toPage(items as PropertyListItem[], total, win);
}

export type LocationNode = { id: string; parent_id: string | null; kind: string; name: string };

/** Cadena de ubicación desde la raíz hasta `id` (provincia → localidad → barrio). */
export async function locationChain(db: Executor, id: string | null): Promise<LocationNode[]> {
  if (!id) return [];
  const r = await sql<LocationNode & { depth: number }>`
    with recursive chain as (
      select id, parent_id, kind, name, 0 as depth from locations where id = ${id}
      union all
      select l.id, l.parent_id, l.kind, l.name, c.depth + 1 from locations l join chain c on l.id = c.parent_id where c.depth < 10
    )
    select id, parent_id, kind, name, depth from chain order by depth desc`.execute(db);
  return r.rows.map(({ id: i, parent_id, kind, name }) => ({ id: i, parent_id, kind, name }));
}

export async function listLocationChildren(db: Database, actor: Actor, parentId: string | null): Promise<LocationNode[]> {
  requirePermission(actor, "properties.read");
  let q = db.selectFrom("locations").select(["id", "parent_id", "kind", "name"]);
  // Raíz del selector: provincias (cuelguen o no de un país).
  q = parentId ? q.where("parent_id", "=", parentId) : q.where("kind", "=", "province");
  return q.orderBy(sql`f_unaccent(lower(name))`).limit(500).execute();
}

export type PropertyFormOptions = {
  types: Array<{ key: string; name: string; field_schema: FieldSchemaEntry[] }>;
  branches: Array<{ id: string; name: string }>;
  features: Array<{ key: string; name: string; grp: string }>;
  staff: Array<{ id: string; full_name: string }>;
  provinces: LocationNode[];
};

export async function propertyFormOptions(db: Database, actor: Actor): Promise<PropertyFormOptions> {
  requirePermission(actor, "properties.read");
  const [types, branches, features, staff, provinces] = await Promise.all([
    db.selectFrom("property_types").select(["key", "name", "field_schema"]).where("is_active", "=", true).orderBy("sort_order").execute(),
    db.selectFrom("branches").select(["id", "name"]).where("is_active", "=", true).orderBy("is_main", "desc").orderBy("name").execute(),
    db.selectFrom("features").select(["key", "name", "grp"]).orderBy("grp").orderBy("sort_order").orderBy("name").execute(),
    db.selectFrom("users").select(["id", "full_name"]).where("kind", "=", "staff").where("is_active", "=", true).where("deleted_at", "is", null).orderBy("full_name").execute(),
    listLocationChildren(db, actor, null),
  ]);
  return { types: types.map((t) => ({ ...t, field_schema: (t.field_schema ?? []) as FieldSchemaEntry[] })), branches, features, staff, provinces };
}

export async function getPropertyDetail(db: Database, actor: Actor, id: string) {
  requirePermission(actor, "properties.read");
  if (!z.uuid().safeParse(id).success) throw notFound("Propiedad");
  const p = await db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .leftJoin("branches as b", "b.id", "p.branch_id")
    .leftJoin("users as vu", "vu.id", "p.manually_verified_by")
    .select([
      "p.id", "p.code", "p.slug", "p.title", "p.description", "p.type_key", "t.name as type_name", "t.field_schema", "p.status",
      "p.is_published", "p.published_at", "p.featured", "p.branch_id", "b.name as branch_name", "p.location_id", "p.address_street",
      "p.address_number", "p.address_floor", "p.address_unit", "p.hide_exact_address", "p.latitude", "p.longitude", "p.total_area_m2",
      "p.covered_area_m2", "p.uncovered_area_m2", "p.land_area_m2", "p.rooms", "p.bedrooms", "p.bathrooms", "p.toilets", "p.garages",
      "p.age_years", "p.orientation", "p.disposition", "p.condition", "p.credit_eligible", "p.professional_use", "p.allows_pets",
      "p.attributes", "p.seo_title", "p.seo_description", "p.source", "p.imported_at", "p.last_synced_at", "p.manually_verified_at",
      "vu.full_name as verified_by_name", "p.protected_fields", "p.created_at", "p.updated_at", "p.archived_at",
    ])
    .where("p.id", "=", id)
    .where("p.deleted_at", "is", null)
    .executeTakeFirst();
  if (!p) throw notFound("Propiedad");

  const canPrivate = can(actor, "properties.read_private");
  const leadsScope = can(actor, "leads.read_all") ? "all" : can(actor, "leads.read_own") ? "own" : null;

  const [operations, priceHistory, statusHistory, media, features, agents, publications, location, blockers, owners, leads, auditRows] = await Promise.all([
    db.selectFrom("property_operations").select(["id", "operation", "currency", "amount", "price_hidden", "expenses_amount", "expenses_currency", "is_active"]).where("property_id", "=", id).orderBy(sql`array_position(array['sale','rent','temporary_rent'], operation)`).execute(),
    db.selectFrom("property_price_history as h").leftJoin("users as u", "u.id", "h.changed_by").select(["h.id", "h.operation", "h.previous_currency", "h.previous_amount", "h.new_currency", "h.new_amount", "h.source", "h.reason", "h.changed_at", "u.full_name as changed_by_name"]).where("h.property_id", "=", id).orderBy("h.changed_at", "desc").orderBy("h.id", "desc").limit(50).execute(),
    db.selectFrom("property_status_history as h").leftJoin("users as u", "u.id", "h.changed_by").select(["h.id", "h.from_status", "h.to_status", "h.reason", "h.changed_at", "u.full_name as changed_by_name"]).where("h.property_id", "=", id).orderBy("h.changed_at", "desc").orderBy("h.id", "desc").limit(50).execute(),
    db
      .selectFrom("property_media as m")
      .leftJoin("files as f", (j) => j.onRef("f.id", "=", "m.file_id").on("f.deleted_at", "is", null))
      .select(["m.id", "m.kind", "m.file_id", "m.original_file_id", "m.source_url", "m.sort_order", "m.is_cover", "m.alt_text", "m.width", "m.height", "m.status", "m.last_error", "f.storage_driver as file_storage_driver", "f.storage_key as file_storage_key", "f.visibility as file_visibility"])
      .where("m.property_id", "=", id)
      .where("m.deleted_at", "is", null)
      .orderBy("m.sort_order")
      .orderBy("m.created_at")
      .execute(),
    db.selectFrom("property_features as pf").innerJoin("features as f", "f.id", "pf.feature_id").select(["f.key", "f.name", "f.grp"]).where("pf.property_id", "=", id).orderBy("f.grp").orderBy("f.sort_order").execute(),
    db.selectFrom("property_agents as pa").innerJoin("users as u", "u.id", "pa.user_id").select(["pa.user_id", "pa.role", "u.full_name", "u.is_active"]).where("pa.property_id", "=", id).orderBy(sql`pa.role = 'lead'`, "desc").orderBy("u.full_name").execute(),
    db.selectFrom("publication_channels as c").leftJoin("property_publications as pp", (j) => j.onRef("pp.channel_key", "=", "c.key").on("pp.property_id", "=", id)).select(["c.key", "c.name", "c.kind", "c.is_enabled", "pp.desired_state", "pp.sync_status", "pp.external_url", "pp.last_synced_at", "pp.last_attempt_at", "pp.last_error", "pp.attempts"]).orderBy(sql`array_position(array['web','portal','social'], c.kind)`).orderBy("c.name").execute(),
    locationChain(db, p.location_id),
    publishBlockers(db, id),
    canPrivate
      ? db
          .selectFrom("property_owners as po")
          .innerJoin("contacts as c", "c.id", "po.contact_id")
          .select(["po.contact_id", "po.share_pct", "po.is_primary", "c.display_name", sql<string | null>`(select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1)`.as("email"), sql<string | null>`(select coalesce(cp.phone_e164, cp.phone_raw) from contact_phones cp where cp.contact_id = c.id order by cp.is_primary desc, cp.created_at limit 1)`.as("phone")])
          .where("po.property_id", "=", id)
          .orderBy("po.is_primary", "desc")
          .orderBy("c.display_name")
          .execute()
      : Promise.resolve(null),
    leadsScope
      ? (() => {
          let lq = db
            .selectFrom("leads as ld")
            .innerJoin("contacts as c", "c.id", "ld.contact_id")
            .leftJoin("users as u", "u.id", "ld.assigned_user_id")
            .leftJoin("lead_sources as s", "s.key", "ld.source_key")
            .select(["ld.id", "ld.status", "ld.priority", "ld.created_at", "ld.first_response_at", "c.display_name as contact_name", "u.full_name as assigned_name", "s.name as source_name"])
            .where("ld.property_id", "=", id)
            .where("ld.deleted_at", "is", null);
          if (leadsScope === "own" && actor.kind === "staff") lq = lq.where("ld.assigned_user_id", "=", actor.userId);
          return lq.orderBy("ld.created_at", "desc").limit(20).execute();
        })()
      : Promise.resolve(null),
    can(actor, "audit.read")
      ? db.selectFrom("audit_logs as a").leftJoin("users as u", "u.id", "a.actor_user_id").select(["a.id", "a.occurred_at", "a.action", "a.actor_kind", "u.full_name as actor_name", "a.before", "a.after", "a.metadata"]).where("a.entity_type", "=", "property").where("a.entity_id", "=", id).orderBy("a.occurred_at", "desc").orderBy("a.id", "desc").limit(50).execute()
      : Promise.resolve(null),
  ]);

  return {
    property: { ...p, field_schema: (p.field_schema ?? []) as FieldSchemaEntry[], attributes: (p.attributes ?? {}) as Record<string, string | number | boolean | null> },
    operations,
    priceHistory,
    statusHistory,
    media,
    features,
    agents,
    publications,
    location,
    blockers,
    owners,
    leads,
    audit: auditRows,
  };
}
export type PropertyDetail = Awaited<ReturnType<typeof getPropertyDetail>>;

/** Buscador de contactos para asignar propietarios (dato privado de la propiedad). */
export async function searchOwnerCandidates(db: Database, actor: Actor, raw: string): Promise<Array<{ id: string; display_name: string; email: string | null }>> {
  requirePermission(actor, "properties.read_private");
  const q = raw.trim().slice(0, 120);
  if (q.length < 2) return [];
  const pattern = likePattern(q.toLowerCase());
  const digits = q.replace(/\D/g, "");
  return db
    .selectFrom("contacts as c")
    .select(["c.id", "c.display_name", sql<string | null>`(select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1)`.as("email")])
    .where("c.deleted_at", "is", null)
    .where("c.merged_into_id", "is", null)
    .where((eb) =>
      eb.or([
        eb(sql`f_unaccent(lower(c.display_name))`, "like", sql`f_unaccent(${pattern})`),
        eb.exists(eb.selectFrom("contact_emails as ce").select("ce.id").whereRef("ce.contact_id", "=", "c.id").where("ce.email_normalized", "like", pattern)),
        ...(digits.length >= 6 ? [eb.exists(eb.selectFrom("contact_phones as cp").select("cp.id").whereRef("cp.contact_id", "=", "c.id").where(sql`regexp_replace(coalesce(cp.phone_e164, cp.phone_raw), '\\D', '', 'g')`, "like", `%${digits}%`))] : []),
      ]),
    )
    .orderBy(sql`f_unaccent(lower(c.display_name))`)
    .limit(10)
    .execute();
}
