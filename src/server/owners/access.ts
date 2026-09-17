/**
 * Acceso de propietarios al portal: invitación desde el CRM y recuperación de contraseña.
 * Tokens: se guarda solo el sha256 (password_reset_tokens); el token en claro viaja únicamente en el email encolado.
 */
import { z } from "zod";
import { sql, pgCode, type Database } from "../db";
import { audit } from "../audit";
import { canAny, requireStaff, type Actor } from "../auth/actor";
import { dummyHash } from "../auth/password";
import { hashToken, newToken } from "../auth/tokens";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { queueMessage } from "../messaging/outbound";

export const INVITE_TTL_HOURS = 72;
export const RESET_TTL_HOURS = 1;

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const inviteSchema = z.object({
  contactId: z.uuid(),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Email inválido").max(254).optional()),
});

export type InviteResult = { userId: string; email: string; created: boolean; messageId: string | null };

/**
 * Invita (o reinvita) a un propietario: crea el usuario kind=owner vinculado al contacto si no existe,
 * genera un token de 72 h y encola el email `owner_invite`. Requiere users.manage o reports.generate.
 */
export async function inviteOwner(db: Database, actor: Actor, raw: unknown): Promise<InviteResult> {
  requireStaff(actor);
  if (!canAny(actor, ["users.manage", "reports.generate"])) throw forbidden();
  const input = inviteSchema.parse(raw);
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
      if (!user) {
        const fallback = await trx
          .selectFrom("contact_emails")
          .select("email_normalized")
          .where("contact_id", "=", contact.id)
          .orderBy("is_primary", "desc")
          .orderBy("created_at")
          .executeTakeFirst();
        const email = (input.email ?? fallback?.email_normalized ?? "").trim().toLowerCase();
        if (!email) throw invalid("El propietario no tiene email: cargalo para invitarlo", { email: ["Email requerido"] });
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

/**
 * Pedido de recuperación desde el portal. Siempre responde igual (no revela si el email existe) y solo aplica
 * a usuarios propietarios activos. El caller aplica rate limit por IP y por email.
 */
export async function requestOwnerPasswordReset(db: Database, emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase().slice(0, 254);
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "full_name"])
    .where("email", "=", email)
    .where("kind", "=", "owner")
    .where("is_active", "=", true)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!user) {
    await dummyHash();
    return;
  }
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

