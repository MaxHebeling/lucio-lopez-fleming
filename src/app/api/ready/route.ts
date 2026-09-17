import { NextResponse, type NextRequest } from "next/server";
import { dbHealth, getDb } from "@/server/db";
import { safeEqual } from "@/server/auth/tokens";
import { cronStaleMinutes, cronStatus, queueDetail } from "@/server/jobs/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Readiness: base accesible y migrada y, en producción (APP_ENV=production), cron vivo: si la última corrida de
 * /api/cron/jobs supera CRON_STALE_MINUTES (10 por defecto) devuelve 503 (la cola, alertas y tareas estarían frenadas).
 * El detalle (integraciones, jobs muertos 24 h, backlog de la cola, eventos pendientes) solo con
 * Authorization: Bearer $HEALTH_TOKEN.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const health = await dbHealth(db);
  const token = process.env.HEALTH_TOKEN;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const detailed = Boolean(token && auth && safeEqual(auth, token));
  const production = process.env.APP_ENV === "production";

  const cron = health.ok ? await cronStatus(db, cronStaleMinutes()) : null;
  const cronBlocking = production && Boolean(cron?.stale);
  const ready = health.ok && !cronBlocking;

  const body: Record<string, unknown> = {
    status: ready ? "ready" : "not_ready",
    database: { ok: health.ok, latencyMs: health.latencyMs },
    cron: { ok: cron ? !cron.stale : false },
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  };
  if (detailed && health.ok) {
    const [queue, integrations] = await Promise.all([
      queueDetail(db),
      db.selectFrom("integrations").select(["key", "status", "consecutive_failures", "last_ok_at", "last_error_at"]).execute(),
    ]);
    body.migrations = health.migrations;
    body.cron = { ...cron, ok: !cron?.stale, blocking: cronBlocking };
    body.jobs24h = queue.jobs24h;
    body.deadJobs24h = queue.deadJobs24h;
    body.queueBacklog = queue.backlog;
    body.pendingEvents = queue.pendingEvents;
    body.integrations = integrations;
  } else if (!health.ok && detailed) {
    body.database = { ...health };
  }
  return NextResponse.json(body, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
