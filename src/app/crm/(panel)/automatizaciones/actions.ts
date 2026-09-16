"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { setAutomationEnabled } from "@/server/system/automations";

export async function setAutomationEnabledAction(id: string, enabled: boolean) {
  const r = await runAction("automations.toggle", z.object({ id: z.uuid(), enabled: z.boolean() }), { id, enabled }, (d, actor) => setAutomationEnabled(getDb(), actor, d.id, d.enabled));
  if (r.ok) refresh();
  return r;
}
