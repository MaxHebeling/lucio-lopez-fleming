"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { login, SESSION_COOKIE } from "@/server/auth/session";
import { getRequestMeta, sessionCookieOptions } from "@/server/next/context";
import { rateLimit } from "@/server/rate-limit";
import { isEnabled } from "@/server/flags";
import { errorFields, log } from "@/server/log";

const schema = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) });

export type OwnerLoginState = { error?: string; email?: string };

// Mensaje genérico: no revela si el email existe, si la cuenta está bloqueada o desactivada, ni si es del equipo.
const GENERIC = "No pudimos ingresar con esos datos. Revisá email y contraseña, o restablecé tu contraseña.";
const RATE_LIMITED = "Demasiados intentos. Esperá unos minutos y probá de nuevo.";

export async function ownerLoginAction(_prev: OwnerLoginState, fd: FormData): Promise<OwnerLoginState> {
  const email = typeof fd.get("email") === "string" ? String(fd.get("email")).slice(0, 254) : "";
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "Completá email y contraseña.", email };
  const meta = await getRequestMeta();
  const db = getDb();
  try {
    if (!(await isEnabled(db, "owner_portal"))) return { error: "El portal de propietarios no está disponible en este momento.", email };
    const normalized = parsed.data.email.toLowerCase();
    if (meta.ip && !(await rateLimit(db, `owner-login:ip:${meta.ip}`, 20, 300)).allowed) return { error: RATE_LIMITED, email };
    if (!(await rateLimit(db, `owner-login:email:${normalized}`, 10, 900)).allowed) return { error: RATE_LIMITED, email };
    const res = await login(db, { email: normalized, password: parsed.data.password, ip: meta.ip, userAgent: meta.userAgent, area: "owner" });
    if (!res.ok) return { error: res.reason === "rate_limited" ? RATE_LIMITED : GENERIC, email };
    (await cookies()).set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  } catch (e) {
    log.error("owners.login_failed", { requestId: meta.requestId, ...errorFields(e) });
    return { error: "No pudimos iniciar sesión. Probá de nuevo en unos minutos.", email };
  }
  redirect("/propietarios");
}
