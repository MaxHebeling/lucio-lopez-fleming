import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { safeEqual } from "@/server/auth/tokens";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { enqueueScheduled } from "@/server/jobs/scheduled";
import { runJobs } from "@/server/jobs/runner";
import { errorFields, log } from "@/server/log";
import "@/server/jobs/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron (cada minuto): despacha eventos, encola tareas periódicas y procesa la cola. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 32 || !safeEqual(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  try {
    const scheduled = await enqueueScheduled(db);
    const dispatched = await dispatchPendingEvents(db);
    const stats = await runJobs(db, { budgetMs: 45_000 });
    // Eventos generados por los propios jobs se despachan en la misma pasada
    const dispatchedAfter = await dispatchPendingEvents(db);
    log.info("cron.jobs", { scheduled, dispatched, dispatchedAfter, ...stats });
    return NextResponse.json({ ok: true, scheduled, dispatched, dispatchedAfter, stats });
  } catch (e) {
    log.error("cron.jobs_failed", errorFields(e));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
