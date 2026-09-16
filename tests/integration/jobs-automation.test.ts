import { describe, expect, it } from "vitest";
import "@/server/automation/base-actions";
import { sql } from "@/server/db";
import { enqueue, claimJobs, failJob, recoverExpiredLeases } from "@/server/jobs/queue";
import { registerJobHandler } from "@/server/jobs/registry";
import { runJobs } from "@/server/jobs/runner";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { emitEvent } from "@/server/events";
import { createStaff, testDb, testSystemActor } from "../helpers/db";

describe("cola de jobs", () => {
  it("dedupe_key impide dos jobs vivos iguales", async () => {
    const db = testDb();
    const a = await enqueue(db, { type: "test.noop", dedupeKey: "k1" });
    const b = await enqueue(db, { type: "test.noop", dedupeKey: "k1" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("dos workers concurrentes nunca toman el mismo job", async () => {
    const db = testDb();
    for (let i = 0; i < 10; i++) await enqueue(db, { type: "test.concurrent", payload: { i } });
    const [w1, w2] = await Promise.all([claimJobs(db, "w1", 10), claimJobs(db, "w2", 10)]);
    const ids = [...w1, ...w2].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it("falla → reintento con backoff → dead al agotar intentos", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    await enqueue(db, { type: "test.fail", maxAttempts: 2 });
    let [job] = await claimJobs(db, "w", 1);
    expect(await failJob(db, job!, "w", "boom")).toBe("retry");
    await sql`update jobs set run_at = now() where id = ${job!.id}`.execute(db);
    [job] = await claimJobs(db, "w", 1);
    expect(job!.attempts).toBe(2);
    expect(await failJob(db, job!, "w", "boom")).toBe("dead");
  });

  it("recupera jobs con lease vencido (worker caído)", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    await enqueue(db, { type: "test.lease" });
    const [job] = await claimJobs(db, "muerto", 1);
    await sql`update jobs set lease_expires_at = now() - interval '1 second' where id = ${job!.id}`.execute(db);
    expect(await recoverExpiredLeases(db)).toEqual({ requeued: 1, dead: 0 });
  });

  it("runJobs ejecuta handlers, reintenta y alerta a administración cuando un job muere", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const admin = await createStaff(db, ["administrador"]);
    registerJobHandler("test.ok", async (p) => ({ echo: p.v }));
    registerJobHandler("test.boom", async () => {
      throw new Error("siempre falla");
    });
    await enqueue(db, { type: "test.ok", payload: { v: 1 } });
    await enqueue(db, { type: "test.boom", maxAttempts: 1 });
    const stats = await runJobs(db, { budgetMs: 5_000 });
    expect(stats.succeeded).toBe(1);
    expect(stats.dead).toBe(1);
    const notes = await db.selectFrom("notifications").select("kind").where("user_id", "=", admin.userId).execute();
    expect(notes.map((n) => n.kind)).toContain("job_dead");
  });
});

describe("motor de automatizaciones", () => {
  it("lead.created → notificación + UNA tarea, aunque el job se ejecute dos veces", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const agent = await createStaff(db, ["agente"]);
    const system = await testSystemActor(db);
    const leadId = "00000000-0000-4000-8000-000000000001";
    await emitEvent(db, system, { type: "lead.created", aggregateType: "lead", aggregateId: leadId, payload: { assignedUserId: agent.userId, summary: "Consulta web" } });
    const d = await dispatchPendingEvents(db);
    expect(d.events).toBe(1);
    expect(d.jobs).toBe(1);
    // Segundo despacho: el evento ya está despachado, no genera más jobs
    expect((await dispatchPendingEvents(db)).jobs).toBe(0);

    await runJobs(db, { budgetMs: 5_000 });
    // Simula reejecución (p. ej. timeout tras commit): reencola el mismo run
    const ev = await db.selectFrom("domain_events").select("id").executeTakeFirstOrThrow();
    const auto = await db.selectFrom("automation_definitions").select("id").where("key", "=", "lead_notify_and_followup").executeTakeFirstOrThrow();
    await sql`update automation_runs set status = 'failed'`.execute(db);
    await enqueue(db, { type: "automation.run", payload: { automationId: auto.id, eventId: ev.id } });
    await runJobs(db, { budgetMs: 5_000 });

    const tasks = await db.selectFrom("tasks").selectAll().where("entity_id", "=", leadId).execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.assigned_user_id).toBe(agent.userId);
    const notes = await db.selectFrom("notifications").selectAll().where("user_id", "=", agent.userId).execute();
    expect(notes).toHaveLength(1);
    const runs = await db.selectFrom("automation_runs").selectAll().execute();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.attempt).toBe(2);
  });

  it("evento duplicado con el mismo dedupe_key no se registra dos veces", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    const a = await emitEvent(db, system, { type: "rent.due", aggregateType: "rent_obligation", aggregateId: "x", dedupeKey: "rent.due:x" });
    const b = await emitEvent(db, system, { type: "rent.due", aggregateType: "rent_obligation", aggregateId: "x", dedupeKey: "rent.due:x" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});
