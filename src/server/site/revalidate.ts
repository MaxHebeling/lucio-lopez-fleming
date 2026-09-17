/**
 * Invalidación de la caché del sitio público.
 *
 * Las lecturas públicas (propiedades, facetas, sucursales) se guardan en la caché de datos de Next con etiquetas y un
 * vencimiento corto (SITE_REVALIDATE_SECONDS) como red de seguridad. Cuando algo cambia se invalida de inmediato:
 * - Server Actions y route handlers del CRM: `revalidatePublicSite()` después del servicio (misma petición).
 * - Cambios que no pasan por la UI (alquileres que marcan una propiedad alquilada, jobs, importador): la automatización
 *   de sistema `revalidate_public_site` escucha los eventos property.* y corre dentro del cron (/api/cron/jobs).
 * - Procesos fuera de Next (`pnpm jobs:run`, scripts): `revalidateTag` no tiene contexto de petición y lanza, así que
 *   se pide la invalidación por HTTP a /api/site/revalidate (autenticado con CRON_SECRET), el camino documentado para
 *   invalidar desde otro proceso.
 */
import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { registerAction } from "../automation/actions";
import { errorFields, log } from "../log";

export const SITE_CACHE_TAGS = { properties: "site:properties", info: "site:info" } as const;
export type SiteCacheTag = (typeof SITE_CACHE_TAGS)[keyof typeof SITE_CACHE_TAGS];
export const ALL_SITE_CACHE_TAGS: SiteCacheTag[] = Object.values(SITE_CACHE_TAGS);

/** Vencimiento de respaldo de la caché pública (segundos). Las páginas ISR usan el mismo valor literal (Next exige un literal). */
export const SITE_REVALIDATE_SECONDS = 300;

/**
 * Invalida en esta misma petición (Server Action o route handler). Además de las etiquetas de datos se invalida el
 * layout raíz: así también se descartan las páginas ya generadas (home, fichas ISR, incluso una ficha que quedó en 404).
 * Devuelve false si no hay contexto de petición de Next (script o worker).
 */
export function revalidatePublicSiteInRequest(tags: SiteCacheTag[] = ALL_SITE_CACHE_TAGS): boolean {
  try {
    for (const tag of tags) revalidateTag(tag, { expire: 0 });
    revalidatePath("/", "layout");
    return true;
  } catch (e) {
    // Esperado en procesos fuera de Next ("static generation store missing"): se sigue por HTTP. Otro error se registra.
    if (/store missing/i.test((e as Error).message)) log.info("site.revalidate_outside_request");
    else log.warn("site.revalidate_in_request_failed", errorFields(e));
    return false;
  }
}

/** Pide la invalidación al servidor por HTTP (procesos fuera de Next). Sin APP_URL o CRON_SECRET no hace nada: queda el vencimiento. */
export async function requestPublicSiteRevalidation(tags: SiteCacheTag[] = ALL_SITE_CACHE_TAGS, reason = "externo"): Promise<boolean> {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    log.warn("site.revalidate_http_unconfigured", { reason });
    return false;
  }
  try {
    const res = await fetch(`${base}/api/site/revalidate`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ tags, reason }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn("site.revalidate_http_failed", { reason, status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("site.revalidate_http_failed", { reason, ...errorFields(e) });
    return false;
  }
}

/** Invalida desde cualquier contexto: en la petición si se puede; si no, por HTTP. Nunca lanza (queda el vencimiento corto). */
export async function revalidatePublicSite(reason: string, tags: SiteCacheTag[] = ALL_SITE_CACHE_TAGS): Promise<{ via: "request" | "http" | "none" }> {
  if (revalidatePublicSiteInRequest(tags)) return { via: "request" };
  return { via: (await requestPublicSiteRevalidation(tags, reason)) ? "http" : "none" };
}

// Automatización de sistema (db/migrations/0410): eventos property.* → invalidar el sitio público. Idempotente por naturaleza.
registerAction("revalidate_public_site", async (_params, ctx) => {
  const r = await revalidatePublicSite(`${ctx.event.type}:${ctx.event.aggregateId}`);
  return { revalidated: r.via };
});
