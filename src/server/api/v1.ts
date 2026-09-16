/**
 * API pública v1 (solo lectura): mismo contrato de datos que el sitio público (DTOs sin datos privados).
 * Pensada para feeds, portales y socios. Rate limit por IP; respuestas cacheables en CDN por 60 s.
 */
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "../db";
import { AppError } from "../errors";
import { rateLimit } from "../rate-limit";
import { clientIpFromHeaders } from "../auth/ip";

export const API_VERSION = "v1";

export async function enforcePublicRateLimit(req: NextRequest): Promise<void> {
  const ip = clientIpFromHeaders((n) => req.headers.get(n)) ?? "sin-ip";
  const r = await rateLimit(getDb(), `api:v1:${ip}`, 120, 60);
  if (!r.allowed) throw new AppError("rate_limited", "Demasiadas solicitudes. Probá en un minuto.");
}

export function apiJson(data: unknown, init: { status?: number; cacheSeconds?: number } = {}): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, data },
    {
      status: init.status ?? 200,
      headers: { "cache-control": `public, s-maxage=${init.cacheSeconds ?? 60}, stale-while-revalidate=300`, "x-robots-tag": "noindex" },
    },
  );
}

export function searchParamsToRecord(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of sp.entries()) {
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return out;
}
