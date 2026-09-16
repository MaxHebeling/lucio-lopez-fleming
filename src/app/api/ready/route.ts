import { NextResponse, type NextRequest } from "next/server";
import { sql, dbHealth, getDb } from "@/server/db";
import { safeEqual } from "@/server/auth/tokens";

export const dynamic = "force-dynamic";

/**
 * Readiness: base accesible y migrada; cola de jobs sin muertos recientes. Devuelve 503 si no está lista.
 * El detalle (integraciones, jobs) solo con Authorization: Bearer $HEALTH_TOKEN.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const health = await dbHealth(db);
  const token = process.env.HEALTH_TOKEN;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const detailed = Boolean(token && auth && safeEqual(auth, token));

  const body: Record<string, unknown> = {
    status: health.ok ? "ready" : "not_ready",
    database: { ok: health.ok, latencyMs: health.latencyMs },
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  };
  if (detailed && health.ok) {
    const [jobs, integrations, events] = await Promise.all([
      sql<{ status: string; n: number }>`select status, count(*)::int as n from jobs where updated_at > now() - interval '24 hours' group by status`.execute(db),
      db.selectFrom("integrations").select(["key", "status", "consecutive_failures", "last_ok_at", "last_error_at"]).execute(),
      sql<{ n: number; oldest: Date | null }>`select count(*)::int as n, min(occurred_at) as oldest from domain_events where dispatched_at is null`.execute(db),
    ]);
    body.migrations = health.migrations;
    body.jobs24h = Object.fromEntries(jobs.rows.map((r) => [r.status, r.n]));
    body.pendingEvents = events.rows[0];
    body.integrations = integrations;
  } else if (!health.ok && detailed) {
    body.database = { ...health };
  }
  return NextResponse.json(body, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
