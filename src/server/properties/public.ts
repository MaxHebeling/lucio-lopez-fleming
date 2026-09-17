/**
 * Lecturas públicas de propiedades (sitio web). Reglas:
 * - Solo `is_published` y no borradas. Columnas explícitas: nunca propietarios, documentos, notas,
 *   protected_fields, datos de migración ni teléfonos privados.
 * - Precio oculto → el monto no sale de la base (se anula en SQL).
 * - Dirección: con `hide_exact_address` nunca se expone la altura ni coordenadas exactas.
 * - Fotos: excluye `failed`; portada primero y luego `sort_order`.
 * No requieren actor: son datos que la inmobiliaria publica. Lo que no está publicado no existe para este módulo.
 */
import "server-only";
import { sql, type Executor } from "../db";
import {
  OPERATION_SLUGS,
  PAGE_SIZE,
  headlineDetail,
  propertyHeadline,
  publicCoordinates,
  publicStreet,
  tidyTitle,
  titleAddsInfo,
  type PublicOperation,
  type SearchFilters,
} from "./public-helpers";

// ───────────────────────── Tipos públicos ─────────────────────────

export type PublicPrice = { operation: PublicOperation; currency: "USD" | "ARS"; amount: number | null; priceHidden: boolean; expenses: { amount: number; currency: "USD" | "ARS" } | null };
export type PublicPhoto = { url: string; width: number | null; height: number | null; alt: string };
export type PublicZone = { locality: string | null; localitySlug: string | null; area: string | null; areaSlug: string | null; province: string | null; label: string | null };
export type PublicStatus = "available" | "reserved" | "sold" | "rented";

export type PublicPropertyCard = {
  code: number;
  slug: string;
  headline: string;
  subtitle: string | null;
  typeKey: string;
  typeName: string;
  status: PublicStatus;
  featured: boolean;
  zone: PublicZone;
  prices: PublicPrice[];
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  totalAreaM2: number | null;
  coveredAreaM2: number | null;
  landAreaM2: number | null;
  cover: PublicPhoto | null;
  photoCount: number;
  publishedAt: string | null;
};

export type PublicFeatureGroup = { key: string; label: string; items: string[] };
export type PublicAdvisor = { name: string; whatsappE164: string | null } | null;
export type PublicBranchContact = { name: string; phone: string | null; email: string | null; schedule: string | null; address: string | null } | null;

export type PublicPropertyDetail = PublicPropertyCard & {
  title: string;
  description: string | null;
  street: string | null;
  addressHidden: boolean;
  coordinates: { lat: number; lng: number; approximate: boolean } | null;
  rooms: number | null;
  toilets: number | null;
  uncoveredAreaM2: number | null;
  ageYears: number | null;
  orientation: string | null;
  disposition: string | null;
  condition: string | null;
  creditEligible: boolean | null;
  professionalUse: boolean | null;
  allowsPets: boolean | null;
  attributes: Array<{ label: string; value: string }>;
  features: PublicFeatureGroup[];
  photos: PublicPhoto[];
  advisor: PublicAdvisor;
  branch: PublicBranchContact;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
  locationId: string | null;
  typeCategory: string;
};

// ───────────────────────── Ubicaciones (árbol chico, cache en memoria) ─────────────────────────

type LocationRow = { id: string; parent_id: string | null; kind: string; name: string; slug: string };
type LocationIndex = { byId: Map<string, LocationRow>; children: Map<string, LocationRow[]> };
let locCache: { at: number; idx: LocationIndex } | undefined;
const LOC_TTL_MS = 60_000;

async function locationIndex(db: Executor): Promise<LocationIndex> {
  if (locCache && Date.now() - locCache.at < LOC_TTL_MS) return locCache.idx;
  const rows = await db.selectFrom("locations").select(["id", "parent_id", "kind", "name", "slug"]).execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, LocationRow[]>();
  for (const r of rows) if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  locCache = { at: Date.now(), idx: { byId, children } };
  return locCache.idx;
}

export function resetPublicLocationCache(): void {
  locCache = undefined;
}

