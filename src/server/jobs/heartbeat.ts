/**
 * Latido del cron: cada corrida de /api/cron/jobs guarda `settings['cron.last_run_at']`. /api/ready lo usa para
 * detectar un cron que dejó de correr (la cola, las alertas y las tareas diarias se frenarían en silencio).
 */
import { sql, type Database } from "../db";

export const CRON_HEARTBEAT_KEY = "cron.last_run_at";
export const DEFAULT_CRON_STALE_MINUTES = 10;

export async function recordCronHeartbeat(db: Database, now = new Date()): Promise<void> {
  await sql`insert into settings(key, value, updated_at) values (${CRON_HEARTBEAT_KEY}, ${JSON.stringify(now.toISOString())}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`.execute(db);
}

export function cronStaleMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CRON_STALE_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CRON_STALE_MINUTES;
}

export type CronStatus = { lastRunAt: string | null; ageMinutes: number | null; stale: boolean; staleAfterMinutes: number };

export async function cronStatus(db: Database, staleAfterMinutes: number, now = new Date()): Promise<CronStatus> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", CRON_HEARTBEAT_KEY).executeTakeFirst();
  const raw = typeof row?.value === "string" ? row.value : null;
  const at = raw ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) return { lastRunAt: null, ageMinutes: null, stale: true, staleAfterMinutes };
  const ageMinutes = Math.max(0, (now.getTime() - at.getTime()) / 60_000);
  return { lastRunAt: at.toISOString(), ageMinutes: Math.round(ageMinutes * 10) / 10, stale: ageMinutes > staleAfterMinutes, staleAfterMinutes };
}

/** Detalle operativo de la cola para /api/ready (solo con token). */
export async function queueDetail(db: Database) {
  const [jobs24h, dead24h, backlog, events] = await Promise.all([
    sql<{ status: string; n: number }>`select status, count(*)::int as n from jobs where updated_at > now() - interval '24 hours' group by status`.execute(db),
    sql<{ type: string; n: number; last: Date }>`select type, count(*)::int as n, max(finished_at) as last from jobs
      where status = 'dead' and finished_at > now() - interval '24 hours' group by type order by n desc limit 20`.execute(db),
    sql<{ ready: number; oldest_ready_at: Date | null; scheduled: number; running: number }>`select
        count(*) filter (where status in ('queued', 'failed') and run_at <= now())::int as ready,
        min(run_at) filter (where status in ('queued', 'failed') and run_at <= now()) as oldest_ready_at,
        count(*) filter (where status in ('queued', 'failed') and run_at > now())::int as scheduled,
        count(*) filter (where status = 'running')::int as running
      from jobs where status in ('queued', 'failed', 'running')`.execute(db),
    sql<{ n: number; oldest: Date | null }>`select count(*)::int as n, min(occurred_at) as oldest from domain_events where dispatched_at is null`.execute(db),
  ]);
  const b = backlog.rows[0];
  return {
    jobs24h: Object.fromEntries(jobs24h.rows.map((r) => [r.status, r.n])),
    deadJobs24h: { total: dead24h.rows.reduce((a, r) => a + r.n, 0), byType: dead24h.rows },
    backlog: {
      ready: b?.ready ?? 0,
      oldestReadyAt: b?.oldest_ready_at ?? null,
      oldestReadyAgeMinutes: b?.oldest_ready_at ? Math.round((Date.now() - new Date(b.oldest_ready_at).getTime()) / 6_000) / 10 : null,
      scheduled: b?.scheduled ?? 0,
      running: b?.running ?? 0,
    },
    pendingEvents: { count: events.rows[0]?.n ?? 0, oldest: events.rows[0]?.oldest ?? null },
  };
}
