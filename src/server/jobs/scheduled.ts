/**
 * Tareas periódicas. El cron llama a `enqueueScheduled`, que encola con dedupe por período:
 * aunque el cron corra varias veces, cada tarea diaria se ejecuta una sola vez por día.
 *
 * - Cada 5 minutos: período = hora UTC + bloque de 5 minutos (alertas operativas que no pueden esperar una hora).
 * - Horarias: período = hora UTC (Salta no tiene horario de verano: la hora coincide con la local).
 * - Diarias: período = FECHA DE SALTA y se encolan recién desde las 06:00 de Salta (antes, con la fecha UTC, la tarea
 *   "del día" salía a las 21:00 del día anterior en Salta).
 */
import type { Database } from "../db";
import { enqueue } from "./queue";
import { registerJobHandler } from "./registry";
import { purgeRateLimits } from "../rate-limit";
import { sql } from "../db";

type Scheduled = { type: string; every: "every_5_minutes" | "hourly" | "daily"; timeoutMs?: number };

export const SCHEDULE_TIME_ZONE = "America/Argentina/Salta";
/** Hora local de Salta desde la que se encolan las tareas diarias. */
export const DAILY_START_HOUR = 6;

const schedule: Scheduled[] = [{ type: "system.housekeeping", every: "daily" }];

/** Los módulos agregan sus tareas periódicas. */
export function addScheduledTask(task: Scheduled): void {
  if (!schedule.some((s) => s.type === task.type)) schedule.push(task);
}

/** Copia de solo lectura de la programación (para el panel y los tests). */
export function listScheduledTasks(): ReadonlyArray<Readonly<Scheduled>> {
  return schedule.map((t) => ({ ...t }));
}

const saltaFormat = new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** Fecha (YYYY-MM-DD) y hora (0–23) en Salta. */
export function saltaDateHour(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(saltaFormat.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

export async function enqueueScheduled(db: Database, now = new Date()): Promise<number> {
  let n = 0;
  const hour = now.toISOString().slice(0, 13);
  const fiveMinutes = `${hour}:${String(Math.floor(now.getUTCMinutes() / 5) * 5).padStart(2, "0")}`;
  const salta = saltaDateHour(now);
  for (const s of schedule) {
    if (s.every === "daily" && salta.hour < DAILY_START_HOUR) continue;
    const period = s.every === "every_5_minutes" ? fiveMinutes : s.every === "hourly" ? hour : salta.date;
    const dedupeKey = `scheduled:${s.type}:${period}`;
    // El índice único de jobs solo cubre jobs vivos: sin este chequeo, una tarea ya terminada se reencolaría en cada
    // pasada del cron. Usa el índice jobs_dedupe_key (0360).
    if (await db.selectFrom("jobs").select("id").where("dedupe_key", "=", dedupeKey).executeTakeFirst()) continue;
    if (await enqueue(db, { type: s.type, dedupeKey, timeoutMs: s.timeoutMs ?? 60_000, maxAttempts: 3 })) n++;
  }
  return n;
}

/** Retención de tablas que crecen sin límite. `domain_events` NO se borra (otras tablas lo referencian). */
export const RETENTION = {
  webhookEventsDays: 90,
  integrationLogsDays: 90,
  aiInteractionsDays: 365,
} as const;

const PURGE_BATCH = 5_000;
const PURGE_BATCHES_MAX = 40;

/** Borra en lotes (cada sentencia corta: no choca con statement_timeout ni bloquea la tabla). */
async function purgeInBatches(db: Database, run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < PURGE_BATCHES_MAX; i++) {
    const n = await run();
    total += n;
    if (n < PURGE_BATCH) break;
  }
  return total;
}

export async function housekeeping(db: Database): Promise<Record<string, number>> {
  await purgeRateLimits(db);
  const sessions = await sql`delete from sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days'`.execute(db);
  const attempts = await sql`delete from login_attempts where created_at < now() - interval '90 days'`.execute(db);
  const jobs = await sql`delete from jobs where status in ('succeeded','cancelled') and finished_at < now() - interval '30 days'`.execute(db);
  const webhookEvents = await purgeInBatches(db, async () =>
    Number(
      (
        await sql`delete from webhook_events where id in (
          select id from webhook_events where status in ('processed', 'ignored')
             and received_at < now() - make_interval(days => ${RETENTION.webhookEventsDays}) limit ${PURGE_BATCH})`.execute(db)
      ).numAffectedRows ?? 0,
    ),
  );
  const integrationLogs = await purgeInBatches(db, async () =>
    Number(
      (
        await sql`delete from integration_logs where id in (
          select id from integration_logs where created_at < now() - make_interval(days => ${RETENTION.integrationLogsDays}) limit ${PURGE_BATCH})`.execute(db)
      ).numAffectedRows ?? 0,
    ),
  );
  const aiInteractions = await purgeInBatches(db, async () =>
    Number(
      (
        await sql`delete from ai_interactions where id in (
          select id from ai_interactions where created_at < now() - make_interval(days => ${RETENTION.aiInteractionsDays}) limit ${PURGE_BATCH})`.execute(db)
      ).numAffectedRows ?? 0,
    ),
  );
  return {
    sessions: Number(sessions.numAffectedRows ?? 0),
    attempts: Number(attempts.numAffectedRows ?? 0),
    jobs: Number(jobs.numAffectedRows ?? 0),
    webhookEvents,
    integrationLogs,
    aiInteractions,
  };
}

registerJobHandler("system.housekeeping", async (_p, { db }) => housekeeping(db));
