import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { getClientVisitStatus, statusEtag } from "@/server/visits/public";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

/**
 * GET /api/visita/{token} — estado liviano para el polling del link del cliente (cada ~12 s, pausado en segundo plano).
 * ETag + If-None-Match → 304 sin cuerpo. Token inválido, vencido, revocado o rate limit → 404 idéntico.
 * Nunca devuelve ubicación: solo la etapa y la hora de llegada confirmada.
 */
export const GET = apiRoute("visits.client_link.status", async (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const status = await getClientVisitStatus(getDb(), token, { ip: clientIpFromHeaders((n) => req.headers.get(n)) });
  if (!status) return NextResponse.json({ error: { code: "not_found", message: "Enlace no disponible" } }, { status: 404, headers: HEADERS });
  const etag = statusEtag(status);
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ...HEADERS, ETag: etag } });
  return NextResponse.json(status, { headers: { ...HEADERS, ETag: etag } });
});