function zoneOf(idx: LocationIndex, locationId: string | null): PublicZone {
  const empty: PublicZone = { locality: null, localitySlug: null, area: null, areaSlug: null, province: null, label: null };
  if (!locationId) return empty;
  let cur = idx.byId.get(locationId);
  const zone = { ...empty };
  let guard = 0;
  while (cur && guard++ < 10) {
    if (cur.kind === "locality" && !zone.locality) {
      zone.locality = cur.name;
      zone.localitySlug = cur.slug;
    } else if (cur.kind === "province" && !zone.province) zone.province = cur.name;
    else if (["neighborhood", "gated_community", "zone"].includes(cur.kind) && !zone.area) {
      zone.area = cur.name;
      zone.areaSlug = cur.slug;
    }
    cur = cur.parent_id ? idx.byId.get(cur.parent_id) : undefined;
  }
  // El importador crea barrios "comodín" con el mismo nombre que la localidad: no se repite.
  const sameName = zone.area && zone.locality && zone.area.localeCompare(zone.locality, "es", { sensitivity: "base" }) === 0;
  if (sameName) {
    zone.area = null;
    zone.areaSlug = null;
  }
  zone.label = zone.area && zone.locality ? `${zone.area}, ${zone.locality}` : (zone.area ?? zone.locality ?? zone.province);
  return zone;
}

function descendantIds(idx: LocationIndex, rootIds: string[]): string[] {
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of idx.children.get(id) ?? []) stack.push(c.id);
  }
  return [...out];
}

/** Ids de ubicación que cubre el filtro zona (localidad) + barrio. null = sin filtro; [] = no existe. */
function locationFilterIds(idx: LocationIndex, zona?: string, barrio?: string): string[] | null {
  if (!zona && !barrio) return null;
  let roots = [...idx.byId.values()].filter((l) => (zona ? l.kind === "locality" && l.slug === zona : false)).map((l) => l.id);
  if (barrio) {
    const scope = zona ? descendantIds(idx, roots) : [...idx.byId.keys()];
    const scopeSet = new Set(scope);
    const areas = [...idx.byId.values()].filter((l) => ["neighborhood", "gated_community", "zone"].includes(l.kind) && l.slug === barrio && scopeSet.has(l.id));
    roots = areas.map((a) => a.id);
  }
  return roots.length ? descendantIds(idx, roots) : [];
}

// ───────────────────────── Multimedia ─────────────────────────

type MediaSource = { source_url: string | null; storage_driver: string | null; storage_key: string | null; visibility: string | null };

/** URL pública de una foto: storage propio (público) si ya se copió; si no, la URL de origen. */
export function publicMediaUrl(m: MediaSource): string | null {
  const base = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (m.storage_key && m.visibility === "public" && m.storage_driver === "s3" && base) return `${base}/${m.storage_key}`;
  return m.source_url && /^https:\/\//.test(m.source_url) ? m.source_url : null;
}

// ───────────────────────── Filas ─────────────────────────

type CardRow = {
  id: string;
  code: number;
  slug: string;
  title: string;
  type_key: string;
  type_name: string;
  type_category: string;
  status: string;
  featured: boolean;
  location_id: string | null;
  bedrooms: number | null;
  rooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  total_area_m2: string | null;
  covered_area_m2: string | null;
  land_area_m2: string | null;
  published_at: Date | null;
  prices: Array<{ operation: string; currency: string; amount: string | number | null; price_hidden: boolean; expenses_amount: string | number | null; expenses_currency: string | null }> | null;
  cover: (MediaSource & { width: number | null; height: number | null; alt_text: string | null }) | null;
  photo_count: number;
};

const OP_ORDER: Record<string, number> = { sale: 0, rent: 1, temporary_rent: 2 };

/** Columnas de tarjeta (explícitas) + precios activos (monto anulado si está oculto) + portada + conteo de fotos. */
const cardSelect = sql`
  p.id, p.code, p.slug, p.title, p.type_key, t.name as type_name, t.category as type_category, p.status, p.featured, p.location_id,
  p.bedrooms, p.rooms, p.bathrooms, p.garages, p.total_area_m2, p.covered_area_m2, p.land_area_m2, p.published_at,
  (select jsonb_agg(jsonb_build_object(
      'operation', o.operation, 'currency', o.currency,
      'amount', case when o.price_hidden then null else o.amount end,
      'price_hidden', o.price_hidden,
      'expenses_amount', o.expenses_amount, 'expenses_currency', o.expenses_currency) order by o.operation)
    from property_operations o where o.property_id = p.id and o.is_active) as prices,
  (select jsonb_build_object('source_url', m.source_url, 'storage_driver', f.storage_driver, 'storage_key', f.storage_key,
      'visibility', f.visibility, 'width', coalesce(m.width, f.width), 'height', coalesce(m.height, f.height), 'alt_text', m.alt_text)
    from property_media m left join files f on f.id = m.file_id and f.deleted_at is null
    where m.property_id = p.id and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed'
    order by m.is_cover desc, m.sort_order, m.created_at limit 1) as cover,
  (select count(*)::int from property_media m
    where m.property_id = p.id and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed') as photo_count`;

