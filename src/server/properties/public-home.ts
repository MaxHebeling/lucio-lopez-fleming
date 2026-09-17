/**
 * Lecturas públicas propias del home y de redirecciones del sitio anterior. Mismas reglas que public.ts:
 * solo lo publicado, columnas explícitas, nada privado.
 */
import "server-only";
import { sql, type Executor } from "../db";
import { publicMediaUrl, type Facets, type PublicPhoto, type ZoneCount } from "./public";
import type { PublicOperation } from "./public-helpers";

export type ZoneShowcase = ZoneCount & { cover: PublicPhoto | null };

/**
 * Zonas con más propiedades publicadas (de las facetas ya calculadas: no se recuentan) + la portada de la propiedad
 * disponible con más fotos publicables (no fallidas) de cada una, resuelta en una sola consulta (ranking por zona en SQL, sin traer
 * todas las propiedades). Hasta 3 candidatas por zona para saltear portadas sin URL pública.
 */
export async function getZoneShowcase(db: Executor, facets: Pick<Facets, "zones">, limit = 6): Promise<ZoneShowcase[]> {
  const top = facets.zones.slice(0, limit);
  if (!top.length) return [];
  const slugs = top.map((z) => z.slug);
  const rows = await sql<{
    zone_slug: string;
    source_url: string | null;
    storage_driver: string | null;
    storage_key: string | null;
    visibility: string | null;
    width: number | null;
    height: number | null;
  }>`
    with recursive zone_locs as (
      select l.id, l.slug as zone_slug from locations l where l.kind = 'locality' and l.slug = any(${slugs}::text[])
      union
      select c.id, z.zone_slug from locations c join zone_locs z on c.parent_id = z.id where c.kind <> 'locality'
    ),
    ranked as (
      select z.zone_slug, p.id as property_id,
        row_number() over (
          partition by z.zone_slug
          order by (select count(*) from property_media v where v.property_id = p.id and v.deleted_at is null and v.kind = 'image'
                    and v.status <> 'failed') desc,
            p.published_at desc nulls last, p.code desc) as rn
      from properties p join zone_locs z on z.id = p.location_id
      where p.is_published and not p.is_demo and p.deleted_at is null and p.status in ('available', 'reserved')
    )
    select r.zone_slug, m.source_url, f.storage_driver, f.storage_key, f.visibility,
      coalesce(m.width, f.width) as width, coalesce(m.height, f.height) as height
    from ranked r
    join lateral (
      select m.source_url, m.file_id, m.width, m.height from property_media m
      where m.property_id = r.property_id and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed'
      order by m.is_cover desc, m.sort_order, m.created_at limit 1
    ) m on true
    left join files f on f.id = m.file_id and f.deleted_at is null
    where r.rn <= 3
    order by r.zone_slug, r.rn`.execute(db);

  const covers = new Map<string, PublicPhoto>();
  for (const r of rows.rows) {
    if (covers.has(r.zone_slug)) continue;
    const url = publicMediaUrl(r);
    if (url) covers.set(r.zone_slug, { url, width: r.width, height: r.height, alt: "" });
  }
  return top.map((z) => {
    const cover = covers.get(z.slug);
    return { ...z, cover: cover ? { ...cover, alt: `Propiedad publicada en ${z.name}` } : null };
  });
}

export type LegacyTarget =
  | { kind: "property"; slug: string }
  | { kind: "search"; operation: PublicOperation | null; typeKey: string; zoneSlug: string | null }
  | { kind: "not_found" };

/**
 * /luciolopez-{código} del sitio anterior. Publicada → su ficha. Existió pero hoy no está publicada (despublicada,
 * archivada o borrada) → búsqueda por su tipo, operación y localidad. Sin rastro del código → no existe.
 */
export async function resolveLegacyTarget(db: Executor, path: string): Promise<LegacyTarget> {
  if (!/^\/[A-Za-z0-9/_.-]{1,200}$/.test(path)) return { kind: "not_found" };
  const r = await sql<{ slug: string; published: boolean; type_key: string; location_id: string | null; operation: string | null }>`
    select p.slug, (p.is_published and not p.is_demo and p.deleted_at is null and p.status in ('available', 'reserved', 'sold', 'rented')) as published,
      p.type_key, p.location_id,
      (select o.operation from property_operations o where o.property_id = p.id order by o.is_active desc, o.operation limit 1) as operation
    from property_redirects r join properties p on p.id = r.property_id
    where r.path = ${path}
    order by p.deleted_at nulls first
    limit 1`.execute(db);
  const row = r.rows[0];
  if (!row) return { kind: "not_found" };
  if (row.published) return { kind: "property", slug: row.slug };
  let zoneSlug: string | null = null;
  if (row.location_id) {
    const z = await sql<{ slug: string }>`
      with recursive chain as (
        select id, parent_id, kind, slug, 0 as depth from locations where id = ${row.location_id}
        union all
        select l.id, l.parent_id, l.kind, l.slug, c.depth + 1 from locations l join chain c on l.id = c.parent_id where c.depth < 10
      )
      select slug from chain where kind = 'locality' order by depth limit 1`.execute(db);
    zoneSlug = z.rows[0]?.slug ?? null;
  }
  const operation = row.operation === "sale" || row.operation === "rent" || row.operation === "temporary_rent" ? row.operation : null;
  return { kind: "search", operation, typeKey: row.type_key, zoneSlug };
}

export type ListingCombination = { operation: "venta" | "alquiler"; typeKey: string | null; zoneSlug: string | null; count: number; updatedAt: string };

/**
 * Listados indexables con resultados (para el sitemap): operación × tipo, operación × localidad y operación × tipo ×
 * localidad. La localidad de cada propiedad es la primera `locality` hacia arriba en el árbol (igual que el filtro zona).
 */
export async function listListingCombinations(db: Executor): Promise<ListingCombination[]> {
  const r = await sql<{ operation: string; type_key: string | null; zone_slug: string | null; n: number; updated_at: Date; g_type: number; g_zone: number }>`
    with recursive loc_locality as (
      select id, slug as zone_slug from locations where kind = 'locality'
      union
      select c.id, l.zone_slug from locations c join loc_locality l on c.parent_id = l.id where c.kind <> 'locality'
    )
    select o.operation, p.type_key, ll.zone_slug, count(distinct p.id)::int as n, max(p.updated_at) as updated_at,
      grouping(p.type_key) as g_type, grouping(ll.zone_slug) as g_zone
    from properties p
    join property_operations o on o.property_id = p.id and o.is_active and o.operation in ('sale', 'rent')
    left join loc_locality ll on ll.id = p.location_id
    where p.is_published and not p.is_demo and p.deleted_at is null and p.status in ('available', 'reserved', 'sold', 'rented')
    group by grouping sets ((o.operation, p.type_key), (o.operation, ll.zone_slug), (o.operation, p.type_key, ll.zone_slug))`.execute(db);
  return r.rows
    .filter((x) => x.n > 0 && (x.g_zone === 1 || x.zone_slug !== null))
    .map((x) => ({
      operation: x.operation === "sale" ? ("venta" as const) : ("alquiler" as const),
      typeKey: x.g_type === 1 ? null : x.type_key,
      zoneSlug: x.g_zone === 1 ? null : x.zone_slug,
      count: x.n,
      updatedAt: new Date(x.updated_at).toISOString(),
    }));
}
