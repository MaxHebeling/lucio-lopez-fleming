/**
 * Gestión de usuarios del equipo (staff). Reglas anti-escalamiento:
 * - Invitar, editar, desactivar: `users.manage`.
 * - Asignar o quitar un rol: `roles.manage`, o bien tener TODOS los permisos de ese rol (nunca super_admin).
 *   Así un administrador puede sumar agentes pero no crear otro administrador ni un super admin.
 * - Nadie se quita a sí mismo super_admin ni se desactiva; siempre queda al menos un super_admin activo.
 * Cada cambio se audita en la misma transacción.
 */
import { z } from "zod";
import { parseInput } from "../validate";
import { sql, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, can, requirePermission, type Actor } from "../auth/actor";
import { revokeAllSessions } from "../auth/session";
import { hashToken, newToken } from "../auth/tokens";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { queueMessage } from "../messaging/outbound";
import { cleanName, normalizeEmail, normalizePhone } from "../contacts/normalize";

export const INVITE_TTL_HOURS = 72;

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const roleKey = z.string().regex(/^[a-z_]{2,40}$/);
const uuidList = z.array(z.uuid()).max(50);

const optionalPhone = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(40).nullable().optional());

export const inviteUserSchema = z.object({
  email: z.string().trim().max(254),
  fullName: z.string().trim().min(2, "Ingresá el nombre completo").max(200),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  roles: z.array(roleKey).min(1, "Elegí al menos un rol").max(10),
  branchIds: uuidList.default([]),
});

export const updateUserProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Ingresá el nombre completo").max(200),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  publicProfile: z.boolean().default(false),
});

function normalizeWhatsapp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = normalizePhone(raw, { assumeMobile: true, defaultAreaCode: "387" });
  if (!n) throw invalid("WhatsApp inválido", { whatsapp: ["Número inválido (ej.: +54 9 387 5123456)"] });
  return n.e164;
}

/** ¿Puede el actor dar o quitar este rol? */
export async function assertCanGrantRole(db: Database | Tx, actor: Actor, role: string): Promise<void> {
  if (can(actor, "roles.manage")) return;
  if (role === "super_admin") throw forbidden("Solo quien gestiona roles puede asignar o quitar Super Admin");
  const perms = await db.selectFrom("role_permissions").select("permission_key").where("role_key", "=", role).execute();
  const missing = perms.filter((p) => !can(actor, p.permission_key));
  if (missing.length) throw forbidden(`No podés asignar o quitar el rol "${role}": incluye permisos que vos no tenés`);
}

async function validateRoles(trx: Tx, roles: string[]): Promise<void> {
  const found = await trx.selectFrom("roles").select("key").where("key", "in", roles).execute();
  if (found.length !== new Set(roles).size) throw invalid("Hay roles inexistentes", { roles: ["Rol inexistente"] });
}

async function validateBranches(trx: Tx, branchIds: string[]): Promise<void> {
  if (!branchIds.length) return;
  const found = await trx.selectFrom("branches").select("id").where("id", "in", branchIds).execute();
  if (found.length !== new Set(branchIds).size) throw invalid("Hay sucursales inexistentes", { branchIds: ["Sucursal inexistente"] });
}

async function loadStaffUser(trx: Tx, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw notFound("Usuario");
  const u = await trx
    .selectFrom("users")
    .select(["id", "email", "full_name", "phone", "whatsapp_e164", "public_profile", "is_active", sql<boolean>`password_hash is null`.as("pending_invite")])
    .where("id", "=", userId)
    .where("kind", "=", "staff")
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (!u) throw notFound("Usuario");
  return u;
}

async function activeSuperAdmins(trx: Tx, exceptUserId: string): Promise<number> {
  const r = await sql<{ n: number }>`select count(distinct u.id)::int as n from users u join user_roles ur on ur.user_id = u.id
    where ur.role_key = 'super_admin' and u.is_active and u.deleted_at is null and u.kind = 'staff' and u.id <> ${exceptUserId}`.execute(trx);
  return r.rows[0]?.n ?? 0;
}

