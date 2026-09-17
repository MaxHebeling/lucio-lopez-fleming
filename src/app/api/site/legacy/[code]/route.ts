import { OPERATION_TO_SLUG, filtersToQuery } from "@/server/properties/public-helpers";
import { getSiteLegacyTarget } from "@/server/site/public-data";
import { errorFields, log } from "@/server/log";
import { siteUrl } from "@/components/site/seo";

export const dynamic = "force-dynamic";

const redirect301 = (location: string) => new Response(null, { status: 301, headers: { Location: location, "Cache-Control": "public, max-age=3600" } });

/**
 * /luciolopez-{código} (sitio anterior, vía rewrite en next.config.ts):
 * - publicada → 301 a la ficha;
 * - existió pero hoy no está publicada (despublicada, archivada, borrada) → 301 a la búsqueda por su tipo, operación
 *   y localidad (conserva la intención de quien llega desde un enlace viejo);
 * - código sin rastro → 404 real, con la página "no encontrada" del sitio (enlaces para seguir).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/site/legacy/[code]">) {
  const { code } = await ctx.params;
  const base = siteUrl();
  if (/^\d{1,7}$/.test(code)) {
    try {
      const target = await getSiteLegacyTarget(`/luciolopez-${code}`);
      if (target.kind === "property") return redirect301(`${base}/propiedades/${target.slug}`);
      if (target.kind === "search") {
        const q = filtersToQuery({ tipo: target.typeKey, zona: target.zoneSlug ?? undefined, caracteristicas: [], pagina: 1 });
        const path = target.operation === "sale" || target.operation === "rent" ? `/propiedades/${OPERATION_TO_SLUG[target.operation]}` : "/propiedades";
        const extra = target.operation === "temporary_rent" ? `${q ? "&" : "?"}operacion=temporario` : "";
        return redirect301(`${base}${path}${q}${extra}`);
      }
    } catch (e) {
      log.error("site.legacy_redirect_failed", { code, ...errorFields(e) });
      // Sin base no se puede decidir: redirección temporal al listado (no se publica un 404 ni un 301 equivocados).
      return new Response(null, { status: 302, headers: { Location: `${base}/propiedades`, "Cache-Control": "no-store" } });
    }
  }
  return notFoundPage(base);
}

/** 404 con la página "no encontrada" del sitio (encabezado, pie y enlaces para seguir), servida desde esta misma app. */
async function notFoundPage(base: string): Promise<Response> {
  try {
    const res = await fetch(`${base}/sitio-anterior/codigo-inexistente`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (res.status === 404 && (res.headers.get("content-type") ?? "").includes("text/html")) {
      return new Response(await res.text(), { status: 404, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    }
  } catch (e) {
    log.warn("site.legacy_not_found_page_failed", errorFields(e));
  }
  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Página no encontrada · Lucio López Fleming</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.25rem;color:#141312;background:#f4f0ea"><h1>Esta dirección no existe.</h1><p>Puede que la propiedad ya no esté publicada o que el enlace haya cambiado.</p><ul><li><a href="${base}/propiedades">Ver propiedades</a></li><li><a href="${base}/">Ir al inicio</a></li><li><a href="${base}/contacto">Contactanos</a></li></ul></body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
