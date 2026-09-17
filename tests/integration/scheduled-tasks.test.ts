import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { enqueueScheduled, housekeeping, listScheduledTasks, saltaDateHour } from "@/server/jobs/scheduled";
import { CRON_HEARTBEAT_KEY, recordCronHeartbeat } from "@/server/jobs/heartbeat";
import { GET as readyGET } from "@/app/api/ready/route";
import { GET as cronGET } from "@/app/api/cron/jobs/route";
import { runJobs } from "@/server/jobs/runner";
import { testDb } from "../helpers/db";

describe("tareas periódicas", () => {
  it("una tarea horaria ya ejecutada no se reencola en la siguiente pasada del cron del mismo período", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const at = new Date("2026-09-16T15:10:00Z");
    const first = await enqueueScheduled(db, at);
    expect(first).toBeGreaterThanOrEqual(5); // housekeeping + tareas de integraciones
    await runJobs(db, { budgetMs: 300_000 });
    expect(await enqueueScheduled(db, new Date("2026-09-16T15:11:00Z"))).toBe(0);
    // Nueva hora: las horarias vuelven; la diaria no
    const types = await sql<{ type: string }>`select type from jobs where status = 'queued'`.execute(db);
    expect(types.rows).toHaveLength(0);
    const nextHour = await enqueueScheduled(db, new Date("2026-09-16T16:00:00Z"));
    const hourly = listScheduledTasks().filter((t) => t.every === "hourly").length;
    expect(first).toBe(listScheduledTasks().length);
    expect(nextHour).toBe(hourly);
  });
});

describe("tareas diarias en hora de Salta", () => {
  it("fecha y hora de Salta (UTC−3)", () => {
    expect(saltaDateHour(new Date("2026-09-16T00:30:00Z"))).toEqual({ date: "2026-09-15", hour: 21 });
    expect(saltaDateHour(new Date("2026-09-16T09:00:00Z"))).toEqual({ date: "2026-09-16", hour: 6 });
  });

  it("la diaria no sale a las 21:00 de Salta del día anterior: se encola desde las 06:00 con la fecha de Salta", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const daily = () => sql<{ dedupe_key: string }>`select dedupe_key from jobs where type = 'system.housekeeping' order by created_at`.execute(db).then((r) => r.rows.map((x) => x.dedupe_key));
    // 09:00 del 15 en Salta: corre la del 15
    await enqueueScheduled(db, new Date("2026-09-15T12:00:00Z"));
    expect(await daily()).toEqual(["scheduled:system.housekeeping:2026-09-15"]);
    await sql`update jobs set status = 'succeeded', finished_at = now()`.execute(db);
    // 21:00 del 15 en Salta = 00:00Z del 16: antes salía la "del 16"; ahora sigue siendo el 15 (ya hecha)
    await enqueueScheduled(db, new Date("2026-09-16T00:00:00Z"));
    expect(await daily()).toEqual(["scheduled:system.housekeeping:2026-09-15"]);
    // 05:59 del 16 en Salta: todavía no
    await enqueueScheduled(db, new Date("2026-09-16T08:59:00Z"));
    expect(await daily()).toEqual(["scheduled:system.housekeeping:2026-09-15"]);
    // 06:00 de Salta
    await enqueueScheduled(db, new Date("2026-09-16T09:00:00Z"));
    expect(await daily()).toEqual(["scheduled:system.housekeeping:2026-09-15", "scheduled:system.housekeeping:2026-09-16"]);
    // 22:00 de Salta del mismo día (01:00Z del 17): mismo período, no se repite
    await sql`update jobs set status = 'succeeded', finished_at = now() where type = 'system.housekeeping'`.execute(db);
    await enqueueScheduled(db, new Date("2026-09-17T01:00:00Z"));
    expect(await daily()).toEqual(["scheduled:system.housekeeping:2026-09-15", "scheduled:system.housekeeping:2026-09-16"]);
  });

  it("la búsqueda por dedupe_key usa índice (no Seq Scan) y leads(conversation_id) está indexado", async () => {
    const db = testDb();
    await db.transaction().execute(async (trx) => {
      await sql`set local enable_seqscan = off`.execute(trx);
      const plan = await sql<{ "QUERY PLAN": string }>`explain select id from jobs where dedupe_key = 'scheduled:x:2026-09-16' limit 1`.execute(trx);
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/Index (Only )?Scan using jobs_dedupe_key/);
      const plan2 = await sql<{ "QUERY PLAN": string }>`explain select count(*) from leads where conversation_id = '00000000-0000-4000-8000-000000000001'`.execute(trx);
      expect(plan2.rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/leads_conversation/);
    });
  });
});

