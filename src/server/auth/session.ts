/**
 * Sesiones con cookie httpOnly + tabla sessions. El token en claro vive solo en la cookie;
 * en la base se guarda su sha256. Sirve tanto al equipo (staff) como a propietarios (owner).
 */
import { sql, type Database, type Executor } from "../db";
import { hashToken, newToken } from "./tokens";
import { dummyHash, hashPassword, verifyPassword } from "./password";
import { normalizeIp } from "./ip";
import type { OwnerActor, StaffActor } from "./actor";

export const SESSION_COOKIE = "llf_session";
export const SESSION_TTL_DAYS = 14;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const IP_FAILURE_LIMIT = 30; // por 15 minutos

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; kind: "staff" | "owner"; userId: string }
  | { ok: false; reason: "invalid_credentials" | "locked" | "inactive" | "rate_limited" };

export async function login(
  db: Database,
  input: { email: string; password: string; ip?: string | null; userAgent?: string | null; area: "staff" | "owner" },
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase().slice(0, 254);
  const ip = normalizeIp(input.ip);
  const userAgent = input.userAgent ? input.userAgent.slice(0, 512) : null;

  if (ip) {
    const r = await sql<{ n: number }>`select count(*)::int as n from login_attempts
      where ip = ${ip}::inet and not success and created_at > now() - interval '15 minutes'`.execute(db);
    if ((r.rows[0]?.n ?? 0) >= IP_FAILURE_LIMIT) return { ok: false, reason: "rate_limited" };
  }

  const record = (success: boolean) =>
    db.insertInto("login_attempts").values({ email, ip, success }).execute();

  const user = await db
    .selectFrom("users")
    .select(["id", "kind", "password_hash", "is_active", "failed_logins", "locked_until"])
    .where("email", "=", email)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  // Cuenta inexistente o de otra área: mismo costo y misma respuesta que una contraseña incorrecta.
  if (!user || user.kind !== input.area) {
    await verifyPassword(await dummyHash(), input.password);
    await record(false);
    const f = await sql<{ n: number }>`select count(*)::int as n from login_attempts
      where email = ${email} and not success and created_at > now() - make_interval(mins => ${LOCK_MINUTES})`.execute(db);
    return { ok: false, reason: (f.rows[0]?.n ?? 0) >= MAX_FAILED_LOGINS ? "locked" : "invalid_credentials" };
  }

  if (user.locked_until && user.locked_until > new Date()) {
    await record(false);
    return { ok: false, reason: "locked" };
  }

  if (!(await verifyPassword(user.password_hash, input.password))) {
    await record(false);
    const failed = (user.locked_until ? 0 : user.failed_logins) + 1;
    await sql`update users set failed_logins = ${failed},
      locked_until = case when ${failed} >= ${MAX_FAILED_LOGINS} then now() + make_interval(mins => ${LOCK_MINUTES}) else null end
      where id = ${user.id}`.execute(db);
    return { ok: false, reason: failed >= MAX_FAILED_LOGINS ? "locked" : "invalid_credentials" };
  }

  if (!user.is_active) {
    await record(false);
    return { ok: false, reason: "inactive" };
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("login_attempts").values({ email, ip, success: true }).execute();
    await trx
      .updateTable("users")
      .set({ failed_logins: 0, locked_until: null, last_login_at: new Date() })
      .where("id", "=", user.id)
      .execute();
    await trx
      .insertInto("sessions")
      .values({ user_id: user.id, token_hash: hashToken(token), user_agent: userAgent, ip, expires_at: expiresAt })
      .execute();
    await trx
      .insertInto("audit_logs")
      .values({
        actor_user_id: user.id,
        actor_kind: user.kind === "owner" ? "owner" : "user",
        action: "LOGIN",
        entity_type: "user",
        entity_id: user.id,
        ip,
      })
      .execute();
  });
  return { ok: true, token, expiresAt, kind: user.kind as "staff" | "owner", userId: user.id };
}

/**
 * Resuelve el actor desde el token de la cookie. Desliza la expiración (con throttle) pero nunca más allá
 * de SESSION_TTL_DAYS desde el login: un token robado no se mantiene vivo indefinidamente.
 */
