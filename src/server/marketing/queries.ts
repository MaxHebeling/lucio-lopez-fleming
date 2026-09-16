import { sql, type Database } from "../db";
import { requirePermission, type Actor } from "../auth/actor";
import { isEnabled } from "../flags";
import { notFound } from "../errors";
import { propertyImages, publicMediaUrl } from "../media/public-url";

export const QUEUE_TABS = {
  revision: { label: "Para revisar", statuses: ["draft", "in_review"] },
  aprobadas: { label: "Aprobadas y programadas", statuses: ["approved", "scheduled", "publishing"] },
  publicadas: { label: "Publicadas", statuses: ["published"] },
  problemas: { label: "Rechazadas y con error", statuses: ["failed", "rejected"] },
} as const;
export type QueueTab = keyof typeof QUEUE_TABS;

export async function socialQueue(db: Database, actor: Actor, tab: QueueTab) {
  requirePermission(actor, "marketing.read");
  const statuses = [...QUEUE_TABS[tab].statuses];
  const posts = await db
    .selectFrom("social_posts as s")
    .leftJoin("properties as p", "p.id", "s.property_id")
    .select(["s.id", "s.channel", "s.status", "s.caption", "s.scheduled_at", "s.published_at", "s.last_error", "s.created_at", "s.updated_at", "s.generated_by", "p.code", "p.title as property_title"])
    .where("s.status", "in", statuses)
    .orderBy(tab === "aprobadas" ? sql`s.scheduled_at nulls last` : sql`s.updated_at desc`)
    .limit(100)
    .execute();
  const counts = await db.selectFrom("social_posts").select(["status", sql<number>`count(*)::int`.as("n")]).groupBy("status").execute();
  const covers = posts.length
    ? await db
        .selectFrom("social_assets as a")
        .innerJoin("property_media as m", "m.id", "a.property_media_id")
        .leftJoin("files as f", "f.id", "m.file_id")
        .select(["a.social_post_id", "a.sort_order", "m.source_url", "m.status", "m.file_id", "f.visibility as file_visibility", "f.bucket as file_bucket", "f.storage_key as file_storage_key", "f.deleted_at as file_deleted_at"])
        .where("a.social_post_id", "in", posts.map((p) => p.id))
        .orderBy("a.sort_order")
        .execute()
    : [];
  const assetCount = new Map<string, number>();
  const firstAsset = new Map<string, (typeof covers)[number]>();
  for (const c of covers) {
    assetCount.set(c.social_post_id, (assetCount.get(c.social_post_id) ?? 0) + 1);
    if (!firstAsset.has(c.social_post_id)) firstAsset.set(c.social_post_id, c);
  }
  return {
    posts: await Promise.all(
      posts.map(async (p) => {
        const c = firstAsset.get(p.id);
        return { ...p, assetCount: assetCount.get(p.id) ?? 0, coverUrl: c ? await publicMediaUrl(c) : null };
      }),
    ),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
    flags: { drafts: await isEnabled(db, "social_drafts"), publishing: await isEnabled(db, "social_publishing") },
  };
}

export async function socialPostDetail(db: Database, actor: Actor, id: string) {
  requirePermission(actor, "marketing.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Publicación");
  const post = await db
    .selectFrom("social_posts as s")
    .leftJoin("properties as p", "p.id", "s.property_id")
    .leftJoin("users as ua", "ua.id", "s.approved_by")
    .select([
      "s.id", "s.channel", "s.status", "s.caption", "s.template_key", "s.generated_by", "s.scheduled_at", "s.published_at", "s.external_post_id",
      "s.approved_at", "s.rejected_reason", "s.last_error", "s.created_at", "s.updated_at", "s.property_id",
      "p.code", "p.title as property_title", "p.slug as property_slug", "ua.full_name as approved_by_name",
    ])
    .where("s.id", "=", id)
    .executeTakeFirst();
  if (!post) throw notFound("Publicación");
  const selected = await db.selectFrom("social_assets").select(["property_media_id", "sort_order"]).where("social_post_id", "=", id).orderBy("sort_order").execute();
  const images = post.property_id ? await propertyImages(db, post.property_id) : [];
  const order = new Map(selected.map((s, i) => [s.property_media_id, i]));
  return {
    post,
    images: images.map((img) => ({ id: img.id, url: img.publicUrl, isCover: img.is_cover, status: img.status, alt: img.alt_text, selectedIndex: order.get(img.id) ?? null })),
    selectedIds: selected.map((s) => s.property_media_id).filter((x): x is string => Boolean(x)),
    flags: { publishing: await isEnabled(db, "social_publishing") },
  };
}