describe("retención (system.housekeeping)", () => {
  it("borra webhook_events procesados y integration_logs > 90 días e ai_interactions > 365 días; conserva lo reciente y domain_events", async () => {
    const db = testDb();
    const old = (days: number) => sql`now() - make_interval(days => ${days})`;
    await sql`insert into webhook_events(provider, external_event_id, signature_valid, payload, status, received_at) values
      ('whatsapp', 'ret-old-processed', true, '{}', 'processed', ${old(91)}),
      ('whatsapp', 'ret-old-failed', true, '{}', 'failed', ${old(120)}),
      ('whatsapp', 'ret-new-processed', true, '{}', 'processed', ${old(10)})`.execute(db);
    await sql`insert into integration_logs(integration_key, operation, status, created_at) values
      ('mercadolibre', 'ret-old', 'ok', ${old(91)}), ('mercadolibre', 'ret-new', 'ok', ${old(5)})`.execute(db);
    await sql`insert into ai_interactions(purpose, prompt_version, model, status, created_at) values
      ('whatsapp_reply', 'v1', 'ret-old', 'ok', ${old(366)}), ('whatsapp_reply', 'v1', 'ret-new', 'ok', ${old(200)})`.execute(db);
    const eventsBefore = await sql<{ n: number }>`select count(*)::int as n from domain_events`.execute(db);
    const r = await housekeeping(db);
    expect(r).toMatchObject({ webhookEvents: 1, integrationLogs: 1, aiInteractions: 1 });
    const wh = await sql<{ external_event_id: string }>`select external_event_id from webhook_events where external_event_id like 'ret-%' order by 1`.execute(db);
    expect(wh.rows.map((x) => x.external_event_id)).toEqual(["ret-new-processed", "ret-old-failed"]);
    expect((await sql<{ n: number }>`select count(*)::int as n from integration_logs where operation like 'ret-%'`.execute(db)).rows[0]!.n).toBe(1);
    expect((await sql<{ n: number }>`select count(*)::int as n from ai_interactions where model like 'ret-%'`.execute(db)).rows[0]!.n).toBe(1);
    expect((await sql<{ n: number }>`select count(*)::int as n from domain_events`.execute(db)).rows[0]!.n).toBe(eventsBefore.rows[0]!.n);
  });
});

describe("latido del cron y /api/ready", () => {
  const saved = { APP_ENV: process.env.APP_ENV, HEALTH_TOKEN: process.env.HEALTH_TOKEN, CRON_SECRET: process.env.CRON_SECRET, CRON_STALE_MINUTES: process.env.CRON_STALE_MINUTES };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const ready = (token?: string) => readyGET(new NextRequest("http://localhost/api/ready", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("cada corrida del cron guarda cron.last_run_at", async () => {
    const db = testDb();
    await sql`delete from settings where key = ${CRON_HEARTBEAT_KEY}`.execute(db);
    process.env.CRON_SECRET = "s".repeat(40);
    const res = await cronGET(new NextRequest("http://localhost/api/cron/jobs", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    expect(res.status).toBe(200);
    const row = await db.selectFrom("settings").select("value").where("key", "=", CRON_HEARTBEAT_KEY).executeTakeFirstOrThrow();
    expect(Date.now() - new Date(row.value as string).getTime()).toBeLessThan(60_000);
  });

  it("producción con cron parado más de CRON_STALE_MINUTES → 503; detalle con token: jobs muertos 24 h, backlog y eventos pendientes", async () => {
    const db = testDb();
    process.env.HEALTH_TOKEN = "t".repeat(40);
    process.env.APP_ENV = "production";
    await recordCronHeartbeat(db, new Date(Date.now() - 11 * 60_000));
    let res = await ready();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "not_ready", cron: { ok: false } });

    process.env.CRON_STALE_MINUTES = "30";
    expect((await ready()).status).toBe(200);
    delete process.env.CRON_STALE_MINUTES;

    // Fuera de producción no bloquea (preview/local sin cron)
    process.env.APP_ENV = "staging";
    expect((await ready()).status).toBe(200);

    process.env.APP_ENV = "production";
    await recordCronHeartbeat(db);
    await sql`delete from jobs`.execute(db);
    await sql`insert into jobs(type, status, attempts, max_attempts, finished_at, last_error) values ('portals.sync', 'dead', 6, 6, now() - interval '1 hour', 'x')`.execute(db);
    await sql`insert into jobs(type, status, run_at) values ('media.copy', 'queued', now() - interval '30 minutes')`.execute(db);
    res = await ready("t".repeat(40));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cron).toMatchObject({ ok: true, stale: false, staleAfterMinutes: 10 });
    expect(body.deadJobs24h).toMatchObject({ total: 1, byType: [expect.objectContaining({ type: "portals.sync", n: 1 })] });
    expect(body.queueBacklog).toMatchObject({ ready: 1 });
    expect(body.queueBacklog.oldestReadyAgeMinutes).toBeGreaterThanOrEqual(29);
    expect(body.pendingEvents).toHaveProperty("count");
    // Sin token no se expone el detalle
    const plain = await (await ready()).json();
    expect(plain.deadJobs24h).toBeUndefined();
  });
});
