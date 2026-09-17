import { sql, type Executor } from "./db";

export type NotificationInput = {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
};

/** Notificación in-app a un usuario. Con dedupeKey no se repite. */
export async function notifyUser(db: Executor, userId: string, n: NotificationInput): Promise<void> {
  await db
    .insertInto("notifications")
    .values({
      user_id: userId,
      kind: n.kind,
      title: n.title.slice(0, 200),
      body: n.body ?? null,
      link: n.link ?? null,
      entity_type: n.entityType ?? null,
      entity_id: n.entityId ?? null,
      dedupe_key: n.dedupeKey ? `${n.dedupeKey}:${userId}` : null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .execute();
}

/** Notifica a todos los usuarios activos con un rol (super_admin siempre recibe las de administrador). */
export async function notifyRole(db: Executor, role: string, n: NotificationInput): Promise<number> {
  const roles = role === "administrador" ? ["administrador", "super_admin"] : [role];
  const users = await sql<{ id: string }>`
    select distinct u.id from users u join user_roles ur on ur.user_id = u.id
     where ur.role_key = any(${roles}) and u.is_active and u.deleted_at is null and u.kind = 'staff'`.execute(db);
  for (const u of users.rows) await notifyUser(db, u.id, n);
  return users.rows.length;
}
