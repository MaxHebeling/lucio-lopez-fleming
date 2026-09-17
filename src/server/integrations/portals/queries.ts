import { sql, type Database } from "../../db";
import { requirePermission, type Actor } from "../../auth/actor";
import { isEnabled } from "../../flags";

export const SYNC_STATUSES = ["pending", "syncing", "synced", "failed", "retrying", "awaiting_credentials", "disabled"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export async function portalChannelsOverview(db: Database, actor: Actor) {
  requirePermission(actor, "publications.manage");
  const channels = await db
    .selectFrom("publication_channels as c")
    .leftJoin("integrations as i", "i.key", "c.integration_key")
    .select(["c.key", "c.name", "c.is_enabled", "i.status as integration_status", "i.last_error as integration_error", "i.last_ok_at", "i.last_error_at"])
    .where("c.kind", "=", "portal")
    .orderBy("c.name")
    .execute();
  const counts = await db
    .selectFrom("property_publications")
    .select(["channel_key", "sync_status", sql<number>`count(*)::int`.as("n")])
    .groupBy(["channel_key", "sync_status"])
    .execute();
  return {
    flagEnabled: await isEnabled(db, "portal_sync"),
    channels: channels.map((c) => ({
      ...c,
      counts: Object.fromEntries(counts.filter((x) => x.channel_key === c.key).map((x) => [x.sync_status, x.n])) as Partial<Record<SyncStatus, number>>,
    })),
  };
}

export type PublicationFilters = { channel?: string; status?: string; q?: string; page?: number };
const PAGE_SIZE = 50;

export async function listPortalPublications(db: Database, actor: Actor, f: PublicationFilters) {
  requirePermission(actor, "publications.manage");
  const page = Math.max(1, Math.min(1000, Math.floor(f.page ?? 1)));
  let q = db
    .selectFrom("property_publications as pp")
    .innerJoin("publication_channels as c", "c.key", "pp.channel_key")
    .innerJoin("properties as p", "p.id", "pp.property_id")
    .where("c.kind", "=", "portal")
    .where("p.deleted_at", "is", null);
  if (f.channel && /^[a-z0-9_]{2,40}$/.test(f.channel)) q = q.where("pp.channel_key", "=", f.channel);
  if (f.status && (SYNC_STATUSES as readonly string[]).includes(f.status)) q = q.where("pp.sync_status", "=", f.status);
  const term = f.q?.trim().slice(0, 80);
  if (term) {
    q = /^\d+$/.test(term) ? q.where("p.code", "=", Number(term)) : q.where(sql<boolean>`f_unaccent(lower(p.title)) like f_unaccent(lower(${`%${term.replace(/[%_\\]/g, "\\$&")}%`}))`);
  }
  const total = await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst();
  const rows = await q
    .select([
      "pp.id",
      "pp.property_id",
      "pp.channel_key",
      "c.name as channel_name",
      "c.is_enabled as channel_enabled",
      "pp.desired_state",
      "pp.sync_status",
      "pp.external_id",
      "pp.external_url",
      "pp.attempts",
      "pp.last_attempt_at",
      "pp.last_synced_at",
      "pp.last_error",
      "pp.updated_at",
      "p.code",
      "p.title",
      "p.is_published",
    ])
    .orderBy(sql`case pp.sync_status when 'failed' then 0 when 'retrying' then 1 when 'syncing' then 2 when 'pending' then 3 when 'awaiting_credentials' then 4 else 5 end`)
    .orderBy("pp.updated_at", "desc")
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();
  return { rows, total: total?.n ?? 0, page, pageSize: PAGE_SIZE };
}
