/**
 * Recuperación de contraseña del equipo. Siempre responde lo mismo (no revela si el email existe),
 * limita por IP y por email, y solo encola el email: el envío lo hace el worker de mensajería.
 * Solo aplica a cuentas que YA tienen contraseña: una cuenta sin contraseña (invitación pendiente, agentes
 * importados) se activa exclusivamente con una invitación de un administrador.
 * Todos los caminos tardan al menos RESET_MIN_RESPONSE_MS: el tiempo no revela si la cuenta existe.
 */
import { z } from "zod";
import { parseInput } from "../validate";
import { type Database } from "../db";
import { hashToken, newToken } from "../auth/tokens";
import { consumePasswordReset } from "../auth/session";
import { log } from "../log";
import { queueMessage } from "../messaging/outbound";
import { normalizeEmail } from "../contacts/normalize";
import { rateLimit } from "../rate-limit";
import { appUrl } from "../users/service";

export const RESET_TTL_MINUTES = 60;
export const RESET_LIMITS = { ipPer15Min: 10, emailPerHour: 3 } as const;
/** Piso de tiempo de respuesta (muy por encima del trabajo real: 3 inserts en una transacción). */
export const RESET_MIN_RESPONSE_MS = 250;

export type RecoveryOutcome = "queued" | "unknown_email" | "rate_limited" | "invalid_email";

/** Devuelve el resultado interno (para tests y logs). La UI muestra SIEMPRE el mismo mensaje. */
export async function requestPasswordReset(db: Database, input: { email: string; ip?: string | null }): Promise<RecoveryOutcome> {
  const started = performance.now();
  try {
    return await requestPasswordResetInner(db, input);
  } finally {
    const wait = RESET_MIN_RESPONSE_MS - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

async function requestPasswordResetInner(db: Database, input: { email: string; ip?: string | null }): Promise<RecoveryOutcome> {
  const email = normalizeEmail(String(input.email ?? "").slice(0, 254));
  if (input.ip && !(await rateLimit(db, `pwreset:ip:${input.ip}`, RESET_LIMITS.ipPer15Min, 900)).allowed) {
    log.warn("auth.reset_rate_limited", { by: "ip" });
    return "rate_limited";
  }
  if (!email) return "invalid_email";
  if (!(await rateLimit(db, `pwreset:email:${email}`, RESET_LIMITS.emailPerHour, 3600)).allowed) {
    log.warn("auth.reset_rate_limited", { by: "email" });
    return "rate_limited";
  }
  const user = await db
    .selectFrom("users")
    .select(["id", "email", "full_name"])
    .where("email", "=", email)
    .where("kind", "=", "staff")
    .where("is_active", "=", true)
    .where("deleted_at", "is", null)
    // Sin contraseña = nunca activada: solo se activa por invitación (evita tomar cuentas importadas).
    .where("password_hash", "is not", null)
    .executeTakeFirst();
  if (!user) return "unknown_email";
  const token = newToken(24);
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("password_reset_tokens")
      .values({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) })
      .returning("id")
      .executeTakeFirstOrThrow();
    await queueMessage(trx, {
      channel: "email",
      to: user.email,
      templateKey: "password_reset",
      payload: { resetUrl: `${appUrl()}/crm/restablecer?token=${encodeURIComponent(token)}`, fullName: user.full_name, expiresInMinutes: RESET_TTL_MINUTES },
      dedupeKey: `password_reset:${row.id}`,
      entityType: "user",
      entityId: user.id,
    });
    await trx
      .insertInto("audit_logs")
      .values({ actor_user_id: null, actor_kind: "anonymous", action: "PASSWORD_RESET_REQUESTED", entity_type: "user", entity_id: user.id, ip: input.ip ?? null })
      .execute();
  });
  return "queued";
}

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(1, "Ingresá la contraseña nueva").max(200),
    confirm: z.string().max(200),
  })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden", path: ["confirm"] });

/** Define la contraseña con un token de reset o de invitación. false = token inválido, vencido o ya usado. */
export async function resetPasswordWithToken(db: Database, raw: unknown): Promise<boolean> {
  const input = parseInput(resetPasswordSchema, raw);
  return consumePasswordReset(db, input.token, input.password);
}
