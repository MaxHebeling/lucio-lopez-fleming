import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeEqual } from "@/server/auth/tokens";
import { ALL_SITE_CACHE_TAGS, revalidatePublicSiteInRequest, type SiteCacheTag } from "@/server/site/revalidate";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

const body = z.object({
  tags: z.array(z.enum(ALL_SITE_CACHE_TAGS as [SiteCacheTag, ...SiteCacheTag[]])).max(10).optional(),
  reason: z.string().max(200).optional(),
});

/**
 * Invalidación del sitio público pedida por procesos fuera de Next (worker `pnpm jobs:run`, importador).
 * Autenticado con CRON_SECRET; solo acepta las etiquetas conocidas del sitio.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 32 || !safeEqual(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const ok = revalidatePublicSiteInRequest(parsed.data.tags ?? ALL_SITE_CACHE_TAGS);
  log.info("site.revalidated", { reason: parsed.data.reason ?? null, ok });
  return NextResponse.json({ ok }, { status: ok ? 200 : 500, headers: { "cache-control": "no-store" } });
}
