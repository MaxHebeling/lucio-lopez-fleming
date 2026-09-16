/**
 * Cola de jobs durable sobre Postgres.
 * - claim con FOR UPDATE SKIP LOCKED + lease: dos workers nunca toman el mismo job.
 * - dedupe_key: no puede haber dos jobs vivos con la misma clave (idempotencia al encolar).
 * - fallas: backoff exponencial con jitter hasta max_attempts; luego `dead` + alerta.
 */
import { sql, type Executor } from "../db";
import { backoffMs } from "../resilience";

export type JobRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  timeout_ms: number;
};

export type EnqueueInput = {
  type: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  timeoutMs?: number;
  priority?: number;
};

/** Encola un job. Devuelve el id, o null si ya había uno vivo con el mismo dedupe_key. */
export async function enqueue(db: Executor, input: EnqueueInput): Promise<string | null> {
  const r = await sql<{ id: string }>`
    insert into jobs(type, payload, dedupe_key, run_at, max_attempts, timeout_ms, priority)
    values (${input.type}, ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.dedupeKey ?? null},
            ${input.runAt ?? new Date()}, ${input.maxAttempts ?? 5}, ${input.timeoutMs ?? 30_000}, ${input.priority ?? 100})
    on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running', 'failed') do nothing
    returning id`.execute(db);
  return r.rows[0]?.id ?? null;
}

export async function claimJobs(db: Executor, workerId: string, limit: number): Promise<JobRow[]> {
  const r = await sql<JobRow>`
    with c as (
      select id from jobs
       where status in ('queued', 'failed') and run_at <= now()
       order by priority, run_at
       limit ${limit}
       for update skip locked
    )
    update jobs j set status = 'running', attempts = j.attempts + 1, locked_by = ${workerId},
           started_at = now(), lease_expires_at = now() + make_interval(secs => (j.timeout_ms + 30000) / 1000.0)
      from c where j.id = c.id
    returning j.id, j.type, j.payload, j.attempts, j.max_attempts, j.timeout_ms`.execute(db);
  return r.rows;
}

export async function completeJob(db: Executor, id: string, workerId: string, result: unknown): Promise<boolean> {
  const r = await db
    .updateTable("jobs")
    .set({ status: "succeeded", finished_at: new Date(), lease_expires_at: null, last_error: null, result: JSON.stringify(result ?? null) })
    .where("id", "=", id)
    .where("status", "=", "running")
    .where("locked_by", "=", workerId)
    .executeTakeFirst();
  return Number(r.numUpdatedRows) === 1;
}

/** Marca la falla. Devuelve 'retry' o 'dead'. */
export async function failJob(
  db: Executor,
  job: Pick<JobRow, "id" | "attempts" | "max_attempts">,
  workerId: string,
  error: string,
  opts: { permanent?: boolean; now?: Date } = {},
): Promise<"retry" | "dead"> {
  const dead = opts.permanent || job.attempts >= job.max_attempts;
  const runAt = new Date((opts.now ?? new Date()).getTime() + backoffMs(job.attempts, 30_000, 6 * 3_600_000));
  await db
    .updateTable("jobs")
    .set({
      status: dead ? "dead" : "failed",
      last_error: error.slice(0, 2000),
      lease_expires_at: null,
      locked_by: null,
      run_at: dead ? undefined : runAt,
      finished_at: dead ? new Date() : null,
    })
    .where("id", "=", job.id)
    .where("status", "=", "running")
    .where("locked_by", "=", workerId)
    .execute();
  return dead ? "dead" : "retry";
}

/** Jobs cuyo worker murió (lease vencido) vuelven a la cola o pasan a dead. */
export async function recoverExpiredLeases(db: Executor): Promise<{ requeued: number; dead: number }> {
  const r = await sql<{ status: string }>`
    update jobs set
      status = case when attempts >= max_attempts then 'dead' else 'failed' end,
      last_error = 'lease vencido: el worker no terminó a tiempo',
      locked_by = null, lease_expires_at = null,
      run_at = now() + interval '1 minute',
      finished_at = case when attempts >= max_attempts then now() else null end
    where status = 'running' and lease_expires_at < now()
    returning status`.execute(db);
  return {
    requeued: r.rows.filter((x) => x.status === "failed").length,
    dead: r.rows.filter((x) => x.status === "dead").length,
  };
}

/** Reintento manual de un job muerto o fallido (desde el panel). */
export async function retryJobNow(db: Executor, id: string): Promise<boolean> {
  const r = await sql`update jobs set status = 'queued', run_at = now(), max_attempts = greatest(max_attempts, attempts + 1),
      finished_at = null where id = ${id} and status in ('dead', 'failed')`.execute(db);
  return Number(r.numAffectedRows ?? 0) === 1;
}