/** Token de un solo uso para definir la contraseña (invitación) y email encolado opcional. */
async function issueInvite(trx: Tx, user: { id: string; email: string; full_name: string }, invitedBy: string | null, sendEmail: boolean) {
  const token = newToken(24);
  const row = await trx
    .insertInto("password_reset_tokens")
    .values({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const inviteUrl = `${appUrl()}/crm/restablecer?token=${encodeURIComponent(token)}&invitacion=1`;
  if (sendEmail) {
    await queueMessage(trx, {
      channel: "email",
      to: user.email,
      templateKey: "staff_invite",
      payload: { inviteUrl, resetUrl: inviteUrl, fullName: user.full_name, invitedBy, expiresInHours: INVITE_TTL_HOURS },
      dedupeKey: `staff_invite:${row.id}`,
      entityType: "user",
      entityId: user.id,
    });
  }
  return { inviteUrl, tokenId: row.id };
}

export type InviteResult = { userId: string; inviteUrl: string; emailQueued: boolean };

/**
 * Crea un usuario del equipo sin contraseña + invitación de 72 h.
 * `sendEmail: false` solo lo usa el script local de primer arranque, que imprime el link en la terminal.
 */
export async function inviteUser(db: Database, actor: Actor, raw: unknown, opts: { sendEmail?: boolean } = {}): Promise<InviteResult> {
  requirePermission(actor, "users.manage");
  const input = parseInput(inviteUserSchema, raw);
  const email = normalizeEmail(input.email);
  if (!email) throw invalid("Email inválido", { email: ["Email inválido"] });
  const fullName = cleanName(input.fullName);
  if (!fullName || fullName.length < 2) throw invalid("Nombre inválido", { fullName: ["Ingresá el nombre completo"] });
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  const roles = [...new Set(input.roles)];
  const sendEmail = opts.sendEmail ?? true;

  return db.transaction().execute(async (trx) => {
    await validateRoles(trx, roles);
    await validateBranches(trx, input.branchIds);
    for (const r of roles) await assertCanGrantRole(trx, actor, r);
    const existing = await trx.selectFrom("users").select("id").where("email", "=", email).where("deleted_at", "is", null).executeTakeFirst();
    if (existing) throw conflict("Ya existe un usuario con ese email");
    const user = await trx
      .insertInto("users")
      .values({ organization_id: actor.organizationId, kind: "staff", email, full_name: fullName, phone: input.phone ?? null, whatsapp_e164: whatsapp, password_hash: null, is_active: true })
      .returning(["id", "email", "full_name"])
      .executeTakeFirstOrThrow();
    const grantedBy = actorUserId(actor);
    await trx.insertInto("user_roles").values(roles.map((r) => ({ user_id: user.id, role_key: r, granted_by: grantedBy }))).execute();
    if (input.branchIds.length) await trx.insertInto("user_branches").values([...new Set(input.branchIds)].map((b) => ({ user_id: user.id, branch_id: b }))).execute();
    const inviter = actor.kind === "staff" ? actor.fullName : null;
    const { inviteUrl } = await issueInvite(trx, user, inviter, sendEmail);
    await audit(trx, actor, { action: "USER_INVITED", entityType: "user", entityId: user.id, after: { email, fullName, roles, branchIds: input.branchIds, emailQueued: sendEmail } });
    return { userId: user.id, inviteUrl, emailQueued: sendEmail };
  });
}

export async function resendInvite(db: Database, actor: Actor, userId: string): Promise<{ emailQueued: true }> {
  requirePermission(actor, "users.manage");
  return db.transaction().execute(async (trx) => {
    const u = await loadStaffUser(trx, userId);
    if (!u.pending_invite) throw conflict("El usuario ya definió su contraseña");
    if (!u.is_active) throw conflict("El usuario está desactivado");
    // Los links anteriores dejan de servir.
    await trx.updateTable("password_reset_tokens").set({ expires_at: new Date() }).where("user_id", "=", u.id).where("used_at", "is", null).where("expires_at", ">", new Date()).execute();
    await issueInvite(trx, u, actor.kind === "staff" ? actor.fullName : null, true);
    await audit(trx, actor, { action: "USER_INVITE_RESENT", entityType: "user", entityId: u.id });
    return { emailQueued: true as const };
  });
}

export async function updateUserProfile(db: Database, actor: Actor, userId: string, raw: unknown): Promise<void> {
  requirePermission(actor, "users.manage");
  const input = parseInput(updateUserProfileSchema, raw);
  const fullName = cleanName(input.fullName);
  if (!fullName || fullName.length < 2) throw invalid("Nombre inválido", { fullName: ["Ingresá el nombre completo"] });
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  await db.transaction().execute(async (trx) => {
    const u = await loadStaffUser(trx, userId);
    const next = { full_name: fullName, phone: input.phone ?? null, whatsapp_e164: whatsapp, public_profile: input.publicProfile };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if ((u[k] ?? null) !== (next[k] ?? null)) {
        before[k] = u[k];
        after[k] = next[k];
      }
    }
    if (!Object.keys(after).length) return;
    await trx.updateTable("users").set(next).where("id", "=", u.id).execute();
    await audit(trx, actor, { action: "USER_UPDATED", entityType: "user", entityId: u.id, before, after });
  });
}

export async function setUserRoles(db: Database, actor: Actor, userId: string, rawRoles: unknown): Promise<void> {
  requirePermission(actor, "users.manage");
  const roles = [...new Set(parseInput(z.array(roleKey).max(10), rawRoles))];
  if (!roles.length) throw invalid("Elegí al menos un rol", { roles: ["Elegí al menos un rol"] });
  await db.transaction().execute(async (trx) => {
    const u = await loadStaffUser(trx, userId);
    await validateRoles(trx, roles);
    const current = (await trx.selectFrom("user_roles").select("role_key").where("user_id", "=", u.id).execute()).map((r) => r.role_key);
    const added = roles.filter((r) => !current.includes(r));
    const removed = current.filter((r) => !roles.includes(r));
    if (!added.length && !removed.length) return;
    for (const r of [...added, ...removed]) await assertCanGrantRole(trx, actor, r);
    if (removed.includes("super_admin")) {
      if (actor.kind === "staff" && actor.userId === u.id) throw forbidden("No podés quitarte el rol Super Admin a vos mismo");
      if (u.is_active && (await activeSuperAdmins(trx, u.id)) === 0) throw conflict("Tiene que quedar al menos un Super Admin activo");
    }
    if (removed.length) await trx.deleteFrom("user_roles").where("user_id", "=", u.id).where("role_key", "in", removed).execute();
    if (added.length) await trx.insertInto("user_roles").values(added.map((r) => ({ user_id: u.id, role_key: r, granted_by: actorUserId(actor) }))).execute();
    await audit(trx, actor, { action: "USER_ROLES_CHANGED", entityType: "user", entityId: u.id, before: { roles: current }, after: { roles, added, removed } });
  });
}

export async function setUserBranches(db: Database, actor: Actor, userId: string, rawBranchIds: unknown): Promise<void> {
  requirePermission(actor, "users.manage");
  const branchIds = [...new Set(parseInput(uuidList, rawBranchIds))];
  await db.transaction().execute(async (trx) => {
    const u = await loadStaffUser(trx, userId);
    await validateBranches(trx, branchIds);
    const current = (await trx.selectFrom("user_branches").select("branch_id").where("user_id", "=", u.id).execute()).map((b) => b.branch_id);
    if (current.length === branchIds.length && current.every((b) => branchIds.includes(b))) return;
    await trx.deleteFrom("user_branches").where("user_id", "=", u.id).execute();
    if (branchIds.length) await trx.insertInto("user_branches").values(branchIds.map((b) => ({ user_id: u.id, branch_id: b }))).execute();
    await audit(trx, actor, { action: "USER_BRANCHES_CHANGED", entityType: "user", entityId: u.id, before: { branchIds: current }, after: { branchIds } });
  });
}

export async function setUserActive(db: Database, actor: Actor, userId: string, active: boolean): Promise<{ sessionsRevoked: number }> {
  requirePermission(actor, "users.manage");
  return db.transaction().execute(async (trx) => {
    const u = await loadStaffUser(trx, userId);
    if (u.is_active === active) return { sessionsRevoked: 0 };
    if (!active && actor.kind === "staff" && actor.userId === u.id) throw forbidden("No podés desactivar tu propio usuario");
    const roles = (await trx.selectFrom("user_roles").select("role_key").where("user_id", "=", u.id).execute()).map((r) => r.role_key);
    // Desactivar o reactivar a alguien con roles que uno no podría asignar también es escalamiento.
    for (const r of roles) await assertCanGrantRole(trx, actor, r);
    if (!active && roles.includes("super_admin") && (await activeSuperAdmins(trx, u.id)) === 0) throw conflict("Tiene que quedar al menos un Super Admin activo");
    await trx.updateTable("users").set({ is_active: active, ...(active ? { failed_logins: 0, locked_until: null } : {}) }).where("id", "=", u.id).execute();
    const sessionsRevoked = active ? 0 : await revokeAllSessions(trx, u.id);
    await audit(trx, actor, { action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED", entityType: "user", entityId: u.id, before: { is_active: u.is_active }, after: { is_active: active }, metadata: active ? undefined : { sessions_revoked: sessionsRevoked } });
    return { sessionsRevoked };
  });
}
