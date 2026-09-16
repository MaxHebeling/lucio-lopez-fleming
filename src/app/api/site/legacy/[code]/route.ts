import { getDb } from "@/server/db";
import { resolveLegacyPath } from "@/server/properties/public";
import { errorFields, log } from "@/server/log";
import { siteUrl } from "@/components/site/seo";

/**
 * /luciolopez-{código} (sitio anterior, vía rewrite en next.config.ts) → 301 a la ficha actual.
 * Si la propiedad ya no está publicada, 302 a la búsqueda (temporal: puede volver a publicarse).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/site/legacy/[code]">) {
  const { code } = await ctx.params;
  const base = siteUrl();
  if (!/^\d{1,7}$/.test(code)) return Response.redirect(`${base}/propiedades`, 302);
  try {
    const slug = await resolveLegacyPath(getDb(), `/luciolopez-${code}`);
    if (slug) return new Response(null, { status: 301, headers: { Location: `${base}/propiedades/${slug}`, "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    log.error("site.legacy_redirect_failed", { code, ...errorFields(e) });
  }
  return new Response(null, { status: 302, headers: { Location: `${base}/propiedades`, "Cache-Control": "no-store" } });
}