/** Publicadas y visibles. `not p.is_demo` es redundante con la base (una demo no puede publicarse) y se deja como defensa. */
const publishedWhere = sql`p.is_published and not p.is_demo and p.deleted_at is null and p.status in ('available', 'reserved', 'sold', 'rented')`;

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapPrices(rows: CardRow["prices"]): PublicPrice[] {
  return (rows ?? [])
    .filter((r) => r.operation in OP_ORDER)
    .sort((a, b) => OP_ORDER[a.operation]! - OP_ORDER[b.operation]!)
    .map((r) => ({
      operation: r.operation as PublicOperation,
      currency: r.currency === "ARS" ? "ARS" : "USD",
      amount: r.price_hidden ? null : toNum(r.amount),
      priceHidden: r.price_hidden || toNum(r.amount) === null,
      expenses: toNum(r.expenses_amount) && r.expenses_currency ? { amount: toNum(r.expenses_amount)!, currency: r.expenses_currency === "ARS" ? "ARS" : "USD" } : null,
    }));
}

function photoAlt(headline: string, index: number, total: number): string {
  return total > 1 ? `${headline} — foto ${index} de ${total}` : headline;
}

function mapCard(idx: LocationIndex, r: CardRow): PublicPropertyCard {
  const zone = zoneOf(idx, r.location_id);
  const prices = mapPrices(r.prices);
  const detail = headlineDetail({ category: r.type_category, bedrooms: r.bedrooms, rooms: r.rooms, coveredAreaM2: r.covered_area_m2, landAreaM2: r.land_area_m2, totalAreaM2: r.total_area_m2 });
  const headline = propertyHeadline(r.type_name, prices[0]?.operation ?? null, zone.area ?? zone.locality, detail);
  const coverUrl = r.cover ? publicMediaUrl(r.cover) : null;
  return {
    code: r.code,
    slug: r.slug,
    headline,
    subtitle: titleAddsInfo(r.title, r.type_name) ? tidyTitle(r.title) : null,
    typeKey: r.type_key,
    typeName: r.type_name,
    status: (["available", "reserved", "sold", "rented"].includes(r.status) ? r.status : "available") as PublicStatus,
    featured: r.featured,
    zone,
    prices,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    garages: r.garages,
    totalAreaM2: toNum(r.total_area_m2),
    coveredAreaM2: toNum(r.covered_area_m2),
    landAreaM2: toNum(r.land_area_m2),
    cover: coverUrl && r.cover ? { url: coverUrl, width: r.cover.width, height: r.cover.height, alt: r.cover.alt_text?.trim() || photoAlt(headline, 1, r.photo_count) } : null,
    photoCount: r.photo_count,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
  };
}

// ───────────────────────── Búsqueda ─────────────────────────

export type SearchResult = { items: PublicPropertyCard[]; total: number; page: number; pageCount: number; pageSize: number };

/**
 * Búsqueda de texto pública. Con dirección oculta la calle no participa (la altura suele venir embebida en
 * `address_street`): solo título y descripción. Misma expresión que el índice trigram properties_public_search_trgm
 * (migración 0160): si cambia una, cambia la otra.
 */
export function publicTextSearchCondition(q: string) {
  return sql<boolean>`f_unaccent(lower(p.title || ' ' || case when p.hide_exact_address then '' else coalesce(p.address_street, '') end || ' ' || coalesce(p.description, ''))) like ('%' || f_unaccent(lower(${q})) || '%')`;
}

