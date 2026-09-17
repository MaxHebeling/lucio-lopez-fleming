import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { apiJson, enforcePublicRateLimit, searchParamsToRecord } from "@/server/api/v1";
import { parseSearchFilters } from "@/server/properties/public-helpers";
import { searchPublicProperties } from "@/server/properties/public";

export const dynamic = "force-dynamic";

/** GET /api/v1/properties?operacion=venta&tipo=casa&zona=...&pagina=1 — mismos filtros que /propiedades. */
export const GET = apiRoute("api.v1.properties.list", async (req: NextRequest) => {
  await enforcePublicRateLimit(req);
  const filters = parseSearchFilters(searchParamsToRecord(req.nextUrl.searchParams));
  const result = await searchPublicProperties(getDb(), filters, 24);
  return apiJson(result);
});
