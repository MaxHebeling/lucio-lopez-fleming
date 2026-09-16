/**
 * Puente entre Next (cookies/headers) y la capa de servicios. Solo servidor.
 */
import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { resolveSession, SESSION_COOKIE } from "../auth/session";
import { clientIpFromHeaders } from "../auth/ip";
import { can, type Actor, type OwnerActor, type StaffActor } from "../auth/actor";
import { organizationId } from "../org";

export const getRequestMeta = cache(async () => {
  const h = await headers();
  const requestId = h.get("x-request-id") ?? randomUUID();
  return { requestId, ip: clientIpFromHeaders((n) => h.get(n)), userAgent: h.get("user-agent") };
});

/** Actor del request actual (memoizado por request). */
export const getActor = cache(async (): Promise<Actor> => {
  const db = getDb();
  const meta = await getRequestMeta();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = await resolveSession(db, token, { requestId: meta.requestId, ip: meta.ip });
  if (actor) return actor;
  return { kind: "anonymous", organizationId: await organizationId(db), requestId: meta.requestId, ip: meta.ip };
});

/** Para páginas del CRM: exige sesión de equipo y, opcionalmente, un permiso. */
export async function requireStaffPage(permission?: string): Promise<StaffActor> {
  const actor = await getActor();
  if (actor.kind !== "staff") redirect("/crm/login");
  if (actor.mustChangePassword) {
    const h = await headers();
    if (!h.get("x-pathname")?.startsWith("/crm/cuenta")) redirect("/crm/cuenta?cambiar=1");
  }
  if (permission && !can(actor, permission)) redirect("/crm?sin-permiso=1");
  return actor;
}

/** Para el portal de propietarios. */
export async function requireOwnerPage(): Promise<OwnerActor> {
  const actor = await getActor();
  if (actor.kind !== "owner") redirect("/propietarios/login");
  return actor;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
