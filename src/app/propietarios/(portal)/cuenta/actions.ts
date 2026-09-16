"use server";

import { getDb } from "@/server/db";
import { changePassword } from "@/server/auth/session";
import { passwordPolicyError } from "@/server/auth/password";
import { getActor } from "@/server/next/context";
import { errorFields, log } from "@/server/log";

export type ChangePasswordState = { ok?: boolean; error?: string };

export async function changeOwnerPasswordAction(_prev: ChangePasswordState, fd: FormData): Promise<ChangePasswordState> {
  const actor = await getActor();
  if (actor.kind !== "owner") return { error: "Iniciá sesión para continuar." };
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("password") ?? "");
  if (next !== String(fd.get("confirm") ?? "")) return { error: "Las contraseñas nuevas no coinciden." };
  const policy = passwordPolicyError(next);
  if (policy) return { error: policy };
  try {
    const r = await changePassword(getDb(), actor.userId, current, next, actor.sessionId);
    return r.ok ? { ok: true } : { error: r.reason };
  } catch (e) {
    log.error("owners.change_password_failed", { requestId: actor.requestId, ...errorFields(e) });
    return { error: "No pudimos cambiar la contraseña. Probá de nuevo." };
  }
}
