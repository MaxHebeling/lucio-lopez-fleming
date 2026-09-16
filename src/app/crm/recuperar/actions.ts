"use server";

import { z } from "zod";
import { getDb } from "@/server/db";
import { getRequestMeta } from "@/server/next/context";
import { requestPasswordReset } from "@/server/account/recovery";
import { errorFields, log } from "@/server/log";

export type RecoverState = { sent?: boolean; error?: string };

/** Siempre responde lo mismo (exista o no el email, o se haya limitado): no permite enumerar usuarios. */
export async function recoverAction(_prev: RecoverState, fd: FormData): Promise<RecoverState> {
  const email = z.string().trim().max(254).safeParse(fd.get("email"));
  if (!email.success || !email.data) return { error: "Ingresá tu email." };
  const meta = await getRequestMeta();
  try {
    await requestPasswordReset(getDb(), { email: email.data, ip: meta.ip });
  } catch (e) {
    log.error("auth.recover_failed", { requestId: meta.requestId, ...errorFields(e) });
  }
  return { sent: true };
}
