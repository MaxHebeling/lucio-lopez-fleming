"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { markPropertyVerified, reviewMigrationWarning } from "@/server/migration/review";

export async function reviewWarningAction(id: string, decision: "resolved" | "dismissed") {
  const r = await runAction("migration.review_warning", z.object({ id: z.uuid(), decision: z.enum(["resolved", "dismissed"]) }), { id, decision }, (d, actor) => reviewMigrationWarning(getDb(), actor, d.id, d.decision));
  if (r.ok) refresh();
  return r;
}

export async function verifyPropertyAction(propertyId: string) {
  const r = await runAction("migration.verify_property", z.uuid(), propertyId, (d, actor) => markPropertyVerified(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}
