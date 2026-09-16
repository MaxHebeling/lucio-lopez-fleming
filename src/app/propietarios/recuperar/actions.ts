"use server";

import { z } from "zod";
import { getDb } from "@/server/db";
import { getRequestMeta } from "@/server/next/context";
import { rateLimit } from "@/server/rate-limit";
import { requestOwnerPasswordReset } from "@/server/owners/access";
import { errorFields, log } from "@/server/log";

export type RecoverState = { done?: boolean; error?: string };

/** Siempre la misma respuesta, exista o no el email. */
export async function recoverAction(_prev: RecoverState, fd: FormData): Promise<RecoverState> {
  const parsed = z.object({ email: z.email().max(254) }).safeParse({ email: String(fd.get("email") ?? "").trim() });
  if (!parsed.success) return { error: "Ingresá un email válido." };
  const meta = await getRequestMeta();
  const db = getDb();
  try {
    const email = parsed.data.email.toLowerCase();
    const ipOk = meta.ip ? (await rateLimit(db, `owner-reset:ip:${meta.ip}`, 5, 900)).allowed : true;
    const emailOk = (await rateLimit(db, `owner-reset:email:${email}`, 3, 3600)).allowed;
    if (ipOk && emailOk) await requestOwnerPasswordReset(db, email);
  } catch (e) {
    log.error("owners.reset_request_failed", { requestId: meta.requestId, ...errorFields(e) });
  }
  return { done: true };
}
