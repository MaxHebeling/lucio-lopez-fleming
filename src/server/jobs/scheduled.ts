/**
 * Tareas periódicas. El cron llama a `enqueueScheduled`, que encola con dedupe por período:
 * aunque el cron corra varias veces, cada tarea diaria se ejecuta una sola vez por día.
 */
import type { Database } from "../db";
import { enqueue } from "./queue";
import { registerJobHandler } from "./registry";
import { purgeRateLimits } from "../rate-limit";
import { sql } from "../db";

type Scheduled = { type: string; every: "hourly" | "daily"; timeoutMs?: number };

const schedule: Scheduled[] = [{ type: "system.housekeeping", every: "daily" }];

/** Los módulos agregan sus tareas periódicas. */
export function addScheduledTask(task: Scheduled): void {
  if (!schedule.some((s) => s.type === task.type)) schedule.push(task);
}

export async function enqueueScheduled(db: Database, now = new Date()): Promise<number> {
  let n = 0;
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  for (const s of schedule) {
    const period = s.every === "hourly" ? hour : day;
    if (await enqueue(db, { type: s.type, dedupeKey: `scheduled:${s.type}:${period}`, timeoutMs: s.timeoutMs ?? 60_000, maxAttempts: 3 })) n++;
  }
  return n;
}

registerJobHandler("system.housekeeping", async (_p, { db }) => {
  await purgeRateLimits(db);
  const sessions = await sql`delete from sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days'`.execute(db);
  const attempts = await sql`delete from login_attempts where created_at < now() - interval '90 days'`.execute(db);
  const jobs = await sql`delete from jobs where status in ('succeeded','cancelled') and finished_at < now() - interval '30 days'`.execute(db);
  return { sessions: Number(sessions.numAffectedRows ?? 0), attempts: Number(attempts.numAffectedRows ?? 0), jobs: Number(jobs.numAffectedRows ?? 0) };
});
