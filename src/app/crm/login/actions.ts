"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { login, SESSION_COOKIE } from "@/server/auth/session";
import { getRequestMeta, sessionCookieOptions } from "@/server/next/context";
import { rateLimit } from "@/server/rate-limit";
import { errorFields, log } from "@/server/log";

const schema = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200), next: z.string().optional() });

export type LoginState = { error?: string; email?: string };

const MESSAGES = {
  invalid_credentials: "Email o contraseña incorrectos.",
  locked: "Demasiados intentos. Esperá 15 minutos o restablecé tu contraseña.",
  inactive: "Tu usuario está desactivado. Consultá con administración.",
  rate_limited: "Demasiados intentos desde esta conexión. Probá más tarde.",
} as const;

/** Solo rutas internas del CRM como destino post-login (evita open redirect). */
function safeNext(next: string | undefined): string {
  return next && /^\/crm(\/[\w\-/]*)?(\?[\w=&-]*)?$/.test(next) && !next.startsWith("/crm/login") ? next : "/crm";
}

export async function loginAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password"), next: fd.get("next") ?? undefined });
  const email = typeof fd.get("email") === "string" ? String(fd.get("email")).slice(0, 254) : "";
  if (!parsed.success) return { error: "Completá email y contraseña.", email };
  const meta = await getRequestMeta();
  const db = getDb();
  try {
    if (meta.ip && !(await rateLimit(db, `login:ip:${meta.ip}`, 20, 300)).allowed) return { error: MESSAGES.rate_limited, email };
    const res = await login(db, { email: parsed.data.email, password: parsed.data.password, ip: meta.ip, userAgent: meta.userAgent, area: "staff" });
    if (!res.ok) return { error: MESSAGES[res.reason], email };
    (await cookies()).set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  } catch (e) {
    log.error("auth.login_failed", { requestId: meta.requestId, ...errorFields(e) });
    return { error: "No pudimos iniciar sesión. Probá de nuevo en unos minutos.", email };
  }
  redirect(safeNext(parsed.data.next));
}