function buildWhere(idx: LocationIndex, f: SearchFilters) {
  const conds = [publishedWhere];
  const op = f.operacion ? OPERATION_SLUGS[f.operacion] : null;

  const opConds = [sql`o.property_id = p.id`, sql`o.is_active`];
  if (op) opConds.push(sql`o.operation = ${op}`);
  const priceFilter = f.precio_min !== undefined || f.precio_max !== undefined;
  if (f.moneda) opConds.push(sql`o.currency = ${f.moneda}`);
  if (priceFilter) {
    opConds.push(sql`not o.price_hidden`);
    if (f.precio_min !== undefined) opConds.push(sql`o.amount >= ${f.precio_min}`);
    if (f.precio_max !== undefined) opConds.push(sql`o.amount <= ${f.precio_max}`);
  }
  if (op || f.moneda || priceFilter) conds.push(sql`exists (select 1 from property_operations o where ${sql.join(opConds, sql` and `)})`);

  if (f.tipo) conds.push(sql`p.type_key = ${f.tipo}`);
  const locIds = locationFilterIds(idx, f.zona, f.barrio);
  if (locIds) conds.push(locIds.length ? sql`p.location_id = any(${locIds}::uuid[])` : sql`false`);
  if (f.dormitorios) conds.push(sql`p.bedrooms >= ${f.dormitorios}`);
  if (f.banos) conds.push(sql`p.bathrooms >= ${f.banos}`);
  if (f.cocheras) conds.push(sql`p.garages >= ${f.cocheras}`);
  if (f.superficie_min !== undefined) conds.push(sql`coalesce(p.total_area_m2, p.land_area_m2, p.covered_area_m2) >= ${f.superficie_min}`);
  if (f.superficie_max !== undefined) conds.push(sql`coalesce(p.total_area_m2, p.land_area_m2, p.covered_area_m2) <= ${f.superficie_max}`);
  if (f.credito) conds.push(sql`p.credit_eligible is true`);
  for (const key of f.caracteristicas) {
    conds.push(sql`exists (select 1 from property_features pf join features fe on fe.id = pf.feature_id where pf.property_id = p.id and fe.key = ${key})`);
  }
  if (f.q) {
    const q = f.q.replace(/[%_\\]/g, " ").trim();
    const code = /^\d{1,7}$/.test(q) ? Number(q) : null;
    const textCond = publicTextSearchCondition(q);
    conds.push(code ? sql`(p.code = ${code} or ${textCond})` : textCond);
  }
  return { where: sql.join(conds, sql` and `), op };
}

function orderBy(f: SearchFilters, op: string | null) {
  const priceExpr = sql`(select min(o.amount) from property_operations o where o.property_id = p.id and o.is_active and not o.price_hidden
    ${op ? sql`and o.operation = ${op}` : sql``} ${f.moneda ? sql`and o.currency = ${f.moneda}` : sql``})`;
  const currencyExpr = sql`(select min(o.currency) from property_operations o where o.property_id = p.id and o.is_active ${op ? sql`and o.operation = ${op}` : sql``})`;
  switch (f.orden) {
    case "precio-asc":
      return sql`${currencyExpr} desc nulls last, ${priceExpr} asc nulls last, p.published_at desc, p.code desc`;
    case "precio-desc":
      return sql`${currencyExpr} desc nulls last, ${priceExpr} desc nulls last, p.published_at desc, p.code desc`;
    case "superficie":
      return sql`coalesce(p.total_area_m2, p.land_area_m2, p.covered_area_m2) desc nulls last, p.published_at desc, p.code desc`;
    default:
      return sql`p.published_at desc nulls last, p.code desc`;
  }
}

