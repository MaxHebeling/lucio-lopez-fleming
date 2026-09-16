"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { retryJob } from "@/server/system/jobs";

export async function retryJobAction(id: string) {
  const r = await runAction("jobs.retry", z.uuid(), id, (d, actor) => retryJob(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}
