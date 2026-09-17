import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { recordSiteEvent, SITE_EVENTS_MAX_BYTES } from "@/server/site/events";

export const dynamic = "force-dynamic";

const noContent = (status = 204) => new NextResponse(null, { status, headers: { "cache-control": "no-store" } });

/**
 * Eventos de analítica del sitio (sendBeacon / fetch keepalive). Sin cookies ni PII: ver src/server/site/events.ts.
 * Responde 204 aunque el evento se descarte (no da señal a quien escribe basura); 413 si el cuerpo es grande; 429 con rate limit.
 * Solo mismo origen: otro sitio no puede inflar las métricas desde el navegador de sus visitantes.
 */
export const POST = apiRoute("site.events", async (req: NextRequest) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return noContent(403);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > SITE_EVENTS_MAX_BYTES) return noContent(413);
  const text = await req.text();
  if (text.length > SITE_EVENTS_MAX_BYTES) return noContent(413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return noContent();
  }
  const privacySignal = req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1";
  const r = await recordSiteEvent(getDb(), body, { ip: clientIpFromHeaders((n) => req.headers.get(n)), privacySignal });
  return noContent(r.status === "rate_limited" ? 429 : 204);
});