export async function searchPublicProperties(db: Executor, f: SearchFilters, pageSize = PAGE_SIZE): Promise<SearchResult> {
  const idx = await locationIndex(db);
  const { where, op } = buildWhere(idx, f);
  const countRow = await sql<{ n: number }>`select count(*)::int as n from properties p where ${where}`.execute(db);
  const total = countRow.rows[0]?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, f.pagina), pageCount);
  const rows = await sql<CardRow>`
    select ${cardSelect}
    from properties p join property_types t on t.key = p.type_key
    where ${where}
    order by ${orderBy(f, op)}
    limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(db);
  return { items: rows.rows.map((r) => mapCard(idx, r)), total, page, pageCount, pageSize };
}

// ───────────────────────── Facetas y conteos en vivo ─────────────────────────

export type ZoneCount = { slug: string; name: string; count: number; areas: Array<{ slug: string; name: string; count: number }> };
export type Facets = {
  operations: Array<{ slug: "venta" | "alquiler" | "temporario"; count: number }>;
  types: Array<{ key: string; name: string; plural: string; count: number }>;
  zones: ZoneCount[];
  features: Array<{ key: string; name: string; count: number }>;
  total: number;
};

/**
 * Conteos por operación, tipo, zona y características sobre lo publicado, dentro de la operación y el tipo vigentes
 * (así los menús nunca ofrecen combinaciones vacías): operaciones se cuentan dentro del tipo, tipos dentro de la
 * operación, y zonas/características/total dentro de ambos.
 */
export async function getPublicFacets(db: Executor, operation?: PublicOperation, typeKey?: string): Promise<Facets> {
  const idx = await locationIndex(db);
  const opFilter = operation ? sql`and exists (select 1 from property_operations o where o.property_id = p.id and o.is_active and o.operation = ${operation})` : sql``;
  const typeFilter = typeKey ? sql`and p.type_key = ${typeKey}` : sql``;
  const [ops, types, locs, feats, total] = await Promise.all([
    sql<{ operation: string; n: number }>`
      select o.operation, count(distinct p.id)::int as n from properties p join property_operations o on o.property_id = p.id and o.is_active
      where ${publishedWhere} ${typeFilter} group by o.operation`.execute(db),
    sql<{ key: string; name: string; name_plural: string; n: number; sort_order: number }>`
      select t.key, t.name, t.name_plural, t.sort_order, count(*)::int as n from properties p join property_types t on t.key = p.type_key
      where ${publishedWhere} ${opFilter} group by t.key, t.name, t.name_plural, t.sort_order order by n desc, t.sort_order`.execute(db),
    sql<{ location_id: string | null; n: number }>`
      select p.location_id, count(*)::int as n from properties p where ${publishedWhere} ${opFilter} ${typeFilter} group by p.location_id`.execute(db),
    sql<{ key: string; name: string; n: number }>`
      select fe.key, fe.name, count(*)::int as n from properties p join property_features pf on pf.property_id = p.id join features fe on fe.id = pf.feature_id
      where ${publishedWhere} ${opFilter} ${typeFilter} and fe.grp in ('amenity', 'building_amenity', 'building_service', 'ambient')
      group by fe.key, fe.name having count(*) >= 3 order by n desc limit 24`.execute(db),
    sql<{ n: number }>`select count(*)::int as n from properties p where ${publishedWhere} ${opFilter} ${typeFilter}`.execute(db),
  ]);

  const zones = new Map<string, ZoneCount>();
  for (const row of locs.rows) {
    const z = zoneOf(idx, row.location_id);
    if (!z.localitySlug || !z.locality) continue;
    const entry = zones.get(z.localitySlug) ?? { slug: z.localitySlug, name: z.locality, count: 0, areas: [] };
    entry.count += row.n;
    if (z.areaSlug && z.area) {
      const a = entry.areas.find((x) => x.slug === z.areaSlug);
      if (a) a.count += row.n;
      else entry.areas.push({ slug: z.areaSlug, name: z.area, count: row.n });
    }
    zones.set(z.localitySlug, entry);
  }
  const slugOf: Record<string, "venta" | "alquiler" | "temporario"> = { sale: "venta", rent: "alquiler", temporary_rent: "temporario" };
  return {
    operations: ops.rows.filter((o) => o.operation in slugOf).map((o) => ({ slug: slugOf[o.operation]!, count: o.n })),
    types: types.rows.map((t) => ({ key: t.key, name: t.name, plural: t.name_plural, count: t.n })),
    zones: [...zones.values()].sort((a, b) => b.count - a.count).map((z) => ({ ...z, areas: z.areas.sort((a, b) => b.count - a.count) })),
    features: feats.rows.map((r) => ({ key: r.key, name: r.name, count: r.n })),
    total: total.rows[0]?.n ?? 0,
  };
}

// ───────────────────────── Home: destacadas, recientes, fotos por zona ─────────────────────────

/**
 * Mínimo de fotos publicables (no fallidas) para que una propiedad protagonice el home. Cuentan también las `source_only`:
 * son válidas y se sirven desde el origen (así está hoy todo el inventario importado en producción).
 */
export const SHOWCASE_MIN_PHOTOS = 8;

/**
 * Propiedades para el hero y el showcase del home. Criterio (en este orden):
 * 1. publicadas y disponibles o reservadas (nunca vendidas/alquiladas en portada);
 * 2. con al menos SHOWCASE_MIN_PHOTOS fotos no fallidas (mismo criterio que la portada y la galería: `status <> 'failed'`);
 * 3. `featured` (marcadas por el equipo en el CRM) primero;
 * 4. luego las de más fotos (proxy objetivo de producción fotográfica cuidada) y más recientes.
 * Tipos residenciales/emprendimientos primero para el hero (una casa con paisaje comunica mejor que un galpón).
 */
export async function getShowcaseProperties(db: Executor, limit = 6, opts: { preferCoverWidth?: number } = {}): Promise<PublicPropertyCard[]> {
  const idx = await locationIndex(db);
  // Hero a sangre: primero las portadas con ancho real conocido ≥ preferCoverWidth (sin dato de ancho no se supone nada).
  const wide = opts.preferCoverWidth
    ? sql`coalesce((select coalesce(m.width, f.width) from property_media m left join files f on f.id = m.file_id and f.deleted_at is null
           where m.property_id = p.id and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed'
           order by m.is_cover desc, m.sort_order, m.created_at limit 1) >= ${opts.preferCoverWidth}, false) desc,`
    : sql``;
  const rows = await sql<CardRow>`
    select ${cardSelect}
    from properties p join property_types t on t.key = p.type_key
    where ${publishedWhere} and p.status in ('available', 'reserved')
      and (select count(*) from property_media m where m.property_id = p.id and m.deleted_at is null and m.kind = 'image'
           and m.status <> 'failed') >= ${SHOWCASE_MIN_PHOTOS}
    order by ${wide} p.featured desc,
      (t.category in ('residential', 'development')) desc,
      (select count(*) from property_media m where m.property_id = p.id and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed') desc,
      p.published_at desc, p.code desc
    limit ${limit}`.execute(db);
  return rows.rows.map((r) => mapCard(idx, r));
}

/** Últimas publicadas disponibles. `operation` las limita a una operación (p. ej. la foto real de "Alquileres" en el home). */
export async function getRecentProperties(db: Executor, limit = 10, excludeCodes: number[] = [], operation?: PublicOperation): Promise<PublicPropertyCard[]> {
  const idx = await locationIndex(db);
  const rows = await sql<CardRow>`
    select ${cardSelect}
    from properties p join property_types t on t.key = p.type_key
    where ${publishedWhere} and p.status in ('available', 'reserved')
      ${excludeCodes.length ? sql`and not (p.code = any(${excludeCodes}::int[]))` : sql``}
      ${operation ? sql`and exists (select 1 from property_operations o where o.property_id = p.id and o.is_active and o.operation = ${operation})` : sql``}
    order by p.published_at desc nulls last, p.code desc
    limit ${limit}`.execute(db);
  return rows.rows.map((r) => mapCard(idx, r));
}

// ───────────────────────── Ficha ─────────────────────────

export type PropertyLookup =
  | { kind: "found"; property: PublicPropertyDetail }
  | { kind: "redirect"; slug: string }
  | { kind: "archived"; typeKey: string; zoneSlug: string | null; operation: PublicOperation | null }
  | { kind: "not_found" };

const FEATURE_GROUP_LABEL: Record<string, string> = {
  ambient: "Ambientes",
  amenity: "Comodidades",
  building_amenity: "Edificio",
  building_service: "Servicios del edificio",
  service: "Servicios",
  characteristic: "Características",
};
const FEATURE_GROUP_ORDER = ["ambient", "amenity", "characteristic", "service", "building_amenity", "building_service"];

type DetailRow = CardRow & {
  description: string | null;
  address_street: string | null;
  address_number: string | null;
  hide_exact_address: boolean;
  latitude: string | null;
  longitude: string | null;
  toilets: number | null;
  uncovered_area_m2: string | null;
  age_years: number | null;
  orientation: string | null;
  disposition: string | null;
  condition: string | null;
  credit_eligible: boolean | null;
  professional_use: boolean | null;
  allows_pets: boolean | null;
  attributes: Record<string, unknown>;
  field_schema: Array<{ key: string; label: string; type: string; unit?: string }>;
  type_category: string;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: Date;
  branch_id: string | null;
};

export async function getPublicPropertyBySlug(db: Executor, slug: string): Promise<PropertyLookup> {
  if (!/^[a-z0-9-]{3,160}$/.test(slug)) return { kind: "not_found" };
  const idx = await locationIndex(db);
  const found = await sql<DetailRow>`
    select ${cardSelect},
      p.description, p.address_street, p.address_number, p.hide_exact_address, p.latitude, p.longitude,
      p.toilets, p.uncovered_area_m2, p.age_years, p.orientation, p.disposition, p.condition,
      p.credit_eligible, p.professional_use, p.allows_pets, p.attributes, t.field_schema,
      p.seo_title, p.seo_description, p.updated_at, p.branch_id
    from properties p join property_types t on t.key = p.type_key
    where p.slug = ${slug} and ${publishedWhere}`.execute(db);
  const row = found.rows[0];

  if (!row) {
    // ¿Slug anterior de una propiedad publicada?
    const redirect = await sql<{ slug: string }>`
      select p.slug from property_redirects r join properties p on p.id = r.property_id
      where r.path = ${`/propiedades/${slug}`} and ${publishedWhere}`.execute(db);
    if (redirect.rows[0]) return { kind: "redirect", slug: redirect.rows[0].slug };
    // Archivada después de haber estado publicada → búsqueda filtrada (conserva el valor SEO del enlace).
    const archived = await sql<{ type_key: string; location_id: string | null; operation: string | null }>`
      select p.type_key, p.location_id,
        (select o.operation from property_operations o where o.property_id = p.id order by o.operation limit 1) as operation
      from properties p
      where (p.slug = ${slug} or p.id = (select r.property_id from property_redirects r where r.path = ${`/propiedades/${slug}`}))
        and p.deleted_at is null and p.status = 'archived' and p.published_at is not null`.execute(db);
    const a = archived.rows[0];
    if (a) return { kind: "archived", typeKey: a.type_key, zoneSlug: zoneOf(idx, a.location_id).localitySlug, operation: (a.operation as PublicOperation | null) ?? null };
    return { kind: "not_found" };
  }

  const card = mapCard(idx, row);
  const [photos, features, advisor, branch] = await Promise.all([
    sql<MediaSource & { width: number | null; height: number | null; alt_text: string | null }>`
      select m.source_url, f.storage_driver, f.storage_key, f.visibility, coalesce(m.width, f.width) as width, coalesce(m.height, f.height) as height, m.alt_text
      from property_media m left join files f on f.id = m.file_id and f.deleted_at is null
      where m.property_id = ${row.id} and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed'
      order by m.is_cover desc, m.sort_order, m.created_at`.execute(db),
    sql<{ grp: string; name: string }>`
      select fe.grp, fe.name from property_features pf join features fe on fe.id = pf.feature_id
      where pf.property_id = ${row.id} order by fe.sort_order, fe.name`.execute(db),
    sql<{ full_name: string; whatsapp_e164: string | null }>`
      select u.full_name, u.whatsapp_e164 from property_agents pa join users u on u.id = pa.user_id
      where pa.property_id = ${row.id} and pa.role = 'lead' and u.public_profile and u.is_active and u.deleted_at is null and u.kind = 'staff'
      limit 1`.execute(db),
    row.branch_id
      ? db.selectFrom("branches").select(["name", "phone", "email", "schedule", "address_street", "address_number", "city"]).where("id", "=", row.branch_id).where("is_active", "=", true).executeTakeFirst()
      : Promise.resolve(undefined),
  ]);

  const urls = photos.rows.map((m) => ({ m, url: publicMediaUrl(m) })).filter((x): x is { m: (typeof photos.rows)[number]; url: string } => Boolean(x.url));
  const groups = new Map<string, string[]>();
  for (const f of features.rows) groups.set(f.grp, [...(groups.get(f.grp) ?? []), f.name]);

  const attrs: Array<{ label: string; value: string }> = [];
  const values = row.attributes ?? {};
  for (const field of row.field_schema ?? []) {
    const v = values[field.key];
    if (v === undefined || v === null || v === "" || v === false) continue;
    let value: string;
    if (field.type === "boolean") value = "Sí";
    else if (field.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      value = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${v}T12:00:00Z`));
    } else if (typeof v === "number") value = new Intl.NumberFormat("es-AR").format(v);
    else value = String(v).slice(0, 120);
    if (field.unit) value = `${value} ${field.unit}`;
    attrs.push({ label: field.label, value });
  }

  const a = advisor.rows[0];
  const property: PublicPropertyDetail = {
    ...card,
    title: tidyTitle(row.title),
    description: row.description?.trim() || null,
    street: publicStreet(row.address_street, row.address_number, row.hide_exact_address),
    addressHidden: row.hide_exact_address,
    coordinates: publicCoordinates(row.latitude, row.longitude, row.hide_exact_address),
    rooms: row.rooms,
    toilets: row.toilets,
    uncoveredAreaM2: toNum(row.uncovered_area_m2),
    ageYears: row.age_years,
    orientation: row.orientation,
    disposition: row.disposition,
    condition: row.condition,
    creditEligible: row.credit_eligible,
    professionalUse: row.professional_use,
    allowsPets: row.allows_pets,
    attributes: attrs,
    features: FEATURE_GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ key: g, label: FEATURE_GROUP_LABEL[g] ?? g, items: groups.get(g)! })),
    photos: urls.map(({ m, url }, i) => ({ url, width: m.width, height: m.height, alt: m.alt_text?.trim() || photoAlt(card.headline, i + 1, urls.length) })),
    advisor: a ? { name: a.full_name, whatsappE164: a.whatsapp_e164 } : null,
    branch: branch
      ? { name: branch.name, phone: branch.phone, email: branch.email, schedule: branch.schedule, address: [branch.address_street, branch.address_number].filter(Boolean).join(" ") || null }
      : null,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    updatedAt: new Date(row.updated_at).toISOString(),
    locationId: row.location_id,
    typeCategory: row.type_category,
  };
  if (property.cover) property.cover = property.photos[0] ?? property.cover;
  return { kind: "found", property };
}

