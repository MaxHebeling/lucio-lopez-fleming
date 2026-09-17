"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { setFeatureFlag } from "@/server/system/integrations";

export async function setFeatureFlagAction(key: string, enabled: boolean) {
  const r = await runAction("flags.set", z.object({ key: z.string().max(80), enabled: z.boolean() }), { key, enabled }, (d, actor) => setFeatureFlag(getDb(), actor, d.key, d.enabled));
  if (r.ok) refresh();
  return r;
}
