/**
 * Worker de jobs. Se invoca desde /api/cron/jobs (Vercel Cron cada minuto) o `pnpm jobs:run` en local.
 * Trabaja hasta agotar la cola o el presupuesto de tiempo, lo que ocurra primero.
 */
import { randomUUID } from "node:crypto";
import type { Database } from "../db";
import { errorFields, log } from "../log";
import { TimeoutError, withTimeout } from "../resilience";
import { systemActor } from "../auth/actor";
import { organizationId } from "../org";
import { claimJobs, completeJob, failJob, recoverExpiredLeases } from "./queue";
import { getJobHandler, PermanentJobError } from "./registry";
import { notifyRole } from "../notifications";

export type RunStats = { claimed: number; succeeded: number; retried: number; dead: number; recovered: number };

export async function runJobs(db: Database, opts: { budgetMs?: number; batch?: number; workerId?: string } = {}): Promise<RunStats> {
  const workerId = opts.workerId ?? `w-${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const stats: RunStats = { claimed: 0, succeeded: 0, retried: 0, dead: 0, recovered: 0 };
  const rec = await recoverExpiredLeases(db);
  stats.recovered = rec.requeued + rec.dead;
  const orgId = await organizationId(db);

  while (Date.now() < deadline) {
    const jobs = await claimJobs(db, workerId, opts.batch ?? 5);
    if (jobs.length === 0) break;
    stats.claimed += jobs.length;
    for (const job of jobs) {
      const t0 = Date.now();
      const handler = getJobHandler(job.type);
      try {
        if (!handler) throw new PermanentJobError(`Sin handler registrado para ${job.type}`);
        const remaining = Math.max(1_000, Math.min(job.timeout_ms, deadline - Date.now() + 10_000));
        const result = await withTimeout(remaining, (signal) =>
          handler(job.payload, { db, actor: systemActor(orgId, `job:${job.type}`), jobId: job.id, attempt: job.attempts, signal }),
        );
        await completeJob(db, job.id, workerId, result);
        stats.succeeded++;
        log.info("job.succeeded", { jobId: job.id, type: job.type, attempt: job.attempts, ms: Date.now() - t0 });
      } catch (e) {
        const permanent = e instanceof PermanentJobError;
        const outcome = await failJob(db, job, workerId, (e as Error).message ?? String(e), { permanent });
        if (outcome === "dead") {
          stats.dead++;
          log.error("job.dead", { jobId: job.id, type: job.type, attempt: job.attempts, ...errorFields(e) });
          await notifyRole(db, "administrador", {
            kind: "job_dead",
            title: `Tarea automática fallida: ${job.type}`,
            body: ((e as Error).message ?? "").slice(0, 300),
            link: "/crm/sistema/jobs",
            dedupeKey: `job_dead:${job.id}`,
          }).catch((err) => log.error("job.dead_notify_failed", errorFields(err)));
        } else {
          stats.retried++;
          log.warn("job.retry", { jobId: job.id, type: job.type, attempt: job.attempts, timeout: e instanceof TimeoutError, ...errorFields(e) });
        }
      }
    }
  }
  return stats;
}
