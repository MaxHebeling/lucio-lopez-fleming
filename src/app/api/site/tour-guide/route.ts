import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { interpretTourQuestion } from "@/server/tours/guide-ai";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1024;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * «Preguntá por esta casa» con IA: devuelve SOLO una intención validada contra el tour (nunca texto para el visitante).
 * Mismo origen, cuerpo chico, rate limit por IP, flag y presupuesto. Sin IA: `{ intent: null }` y el navegador responde
 * con la capa determinista.
 */
export const POST = apiRoute("site.tour_guide", async (req: NextRequest) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ intent: null }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ intent: null }, 413);
  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ intent: null }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ intent: null }, 400);
  }
  const r = await interpretTourQuestion(getDb(), body, { ip: clientIpFromHeaders((n) => req.headers.get(n)) });
  if (r.status === "ok") return json({ intent: r.intent });
  return json({ intent: null }, r.status === "rate_limited" ? 429 : r.status === "invalid" ? 400 : 200);
});