/**
 * Similares reales: mismo tipo y operación; prioriza misma localidad y precio cercano. Solo disponibles/reservadas.
 */
export async function getSimilarProperties(db: Executor, p: PublicPropertyDetail, limit = 4): Promise<PublicPropertyCard[]> {
  const idx = await locationIndex(db);
  const op = p.prices[0]?.operation ?? null;
  const amount = p.prices[0]?.amount ?? null;
  const localityIds = p.zone.localitySlug ? (locationFilterIds(idx, p.zone.localitySlug) ?? []) : [];
  const rows = await sql<CardRow>`
    select ${cardSelect}
    from properties p join property_types t on t.key = p.type_key
    where ${publishedWhere} and p.status in ('available', 'reserved') and p.code <> ${p.code}
      and (p.type_key = ${p.typeKey} or t.category = ${p.typeCategory})
      ${op ? sql`and exists (select 1 from property_operations o where o.property_id = p.id and o.is_active and o.operation = ${op})` : sql``}
    order by (p.type_key = ${p.typeKey}) desc,
      ${localityIds.length ? sql`(p.location_id = any(${localityIds}::uuid[])) desc,` : sql``}
      ${amount !== null && op ? sql`abs(coalesce((select min(o.amount) from property_operations o where o.property_id = p.id and o.is_active and not o.price_hidden and o.operation = ${op}), 1e15) - ${amount}) asc,` : sql``}
      p.published_at desc
    limit ${limit}`.execute(db);
  return rows.rows.map((r) => mapCard(idx, r));
}

