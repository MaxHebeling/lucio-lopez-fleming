import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { interpretSearch } from "@/server/sales/concierge";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2048;
const noStore = { "cache-control": "no-store" };

/**
 * «Contanos qué buscás» → filtros reales. JSON (con JS) o formulario (sin JS: redirige 303 al listado filtrado).
 * Solo mismo origen. El texto no se guarda (ver src/server/sales/concierge.ts).
 */
export const POST = apiRoute("site.concierge", async (req: NextRequest, { requestId }) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403, headers: noStore });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return new NextResponse(null, { status: 413, headers: noStore });
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const body = await req.text();
  if (body.length > MAX_BYTES) return new NextResponse(null, { status: 413, headers: noStore });
  let text: unknown;
  if (isForm) text = new URLSearchParams(body).get("texto");
  else {
    try {
      text = (JSON.parse(body) as { text?: unknown }).text;
    } catch {
      return NextResponse.json({ status: "invalid" }, { status: 400, headers: noStore });
    }
  }
  const result = await interpretSearch(getDb(), { text }, { ip: clientIpFromHeaders((n) => req.headers.get(n)), requestId });
  if (isForm) {
    // Sin JS: al listado con los filtros entendidos (lo no interpretado no viaja en la URL).
    const target = result.status === "ok" ? result.href : "/propiedades";
    return NextResponse.redirect(new URL(target, req.nextUrl.origin), { status: 303, headers: noStore });
  }
  const status = result.status === "rate_limited" ? 429 : result.status === "invalid" ? 400 : result.status === "disabled" ? 503 : 200;
  return NextResponse.json(result, { status, headers: noStore });
});