export async function resolveSession(
  db: Database,
  token: string | undefined | null,
  ctx: { requestId?: string; ip?: string | null } = {},
): Promise<StaffActor | OwnerActor | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await db
    .selectFrom("sessions as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .select([
      "s.id as session_id",
      "s.last_seen_at",
      "u.id as user_id",
      "u.organization_id",
      "u.kind",
      "u.email",
      "u.full_name",
      "u.contact_id",
      "u.must_change_password",
      "u.is_active",
    ])
    .where("s.token_hash", "=", hashToken(token))
    .where("s.revoked_at", "is", null)
    .where("s.expires_at", ">", sql<Date>`now()`)
    .where("s.created_at", ">", sql<Date>`now() - make_interval(days => ${SESSION_TTL_DAYS})`)
    .where("u.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row || !row.is_active) return null;

  if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000) {
    await sql`update sessions set last_seen_at = now(),
      expires_at = least(greatest(expires_at, now() + interval '7 days'), created_at + make_interval(days => ${SESSION_TTL_DAYS}))
      where id = ${row.session_id}`.execute(db);
  }

  const common = {
    organizationId: row.organization_id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    sessionId: row.session_id,
    mustChangePassword: row.must_change_password,
    requestId: ctx.requestId,
    ip: ctx.ip ?? null,
  };

  if (row.kind === "owner") {
    if (!row.contact_id) return null;
    return { kind: "owner", ...common, contactId: row.contact_id };
  }

  const [roles, perms, branches] = await Promise.all([
    db.selectFrom("user_roles").select("role_key").where("user_id", "=", row.user_id).execute(),
    db
      .selectFrom("user_roles as ur")
      .innerJoin("role_permissions as rp", "rp.role_key", "ur.role_key")
      .select("rp.permission_key")
      .distinct()
      .where("ur.user_id", "=", row.user_id)
      .execute(),
    db.selectFrom("user_branches").select("branch_id").where("user_id", "=", row.user_id).execute(),
  ]);
  return {
    kind: "staff",
    ...common,
    roles: roles.map((r) => r.role_key),
    permissions: new Set(perms.map((p) => p.permission_key)),
    branchIds: branches.map((b) => b.branch_id),
  };
}

export async function logout(db: Database, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db
    .updateTable("sessions")
    .set({ revoked_at: new Date() })
    .where("token_hash", "=", hashToken(token))
    .where("revoked_at", "is", null)
    .execute();
}

export async function revokeAllSessions(db: Executor, userId: string, exceptSessionId?: string): Promise<number> {
  let q = db.updateTable("sessions").set({ revoked_at: new Date() }).where("user_id", "=", userId).where("revoked_at", "is", null);
  if (exceptSessionId) q = q.where("id", "<>", exceptSessionId);
  const r = await q.executeTakeFirst();
  return Number(r.numUpdatedRows);
}

/** Crea un token de restablecimiento (1 hora). null si el email no existe (la UI responde igual). */
export async function createPasswordReset(db: Database, email: string): Promise<{ token: string; userId: string } | null> {
  const u = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email.trim().toLowerCase())
    .where("deleted_at", "is", null)
    .where("is_active", "=", true)
    .executeTakeFirst();
  if (!u) {
    await dummyHash();
    return null;
  }
  const token = newToken(24);
  await db
    .insertInto("password_reset_tokens")
    .values({ user_id: u.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + 3_600_000) })
    .execute();
  return { token, userId: u.id };
}

/**
 * Consume el token de forma atómica (dos requests simultáneas no pueden usarlo), cambia la contraseña,
 * invalida los demás tokens, revoca TODAS las sesiones y audita.
 */
export async function consumePasswordReset(db: Database, token: string, newPassword: string): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);
  return db.transaction().execute(async (trx) => {
    const r = await trx
      .updateTable("password_reset_tokens")
      .set({ used_at: new Date() })
      .where("token_hash", "=", hashToken(token))
      .where("used_at", "is", null)
      .where("expires_at", ">", sql<Date>`now()`)
      .returning("user_id")
      .executeTakeFirst();
    if (!r) return false;
    const u = await trx
      .updateTable("users")
      .set({ password_hash: passwordHash, must_change_password: false, failed_logins: 0, locked_until: null })
      .where("id", "=", r.user_id)
      .where("deleted_at", "is", null)
      .where("is_active", "=", true)
      .returning(["id", "kind"])
      .executeTakeFirst();
    if (!u) return false;
    await trx.updateTable("password_reset_tokens").set({ used_at: new Date() }).where("user_id", "=", u.id).where("used_at", "is", null).execute();
    const revoked = await revokeAllSessions(trx, u.id);
    await trx
      .insertInto("audit_logs")
      .values({
        actor_user_id: u.id,
        actor_kind: u.kind === "owner" ? "owner" : "user",
        action: "PASSWORD_RESET",
        entity_type: "user",
        entity_id: u.id,
        metadata: JSON.stringify({ sessions_revoked: revoked }),
      })
      .execute();
    return true;
  });
}

export async function changePassword(
  db: Database,
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const passwordHash = await hashPassword(newPassword);
  return db.transaction().execute(async (trx) => {
    const cur = await trx
      .selectFrom("users")
      .select(["password_hash", "kind"])
      .where("id", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (!cur || !(await verifyPassword(cur.password_hash, currentPassword)))
      return { ok: false as const, reason: "La contraseña actual no es correcta" };
    if (await verifyPassword(cur.password_hash, newPassword))
      return { ok: false as const, reason: "La nueva contraseña debe ser distinta a la actual" };
    await trx.updateTable("users").set({ password_hash: passwordHash, must_change_password: false }).where("id", "=", userId).execute();
    const revoked = await revokeAllSessions(trx, userId, keepSessionId);
    await trx
      .insertInto("audit_logs")
      .values({
        actor_user_id: userId,
        actor_kind: cur.kind === "owner" ? "owner" : "user",
        action: "PASSWORD_CHANGED",
        entity_type: "user",
        entity_id: userId,
        metadata: JSON.stringify({ sessions_revoked: revoked }),
      })
      .execute();
    return { ok: true as const };
  });
}
