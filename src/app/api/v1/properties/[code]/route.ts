import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { notFound } from "@/server/errors";
import { apiJson, enforcePublicRateLimit } from "@/server/api/v1";
import { getPublicPropertyBySlug } from "@/server/properties/public";

export const dynamic = "force-dynamic";

/** GET /api/v1/properties/{código} — ficha pública por código. No publicadas → 404 (no revela existencia). */
export const GET = apiRoute("api.v1.properties.get", async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  await enforcePublicRateLimit(req);
  const { code } = await ctx.params;
  if (!/^\d{1,7}$/.test(code)) throw notFound("Propiedad");
  const db = getDb();
  const row = await db.selectFrom("properties").select("slug").where("code", "=", Number(code)).where("is_published", "=", true).where("is_demo", "=", false).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) throw notFound("Propiedad");
  const lookup = await getPublicPropertyBySlug(db, row.slug);
  if (lookup.kind !== "found") throw notFound("Propiedad");
  return apiJson(lookup.property);
});
