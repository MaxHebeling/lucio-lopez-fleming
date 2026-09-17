import { z } from "zod";
import { parseInput } from "../validate";
import { sql, type Database } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { likePattern, pageWindow, toPage, type Page } from "../pagination";

export type UserListItem = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  pending_invite: boolean;
  last_login_at: Date | null;
  created_at: Date;
  roles: string[];
  branches: string[];
};

export const userFiltersSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  role: z.string().regex(/^[a-z_]{2,40}$/).optional().catch(undefined),
  status: z.enum(["active", "inactive", "invited"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});

export async function listUsers(db: Database, actor: Actor, raw: unknown): Promise<Page<UserListItem>> {
  requirePermission(actor, "users.read");
  const f = parseInput(userFiltersSchema, raw ?? {});
  const win = pageWindow(f.page, 25);
  let q = db.selectFrom("users as u").where("u.kind", "=", "staff").where("u.deleted_at", "is", null);
  if (f.q) {
    const pattern = likePattern(f.q.toLowerCase());
    q = q.where((eb) => eb.or([eb(sql`f_unaccent(lower(u.full_name))`, "like", sql`f_unaccent(${pattern})`), eb("u.email", "like", pattern)]));
  }
  if (f.role) {
    const role = f.role;
    q = q.where((eb) => eb.exists(eb.selectFrom("user_roles as ur").select("ur.user_id").whereRef("ur.user_id", "=", "u.id").where("ur.role_key", "=", role)));
  }
  if (f.status === "active") q = q.where("u.is_active", "=", true);
  if (f.status === "inactive") q = q.where("u.is_active", "=", false);
  if (f.status === "invited") q = q.where("u.password_hash", "is", null).where("u.is_active", "=", true);
  const total = (await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst())?.n ?? 0;
  const items = await q
    .select([
      "u.id",
      "u.email",
      "u.full_name",
      "u.is_active",
      sql<boolean>`u.password_hash is null`.as("pending_invite"),
      "u.last_login_at",
      "u.created_at",
      sql<string[]>`coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.key = ur.role_key where ur.user_id = u.id), '{}')`.as("roles"),
      sql<string[]>`coalesce((select array_agg(b.name order by b.name) from user_branches ub join branches b on b.id = ub.branch_id where ub.user_id = u.id), '{}')`.as("branches"),
    ])
    .orderBy("u.is_active", "desc")
    .orderBy(sql`f_unaccent(lower(u.full_name))`)
    .limit(win.limit)
    .offset(win.offset)
    .execute();
  return toPage(items, total, win);
}

export async function getUserDetail(db: Database, actor: Actor, userId: string) {
  requirePermission(actor, "users.read");
  if (!z.uuid().safeParse(userId).success) throw notFound("Usuario");
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "full_name", "phone", "whatsapp_e164", "public_profile", "is_active", sql<boolean>`password_hash is null`.as("pending_invite"), "must_change_password", "last_login_at", "locked_until", "created_at", "updated_at"])
    .where("id", "=", userId)
    .where("kind", "=", "staff")
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!user) throw notFound("Usuario");
  const [roles, branches, activeSessions, pendingInvite, auditRows] = await Promise.all([
    db.selectFrom("user_roles").select("role_key").where("user_id", "=", userId).execute(),
    db.selectFrom("user_branches").select("branch_id").where("user_id", "=", userId).execute(),
    db.selectFrom("sessions").select(sql<number>`count(*)::int`.as("n")).where("user_id", "=", userId).where("revoked_at", "is", null).where("expires_at", ">", sql<Date>`now()`).executeTakeFirst(),
    db.selectFrom("password_reset_tokens").select(["expires_at"]).where("user_id", "=", userId).where("used_at", "is", null).where("expires_at", ">", sql<Date>`now()`).orderBy("created_at", "desc").limit(1).executeTakeFirst(),
    can(actor, "audit.read")
      ? db.selectFrom("audit_logs as a").leftJoin("users as u", "u.id", "a.actor_user_id").select(["a.id", "a.occurred_at", "a.action", "a.actor_kind", "u.full_name as actor_name", "a.before", "a.after", "a.metadata"]).where("a.entity_type", "=", "user").where("a.entity_id", "=", userId).orderBy("a.occurred_at", "desc").orderBy("a.id", "desc").limit(50).execute()
      : Promise.resolve(null),
  ]);
  return {
    user,
    roleKeys: roles.map((r) => r.role_key),
    branchIds: branches.map((b) => b.branch_id),
    activeSessions: activeSessions?.n ?? 0,
    inviteExpiresAt: pendingInvite?.expires_at ?? null,
    audit: auditRows,
  };
}

export type RoleOption = { key: string; name: string; description: string | null; assignable: boolean };

/** Catálogo de roles y sucursales para formularios, marcando qué roles puede asignar el actor. */
export async function userFormOptions(db: Database, actor: Actor): Promise<{ roles: RoleOption[]; branches: Array<{ id: string; name: string }> }> {
  requirePermission(actor, "users.read");
  const [roles, perms, branches] = await Promise.all([
    db.selectFrom("roles").select(["key", "name", "description"]).orderBy(sql`array_position(array['super_admin','direccion','administrador','agente','alquileres','marketing','solo_lectura'], key)`).orderBy("name").execute(),
    db.selectFrom("role_permissions").select(["role_key", "permission_key"]).execute(),
    db.selectFrom("branches").select(["id", "name"]).where("is_active", "=", true).orderBy("is_main", "desc").orderBy("name").execute(),
  ]);
  const manageRoles = can(actor, "roles.manage");
  return {
    roles: roles.map((r) => ({
      ...r,
      assignable: can(actor, "users.manage") && (manageRoles || (r.key !== "super_admin" && perms.filter((p) => p.role_key === r.key).every((p) => can(actor, p.permission_key)))),
    })),
    branches,
  };
}
