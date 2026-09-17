/**
 * Análisis de inventario del CRM: por publicación, días publicada, consultas (leads) y visitas agendadas desde que se
 * publicó, calidad y oportunidades de revisión (inventory-rules.ts). Solo lectura.
 *
 * Permisos: `properties.read`. Las consultas solo se cuentan con `leads.read_all` (con alcance propio no se muestran
 * números de todo el equipo). Vistas de la ficha: punto de extensión `InventorySignalSource.pageViews` (otra rama las
 * registra); sin fuente, la columna no aparece.
 */
import { sql, type Database } from "../../db";
import { can, requirePermission, type Actor } from "../../auth/actor";
import { isEnabled } from "../../flags";
import { DEFAULT_INVENTORY_SETTINGS, inventoryLeadsMedian, inventoryOpportunity, type InventorySettings, type Opportunity } from "./inventory-rules";

export type InventorySignalSource = {
  /** Vistas por propiedad desde una fecha. null = fuente no disponible. */
  pageViews?(db: Database, propertyIds: string[]): Promise<Map<string, number> | null>;
};

let signals: InventorySignalSource = {};
/** La rama de analítica registra su fuente acá (una línea); los tests también. */
export function registerInventorySignals(s: InventorySignalSource): void {
  signals = s;
}

export type InventoryRow = {
  id: string;
  code: number;
  title: string;
  typeName: string;
  publishedAt: Date | null;
  daysPublished: number | null;
  leads: number | null;
  visits: number;
  qualityScore: number | null;
  pageViews: number | null;
  opportunity: Opportunity | null;
};

async function settings(db: Database): Promise<InventorySettings> {
  const rows = await db.selectFrom("settings").select(["key", "value"]).where("key", "in", ["ai.inventory.min_days_published", "ai.inventory.low_leads_threshold"]).execute();
  const get = (k: string, d: number) => {
    const v = Number(rows.find((r) => r.key === k)?.value);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return { ...DEFAULT_INVENTORY_SETTINGS, minDaysPublished: get("ai.inventory.min_days_published", DEFAULT_INVENTORY_SETTINGS.minDaysPublished), lowLeadsThreshold: get("ai.inventory.low_leads_threshold", DEFAULT_INVENTORY_SETTINGS.lowLeadsThreshold) };
}

export async function getInventoryAnalysis(db: Database, actor: Actor, opts: { onlyOpportunities?: boolean; now?: Date } = {}) {
  requirePermission(actor, "properties.read");
  const enabled = await isEnabled(db, "ai_property_quality");
  const canLeads = can(actor, "leads.read_all");
  const s = await settings(db);
  const now = opts.now ?? new Date();
  const rows = await sql<{
    id: string;
    code: number;
    title: string;
    type_name: string;
    published_at: Date | null;
    leads: number;
    visits: number;
    score: number | null;
    findings: Array<{ code: string }> | null;
    has_cover: boolean;
    cover_room: string | null;
    price_hidden: boolean;
  }>`
    select p.id, p.code, p.title, t.name as type_name, p.published_at,
           (select count(*)::int from leads l where l.property_id = p.id and l.deleted_at is null and l.organization_id = p.organization_id
              and l.created_at >= coalesce(p.published_at, p.created_at)) as leads,
           (select count(*)::int from appointments a where a.property_id = p.id and a.kind = 'visit' and a.status <> 'cancelled'
              and a.created_at >= coalesce(p.published_at, p.created_at)) as visits,
           q.score, q.findings,
           exists(select 1 from property_media m where m.property_id = p.id and m.is_cover and m.deleted_at is null) as has_cover,
           (select r.room from property_media m join property_media_rooms r on r.media_id = m.id where m.property_id = p.id and m.is_cover and m.deleted_at is null limit 1) as cover_room,
           coalesce((select bool_and(o.price_hidden) from property_operations o where o.property_id = p.id and o.is_active), false) as price_hidden
      from properties p
      join property_types t on t.key = p.type_key
      left join property_quality_reports q on q.property_id = p.id
     where p.organization_id = ${actor.organizationId} and p.deleted_at is null and not p.is_demo and p.is_published
     order by p.published_at nulls last, p.code
     limit 2000`.execute(db);
  const views = signals.pageViews ? await signals.pageViews(db, rows.rows.map((r) => r.id)) : null;
  const items: InventoryRow[] = rows.rows.map((r) => {
    const days = r.published_at ? Math.max(0, Math.floor((now.getTime() - new Date(r.published_at).getTime()) / 86_400_000)) : null;
    const leads = canLeads ? r.leads : null;
    const pageViews = views ? (views.get(r.id) ?? 0) : null;
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      typeName: r.type_name,
      publishedAt: r.published_at ? new Date(r.published_at) : null,
      daysPublished: days,
      leads,
      visits: r.visits,
      qualityScore: r.score,
      pageViews,
      opportunity: enabled ? inventoryOpportunity({ daysPublished: days, leads, visits: r.visits, qualityScore: r.score, findingCodes: (r.findings ?? []).map((f) => f.code), hasCover: r.has_cover, coverRoom: r.cover_room, priceHidden: r.price_hidden, pageViews }, s) : null,
    };
  });
  // Primero las oportunidades; después las más antiguas publicadas.
  items.sort((x, y) => Number(Boolean(y.opportunity)) - Number(Boolean(x.opportunity)) || (y.daysPublished ?? -1) - (x.daysPublished ?? -1) || x.code - y.code);
  const mature = items.filter((i) => i.daysPublished !== null && i.daysPublished >= s.minDaysPublished && i.leads !== null);
  return {
    enabled,
    canLeads,
    settings: s,
    hasPageViews: views !== null,
    leadsMedian: canLeads ? inventoryLeadsMedian(mature.map((i) => i.leads!), s) : null,
    matureCount: mature.length,
    items: opts.onlyOpportunities ? items.filter((i) => i.opportunity) : items,
    opportunities: items.filter((i) => i.opportunity).length,
  };
}
