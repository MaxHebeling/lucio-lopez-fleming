"use server";

import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { resetPasswordSchema, resetPasswordWithToken } from "@/server/account/recovery";
import { rateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/server/next/context";
import { AppError } from "@/server/errors";

export async function resetPasswordAction(input: unknown) {
  return runAction("account.reset_password", resetPasswordSchema, input, async (d) => {
    const db = getDb();
    const meta = await getRequestMeta();
    if (meta.ip && !(await rateLimit(db, `pwreset:consume:ip:${meta.ip}`, 20, 900)).allowed) {
      throw new AppError("rate_limited", "Demasiados intentos. Probá de nuevo en unos minutos.");
    }
    const ok = await resetPasswordWithToken(db, d);
    if (!ok) throw new AppError("validation", "El link venció, ya se usó o no es válido. Pedí uno nuevo.");
    return { ok: true };
  });
}
