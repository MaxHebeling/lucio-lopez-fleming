"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { channelSchema, retrySchema, retryPublication, setPortalChannelEnabled } from "@/server/integrations/portals/service";
import type { InlineActionState } from "@/components/crm/inline-action";

export async function retryPublicationAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("publications.retry", retrySchema, { publicationId: fd.get("publicationId") }, (data, actor) => retryPublication(getDb(), actor, data));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: r.data.queued ? "Reintento en cola" : "Ya había un reintento en cola" };
}

export async function toggleChannelAction(_prev: InlineActionState, fd: FormData): Promise<InlineActionState> {
  const r = await runAction("publications.toggle_channel", channelSchema, { channelKey: fd.get("channelKey"), enabled: fd.get("enabled") === "true" }, (data, actor) =>
    setPortalChannelEnabled(getDb(), actor, data),
  );
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: r.data.changed ? "Canal actualizado" : "Sin cambios" };
}
