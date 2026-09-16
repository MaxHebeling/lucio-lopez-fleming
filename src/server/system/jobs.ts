/** Panel de jobs: cola, fallidos y muertos. Reintento manual auditado (`automations.manage`). */
import { z } from "zod";
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { requirePermission, type Actor } from "../auth/actor";
import { conflict, notFound } from "../errors";
import { retryJobNow } from "../jobs/queue";
import { pageWindow, toPage, type Page } from "../pagination";

export const JOB_STATUSES = ["dead", "failed", "queued", "running", "succeeded", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobListItem = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

export async function jobCounts(db: Database, actor: Actor): Promise<Record<JobStatus, number>> {
  requirePermission(actor, "automations.read");
  const r = await sql<{ status: JobStatus; n: number }>`select status, count(*)::int as n from jobs group by status`.execute(db);
  const out = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const row of r.rows) out[row.status] = row.n;
  return out;
}

export async function listJobs(db: Database, actor: Actor, opts: { status?: string; type?: string; page?: number }): Promise<Page<JobListItem>> {
  requirePermission(actor, "automations.read");
  const status = (JOB_STATUSES as readonly string[]).includes(opts.status ?? "") ? (opts.status as JobStatus) : "dead";
  const win = pageWindow(opts.page, 50);
  let q = db.selectFrom("jobs").where("status", "=", status);
  if (opts.type && /^[a-z_]+\.[a-z_]+$/.test(opts.type)) q = q.where("type", "=", opts.type);
  const total = (await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst())?.n ?? 0;
  const items = await q
    .select(["id", "type", "status", "attempts", "max_attempts", "run_at", "last_error", "created_at", "updated_at", "finished_at"])
    .orderBy("updated_at", "desc")
    .orderBy("id")
    .limit(win.limit)
    .offset(win.offset)
    .execute();
  return toPage(items, total, win);
}

export async function getJob(db: Database, actor: Actor, id: string) {
  requirePermission(actor, "automations.read");
  if (!z.uuid().safeParse(id).success) throw notFound("Job");
  const job = await db
    .selectFrom("jobs")
    .select(["id", "type", "status", "payload", "priority", "attempts", "max_attempts", "timeout_ms", "run_at", "dedupe_key", "locked_by", "lease_expires_at", "last_error", "result", "created_at", "updated_at", "started_at", "finished_at"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!job) throw notFound("Job");
  return job;
}

export async function retryJob(db: Database, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "automations.manage");
  if (!z.uuid().safeParse(id).success) throw notFound("Job");
  await db.transaction().execute(async (trx) => {
    const job = await trx.selectFrom("jobs").select(["id", "type", "status", "attempts", "last_error"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!job) throw notFound("Job");
    if (!["dead", "failed"].includes(job.status)) throw conflict("Solo se reintentan jobs fallidos o muertos");
    const ok = await retryJobNow(trx, id);
    // 23505: ya hay otro job vivo con el mismo dedupe_key → no se duplica.
    if (!ok) throw conflict("No se pudo reintentar: el job cambió de estado");
    await audit(trx, actor, { action: "JOB_RETRIED", entityType: "job", entityId: id, before: { status: job.status, attempts: job.attempts, lastError: job.last_error }, after: { status: "queued" }, metadata: { type: job.type } });
  });
}

export async function jobTypes(db: Database, actor: Actor): Promise<string[]> {
  requirePermission(actor, "automations.read");
  const r = await sql<{ type: string }>`select distinct type from jobs order by type limit 200`.execute(db);
  return r.rows.map((x) => x.type);
}
