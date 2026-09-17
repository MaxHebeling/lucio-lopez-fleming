"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { markAllNotificationsRead, markNotificationRead } from "@/server/account/notifications";

export async function markReadAction(id: string) {
  const r = await runAction("notifications.read", z.uuid(), id, (d, actor) => markNotificationRead(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function markAllReadAction() {
  const r = await runAction("notifications.read_all", z.undefined(), undefined, (_d, actor) => markAllNotificationsRead(getDb(), actor));
  if (r.ok) refresh();
  return r;
}