// ───────────────────────── Redirecciones y sitemap ─────────────────────────

/** `/luciolopez-3021` (sitio anterior) → slug actual, solo si la propiedad está publicada. */
export async function resolveLegacyPath(db: Executor, path: string): Promise<string | null> {
  if (!/^\/[A-Za-z0-9/_.-]{1,200}$/.test(path)) return null;
  const r = await sql<{ slug: string }>`
    select p.slug from property_redirects r join properties p on p.id = r.property_id
    where r.path = ${path} and ${publishedWhere}`.execute(db);
  return r.rows[0]?.slug ?? null;
}

export async function listPublishedForSitemap(db: Executor): Promise<Array<{ slug: string; updatedAt: Date }>> {
  const r = await sql<{ slug: string; updated_at: Date }>`
    select p.slug, p.updated_at from properties p where ${publishedWhere} order by p.published_at desc nulls last`.execute(db);
  return r.rows.map((x) => ({ slug: x.slug, updatedAt: new Date(x.updated_at) }));
}

/** Tipo por clave (para títulos de listados). */
export async function getPublicType(db: Executor, key: string): Promise<{ key: string; name: string; plural: string } | null> {
  const t = await db.selectFrom("property_types").select(["key", "name", "name_plural"]).where("key", "=", key).where("is_active", "=", true).executeTakeFirst();
  return t ? { key: t.key, name: t.name, plural: t.name_plural } : null;
}

export async function getZoneName(db: Executor, zona?: string, barrio?: string): Promise<string | null> {
  const idx = await locationIndex(db);
  const vals = [...idx.byId.values()];
  if (barrio) {
    const scope = zona ? new Set(locationFilterIds(idx, zona) ?? []) : null;
    const a = vals.find((l) => ["neighborhood", "gated_community", "zone"].includes(l.kind) && l.slug === barrio && (!scope || scope.has(l.id)));
    if (a) return a.name;
  }
  if (zona) return vals.find((l) => l.kind === "locality" && l.slug === zona)?.name ?? null;
  return null;
}
