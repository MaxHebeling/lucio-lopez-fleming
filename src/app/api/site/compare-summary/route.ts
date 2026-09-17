import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { summarizeComparison } from "@/server/sales/compare/service";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** Resumen redactado del comparador (solo con clave de IA; la tabla y las notas deterministas no dependen de esto). */
export const POST = apiRoute("site.compare_summary", async (req: NextRequest, { requestId }) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403, headers: noStore });
  const body = await req.text();
  if (body.length > 512) return new NextResponse(null, { status: 413, headers: noStore });
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return NextResponse.json({ status: "invalid" }, { status: 400, headers: noStore });
  }
  const r = await summarizeComparison(getDb(), raw, { ip: clientIpFromHeaders((n) => req.headers.get(n)), requestId });
  const status = r.status === "ok" ? 200 : r.status === "rate_limited" ? 429 : r.status === "not_found" ? 404 : r.status === "disabled" ? 503 : 400;
  return NextResponse.json(r, { status, headers: noStore });
});
