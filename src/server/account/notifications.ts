/** Bandeja de notificaciones in-app del usuario actual. Cada uno ve y marca solo las suyas. */
import { z } from "zod";
import { sql, type Database } from "../db";
import { requireStaff, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { pageWindow, toPage, type Page } from "../pagination";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
};

export async function listMyNotifications(db: Database, actor: Actor, opts: { unreadOnly?: boolean; page?: number } = {}): Promise<Page<NotificationItem> & { unread: number }> {
  requireStaff(actor);
  const win = pageWindow(opts.page, 30);
  let q = db.selectFrom("notifications").where("user_id", "=", actor.userId);
  if (opts.unreadOnly) q = q.where("read_at", "is", null);
  const [count, unread, items] = await Promise.all([
    q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst(),
    db.selectFrom("notifications").select(sql<number>`count(*)::int`.as("n")).where("user_id", "=", actor.userId).where("read_at", "is", null).executeTakeFirst(),
    q.select(["id", "kind", "title", "body", "link", "read_at", "created_at"]).orderBy("created_at", "desc").orderBy("id").limit(win.limit).offset(win.offset).execute(),
  ]);
  return { ...toPage(items, count?.n ?? 0, win), unread: unread?.n ?? 0 };
}

export async function markNotificationRead(db: Database, actor: Actor, id: string): Promise<void> {
  requireStaff(actor);
  if (!z.uuid().safeParse(id).success) throw notFound("Notificación");
  const r = await db.updateTable("notifications").set({ read_at: sql`coalesce(read_at, now())` }).where("id", "=", id).where("user_id", "=", actor.userId).executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw notFound("Notificación");
}

export async function markAllNotificationsRead(db: Database, actor: Actor): Promise<number> {
  requireStaff(actor);
  const r = await db.updateTable("notifications").set({ read_at: new Date() }).where("user_id", "=", actor.userId).where("read_at", "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows);
}
