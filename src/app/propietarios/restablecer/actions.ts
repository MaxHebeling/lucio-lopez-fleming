"use server";

import { getDb } from "@/server/db";
import { consumePasswordReset } from "@/server/auth/session";
import { passwordPolicyError } from "@/server/auth/password";
import { isResetTokenValid } from "@/server/owners/access";
import { getRequestMeta } from "@/server/next/context";
import { rateLimit } from "@/server/rate-limit";
import { errorFields, log } from "@/server/log";

export type ResetState = { done?: boolean; error?: string };

export async function resetAction(_prev: ResetState, fd: FormData): Promise<ResetState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password !== confirm) return { error: "Las contraseñas no coinciden." };
  const policy = passwordPolicyError(password);
  if (policy) return { error: policy };
  const meta = await getRequestMeta();
  const db = getDb();
  try {
    if (meta.ip && !(await rateLimit(db, `owner-reset-consume:ip:${meta.ip}`, 10, 900)).allowed) return { error: "Demasiados intentos. Probá más tarde." };
    // Solo tokens de cuentas de propietario se consumen desde el portal.
    if (!(await isResetTokenValid(db, token))) return { error: "El link venció o ya se usó. Pedí uno nuevo." };
    const ok = await consumePasswordReset(db, token, password);
    return ok ? { done: true } : { error: "El link venció o ya se usó. Pedí uno nuevo." };
  } catch (e) {
    log.error("owners.reset_failed", { requestId: meta.requestId, ...errorFields(e) });
    return { error: "No pudimos guardar la contraseña. Probá de nuevo." };
  }
}
