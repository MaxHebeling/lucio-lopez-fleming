import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { apiJson, enforcePublicRateLimit } from "@/server/api/v1";
import { getPublicFacets } from "@/server/properties/public";
import { OPERATION_SLUGS } from "@/server/properties/public-constants";

export const dynamic = "force-dynamic";

/** GET /api/v1/facets?operacion=venta — tipos y zonas con conteos en vivo. */
export const GET = apiRoute("api.v1.facets", async (req: NextRequest) => {
  await enforcePublicRateLimit(req);
  const op = req.nextUrl.searchParams.get("operacion");
  const operation = op && op in OPERATION_SLUGS ? OPERATION_SLUGS[op as keyof typeof OPERATION_SLUGS] : undefined;
  return apiJson(await getPublicFacets(getDb(), operation));
});
