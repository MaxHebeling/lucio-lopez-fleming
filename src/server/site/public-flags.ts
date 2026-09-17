/**
 * Flags que cambian lo que muestra el sitio público (IA Fase 2: concierge, preguntas, comparador, señales).
 * Se leen dentro de la caché del sitio: cambiar un flag desde Integraciones invalida el sitio al instante
 * (`revalidatePublicSiteInRequest` en la acción de flags). Flag desconocido = apagado.
 */
import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getDb } from "../db";
import { isEnabled } from "../flags";
import { readPublic } from "./public-data";
import { SITE_CACHE_TAGS, SITE_REVALIDATE_SECONDS } from "./revalidate";

export const SITE_SALES_FLAGS = ["ai_concierge", "ai_matching", "ai_property_qa", "site_compare"] as const;
export type SiteSalesFlag = (typeof SITE_SALES_FLAGS)[number];

const flagCached = unstable_cache(async (key: SiteSalesFlag) => isEnabled(getDb(), key), ["site", "flag", "v1"], { tags: [SITE_CACHE_TAGS.properties, SITE_CACHE_TAGS.info], revalidate: SITE_REVALIDATE_SECONDS });

export const getSiteFlag = cache((key: SiteSalesFlag) => readPublic(() => flagCached(key)));

/** ¿Hay clave del proveedor de IA? (solo para no ofrecer botones que requieren el modelo). */
export function siteAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}
