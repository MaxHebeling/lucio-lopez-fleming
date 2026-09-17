/**
 * Worker de jobs. Se invoca desde /api/cron/jobs (Vercel Cron cada minuto) o `pnpm jobs:run` en local.
 *
 * Garantías frente a la plataforma serverless:
 * - Toma de a UN job y solo si su timeout entra en el tiempo que le queda a la invocación.
 * - Si un handler supera su timeout NO se marca fallido (seguiría corriendo y un reintento duplicaría efectos):
 *   queda `running` con su lease; si termina dentro del lease se completa, si no, el recupero lo reintenta.
 * - Si otro worker ya recuperó el job (lease perdido), se registra en vez de contarlo como éxito.
 * - Todo job que muere avisa a administración y dispara su `onDead` (p. ej. derivar una conversación a una persona).
 */
import { randomUUID } from "node:crypto";
import type { Database } from "../db";
import { errorFields, log } from "../log";
import { TimeoutError, withTimeout } from "../resilience";
import { systemActor, type SystemActor } from "../auth/actor";
import { organizationId } from "../org";
import { claimJobs, completeJob, failJob, recoverExpiredLeases } from "./queue";
import { getJobDeadHandler, getJobHandler, PermanentJobError } from "./registry";
import { notifyRole } from "../notifications";

export type RunStats = { claimed: number; succeeded: number; retried: number; dead: number; recovered: number; timedOut: number; lostLease: number };

const SAFETY_MS = 3_000;

async function onJobDead(db: Database, actor: SystemActor, job: { id: string; type: string; payload: Record<string, unknown> }, error: string) {
  log.error("job.dead", { jobId: job.id, type: job.type, error });
  await notifyRole(db, "administrador", {
    kind: "job_dead",
    title: `Tarea automática fallida: ${job.type}`,
    body: error.slice(0, 300),
    link: "/crm/sistema/jobs",
    dedupeKey: `job_dead:${job.id}`,
  }).catch((err) => log.error("job.dead_notify_failed", errorFields(err)));
  const hook = getJobDeadHandler(job.type);
  if (hook) {
    await hook(job.payload, { db, actor, jobId: job.id, error }).catch((err) => log.error("job.dead_hook_failed", { jobId: job.id, type: job.type, ...errorFields(err) }));
  }
}

export async function runJobs(db: Database, opts: { budgetMs?: number; workerId?: string } = {}): Promise<RunStats> {
  const workerId = opts.workerId ?? `w-${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const stats: RunStats = { claimed: 0, succeeded: 0, retried: 0, dead: 0, recovered: 0, timedOut: 0, lostLease: 0 };
  const orgId = await organizationId(db);
  const actor = systemActor(orgId, "jobs");

  const rec = await recoverExpiredLeases(db);
  stats.recovered = rec.requeued + rec.dead;
  for (const job of rec.deadJobs) await onJobDead(db, actor, job, "lease vencido: el worker no terminó a tiempo");

  for (;;) {
    const remaining = deadline - Date.now() - SAFETY_MS;
    if (remaining < 1_000) break;
    const [job] = await claimJobs(db, workerId, 1, remaining);
    if (!job) break;
    stats.claimed++;
    const t0 = Date.now();
    const handler = getJobHandler(job.type);
    const jobActor = systemActor(orgId, `job:${job.type}`);
    try {
      if (!handler) throw new PermanentJobError(`Sin handler registrado para ${job.type}`);
      const ctrl = new AbortController();
      const running = handler(job.payload, { db, actor: jobActor, jobId: job.id, attempt: job.attempts, signal: ctrl.signal });
      const result = await withTimeout(job.timeout_ms, () => running).catch((e: unknown) => {
        if (e instanceof TimeoutError) {
          ctrl.abort();
          // Si el handler termina igual dentro del lease, se registra el resultado real (sin reintento duplicado).
          running
            .then((late) => completeJob(db, job.id, workerId, late).then((ok) => log.warn("job.completed_after_timeout", { jobId: job.id, type: job.type, recorded: ok })))
            .catch((err: unknown) => failJob(db, job, workerId, (err as Error).message ?? String(err)).catch(() => undefined));
        }
        throw e;
      });
      if (await completeJob(db, job.id, workerId, result)) {
        stats.succeeded++;
        log.info("job.succeeded", { jobId: job.id, type: job.type, attempt: job.attempts, ms: Date.now() - t0 });
      } else {
        stats.lostLease++;
        log.error("job.lost_lease", { jobId: job.id, type: job.type, attempt: job.attempts, ms: Date.now() - t0 });
      }
    } catch (e) {
      if (e instanceof TimeoutError) {
        // No se marca fallido: el handler puede seguir corriendo. El lease decide (ver cabecera).
        stats.timedOut++;
        log.warn("job.timeout_left_running", { jobId: job.id, type: job.type, attempt: job.attempts, timeoutMs: job.timeout_ms });
        continue;
      }
      const permanent = e instanceof PermanentJobError;
      const message = (e as Error).message ?? String(e);
      const outcome = await failJob(db, job, workerId, message, { permanent });
      if (outcome === "dead") {
        stats.dead++;
        await onJobDead(db, jobActor, job, message);
      } else {
        stats.retried++;
        log.warn("job.retry", { jobId: job.id, type: job.type, attempt: job.attempts, ...errorFields(e) });
      }
    }
  }
  return stats;
}
