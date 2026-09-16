import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { logout, SESSION_COOKIE } from "@/server/auth/session";

/** POST (no GET: un link o prefetch no debe cerrar la sesión). */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "origin" }, { status: 403 });
  await logout(getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.redirect(new URL("/propietarios/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
