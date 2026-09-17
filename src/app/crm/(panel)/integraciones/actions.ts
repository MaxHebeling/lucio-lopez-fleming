"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { setFeatureFlag } from "@/server/system/integrations";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";

export async function setFeatureFlagAction(key: string, enabled: boolean) {
  const r = await runAction("flags.set", z.object({ key: z.string().max(80), enabled: z.boolean() }), { key, enabled }, (d, actor) => setFeatureFlag(getDb(), actor, d.key, d.enabled));
  if (r.ok) {
    refresh();
    // Algunos flags cambian lo que muestra el sitio cacheado (p. ej. virtual_tours): se invalida al instante.
    revalidatePublicSiteInRequest();
  }
  return r;
}
