/**
 * Acceso de propietarios al portal: invitación desde el CRM, desactivar/reactivar, cambio de email y recuperación de contraseña.
 * Tokens: se guarda solo el sha256 (password_reset_tokens); el token en claro viaja únicamente en el email encolado.
 */
import { z } from "zod";
import { sql, pgCode, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { canAny, requirePermission, requireStaff, type Actor } from "../auth/actor";
import { revokeAllSessions } from "../auth/session";
import { hashToken, newToken } from "../auth/tokens";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { queueMessage } from "../messaging/outbound";
import { normalizeEmail } from "../contacts/normalize";
import { parseInput } from "../validate";

export const INVITE_TTL_HOURS = 72;
export const RESET_TTL_HOURS = 1;

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const emailField = z.preprocess(emptyToUndefined, z.string().max(300).optional());

const inviteSchema = z.object({
  contactId: z.uuid(),
  /** Email del acceso: lo escribe la persona del equipo (no se toma de la ficha del contacto). */
  email: emailField,
  confirmEmail: emailField,
});

/** Normaliza y exige que el email y su confirmación coincidan. */
function confirmedEmail(email: string | undefined, confirm: string | undefined): string {
  const normalized = normalizeEmail(email);
  if (!normalized) throw invalid("Ingresá un email válido", { email: ["Email inválido"] });
  if (normalizeEmail(confirm) !== normalized) throw invalid("Los emails no coinciden", { confirmEmail: ["Repetí el mismo email"] });
  return normalized;
}

export type InviteResult = { userId: string; email: string; created: boolean; messageId: string | null };

/**
 * Invita (o reinvita) a un propietario: crea el usuario kind=owner vinculado al contacto si no existe,
 * genera un token de 72 h y encola el email `owner_invite`. Requiere users.manage o reports.generate.
 * El email del acceso se escribe y confirma explícitamente: la ficha del contacto puede venir de un formulario público.
 * Reinvitar usa el email del usuario; cambiarlo es `changeOwnerEmail` (users.manage).
 */
export async function inviteOwner(db: Database, actor: Actor, raw: unknown): Promise<InviteResult> {
  requireStaff(actor);
  if (!canAny(actor, ["users.manage", "reports.generate"])) throw forbidden();
  const input = parseInput(inviteSchema, raw);
  try {
    return await db.transaction().execute(async (trx) => {
      const contact = await trx
        .selectFrom("contacts")
        .select(["id", "display_name", "organization_id"])
        .where("id", "=", input.contactId)
        .where("deleted_at", "is", null)
        .where("merged_into_id", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!contact) throw notFound("Contacto");
      const isOwner = await sql<{ ok: boolean }>`select (
          exists (select 1 from property_owners where contact_id = ${contact.id})
          or exists (select 1 from rental_contract_parties where contact_id = ${contact.id} and role = 'owner')
        ) as ok`.execute(trx);
      if (!isOwner.rows[0]?.ok) throw conflict("El contacto no figura como propietario de ninguna propiedad o contrato");

      let user = await trx
        .selectFrom("users")
        .select(["id", "email", "kind", "is_active"])
        .where("contact_id", "=", contact.id)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      let created = false;
      if (user && user.kind !== "owner") throw conflict("El contacto está vinculado a un usuario del equipo");
      if (user && !user.is_active) throw conflict("El acceso de este propietario está desactivado");
      if (user && (input.email !== undefined || input.confirmEmail !== undefined) && confirmedEmail(input.email, input.confirmEmail) !== user.email) {
        throw conflict(`El acceso de este propietario usa ${user.email}. Para usar otro email, cambialo desde la gestión del acceso.`);
      }
      if (!user) {
        if (input.email === undefined) throw invalid("Escribí el email con el que el propietario va a ingresar al portal", { email: ["Email requerido"] });
        const email = confirmedEmail(input.email, input.confirmEmail);
        const taken = await trx.selectFrom("users").select("id").where("email", "=", email).where("deleted_at", "is", null).executeTakeFirst();
        if (taken) throw conflict("Ese email ya pertenece a otro usuario");
        user = await trx
          .insertInto("users")
          .values({ organization_id: contact.organization_id, kind: "owner", email, full_name: contact.display_name.slice(0, 200).padEnd(2, "."), contact_id: contact.id, password_hash: null })
          .returning(["id", "email", "kind", "is_active"])
          .executeTakeFirstOrThrow();
        created = true;
      }

      // Invitaciones anteriores sin usar quedan invalidadas.
      await trx.updateTable("password_reset_tokens").set({ used_at: new Date() }).where("user_id", "=", user.id).where("used_at", "is", null).execute();
      const token = newToken(24);
      await trx
        .insertInto("password_reset_tokens")
        .values({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000) })
        .execute();
      const messageId = await queueMessage(trx, {
        channel: "email",
        to: user.email,
        templateKey: "owner_invite",
        // Contrato de la plantilla owner_invite (src/server/messaging/templates.ts).
        payload: {
          fullName: contact.display_name.slice(0, 200),
          inviteUrl: `${appUrl()}/propietarios/restablecer?token=${token}&invitacion=1`,
          expiresHours: INVITE_TTL_HOURS,
          expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000).toISOString(),
        },
        dedupeKey: `owner_invite:${user.id}:${hashToken(token).slice(0, 16)}`,
        entityType: "user",
        entityId: user.id,
      });
      await audit(trx, actor, {
        action: created ? "OWNER_INVITED" : "OWNER_REINVITED",
        entityType: "user",
        entityId: user.id,
        after: { contactId: contact.id, email: user.email, expiresInHours: INVITE_TTL_HOURS },
      });
      return { userId: user.id, email: user.email, created, messageId };
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("Ese email o contacto ya tiene un usuario");
    throw e;
  }
}

const setActiveSchema = z.object({
  userId: z.uuid(),
  active: z.boolean(),
  reason: z.preprocess(emptyToUndefined, z.string().trim().min(3, "Indicá el motivo").max(500).optional()),
});

async function loadOwnerUserForUpdate(trx: Tx, userId: string) {
  const u = await trx
    .selectFrom("users")
    .select(["id", "email", "is_active", "contact_id"])
    .where("id", "=", userId)
    .where("kind", "=", "owner")
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (!u) throw notFound("Acceso de propietario");
  return u;
}

/** Links pendientes (invitación / recuperación) dejan de servir. */
async function invalidatePendingTokens(trx: Tx, userId: string): Promise<number> {
  const r = await trx.updateTable("password_reset_tokens").set({ used_at: new Date() }).where("user_id", "=", userId).where("used_at", "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows);
}

/**
 * Corta o restituye el acceso de un propietario al portal (users.manage). Desactivar revoca todas las sesiones y los links
 * pendientes en la misma transacción. Reactivar no envía nada: si hace falta, se reinvita.
 */
export async function setOwnerAccessActive(db: Database, actor: Actor, raw: unknown): Promise<{ sessionsRevoked: number; changed: boolean }> {
  requireStaff(actor);
  requirePermission(actor, "users.manage");
  const input = parseInput(setActiveSchema, raw);
  return db.transaction().execute(async (trx) => {
    const u = await loadOwnerUserForUpdate(trx, input.userId);
    if (u.is_active === input.active) return { sessionsRevoked: 0, changed: false };
    await trx
      .updateTable("users")
      .set({ is_active: input.active, ...(input.active ? { failed_logins: 0, locked_until: null } : {}) })
      .where("id", "=", u.id)
      .execute();
    const sessionsRevoked = input.active ? 0 : await revokeAllSessions(trx, u.id);
    const tokensInvalidated = input.active ? 0 : await invalidatePendingTokens(trx, u.id);
    await audit(trx, actor, {
      action: input.active ? "OWNER_ACCESS_REACTIVATED" : "OWNER_ACCESS_DEACTIVATED",
      entityType: "user",
      entityId: u.id,
      before: { is_active: u.is_active },
      after: { is_active: input.active },
      metadata: { contactId: u.contact_id, ...(input.reason ? { reason: input.reason } : {}), ...(input.active ? {} : { sessions_revoked: sessionsRevoked, tokens_invalidated: tokensInvalidated }) },
    });
    return { sessionsRevoked, changed: true };
  });
}

const changeEmailSchema = z.object({ userId: z.uuid(), email: emailField, confirmEmail: emailField });

/**
 * Cambia el email de acceso de un propietario (users.manage): normalizado, confirmado y único entre usuarios.
 * Revoca sesiones y links pendientes (pudieron ir al email anterior). Auditado con el email anterior y el nuevo.
 */
export async function changeOwnerEmail(db: Database, actor: Actor, raw: unknown): Promise<{ email: string; changed: boolean; sessionsRevoked: number }> {
  requireStaff(actor);
  requirePermission(actor, "users.manage");
  const input = parseInput(changeEmailSchema, raw);
  const email = confirmedEmail(input.email, input.confirmEmail);
  try {
    return await db.transaction().execute(async (trx) => {
      const u = await loadOwnerUserForUpdate(trx, input.userId);
      if (u.email === email) return { email, changed: false, sessionsRevoked: 0 };
      const taken = await trx.selectFrom("users").select("id").where("email", "=", email).where("id", "<>", u.id).where("deleted_at", "is", null).executeTakeFirst();
      if (taken) throw conflict("Ese email ya pertenece a otro usuario");
      await trx.updateTable("users").set({ email }).where("id", "=", u.id).execute();
      const sessionsRevoked = await revokeAllSessions(trx, u.id);
      const tokensInvalidated = await invalidatePendingTokens(trx, u.id);
      await audit(trx, actor, {
        action: "OWNER_EMAIL_CHANGED",
        entityType: "user",
        entityId: u.id,
        before: { email: u.email },
        after: { email },
        metadata: { contactId: u.contact_id, sessions_revoked: sessionsRevoked, tokens_invalidated: tokensInvalidated },
      });
      return { email, changed: true, sessionsRevoked };
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("Ese email ya pertenece a otro usuario");
    throw e;
  }
}

/**
 * Pedido de recuperación desde el portal. Siempre responde igual (no revela si el email existe) y solo aplica
 * a usuarios propietarios activos. El caller aplica rate limit por IP y por email.
 */
/** Todos los caminos tardan al menos esto: el tiempo no revela si existe un propietario con ese email. */
export const OWNER_RESET_MIN_RESPONSE_MS = 250;

export async function requestOwnerPasswordReset(db: Database, emailRaw: string): Promise<void> {
  const started = performance.now();
  try {
    await requestOwnerPasswordResetInner(db, emailRaw);
  } finally {
    const wait = OWNER_RESET_MIN_RESPONSE_MS - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

async function requestOwnerPasswordResetInner(db: Database, emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase().slice(0, 254);
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "full_name"])
    .where("email", "=", email)
    .where("kind", "=", "owner")
    .where("is_active", "=", true)
    // Sin contraseña = invitación pendiente: solo se activa con el link de invitación, no con "olvidé mi contraseña".
    .where("password_hash", "is not", null)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!user) return;
  const token = newToken(24);
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("password_reset_tokens")
      .values({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + RESET_TTL_HOURS * 3_600_000) })
      .execute();
    await queueMessage(trx, {
      channel: "email",
      to: user.email,
      templateKey: "owner_password_reset",
      // Contrato de la plantilla owner_password_reset (src/server/messaging/templates.ts).
      payload: {
        fullName: user.full_name,
        resetUrl: `${appUrl()}/propietarios/restablecer?token=${token}`,
        expiresMinutes: RESET_TTL_HOURS * 60,
        expiresAt: new Date(Date.now() + RESET_TTL_HOURS * 3_600_000).toISOString(),
      },
      dedupeKey: `owner_password_reset:${user.id}:${hashToken(token).slice(0, 16)}`,
      entityType: "user",
      entityId: user.id,
    });
    await trx
      .insertInto("audit_logs")
      .values({ actor_user_id: user.id, actor_kind: "owner", action: "PASSWORD_RESET_REQUESTED", entity_type: "user", entity_id: user.id })
      .execute();
  });
}

/** Solo informa si el token existe y está vigente (para mostrar el formulario). No lo consume. */
export async function isResetTokenValid(db: Database, token: string): Promise<boolean> {
  if (!token || token.length < 20 || token.length > 200) return false;
  const r = await db
    .selectFrom("password_reset_tokens as t")
    .innerJoin("users as u", "u.id", "t.user_id")
    .select("t.id")
    .where("t.token_hash", "=", hashToken(token))
    .where("t.used_at", "is", null)
    .where("t.expires_at", ">", sql<Date>`now()`)
    .where("u.kind", "=", "owner")
    .where("u.deleted_at", "is", null)
    .executeTakeFirst();
  return Boolean(r);
}

