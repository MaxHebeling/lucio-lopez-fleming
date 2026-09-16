/** Tareas periódicas y automatizaciones de alquileres: correr el cron dos veces no duplica nada. */
import { describe, expect, it } from "vitest";
import "@/server/jobs/handlers";
import { sql } from "@/server/db";
import { enqueueScheduled } from "@/server/jobs/scheduled";
import { getJobHandler } from "@/server/jobs/registry";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { emitAdjustmentsDue, emitExpiringContracts, emitRentDue } from "@/server/rentals/jobs";
import { activateContract, createContract } from "@/server/rentals/contracts";
import { addDays, todayInSalta } from "@/server/rentals/dates";
import { systemActor } from "@/server/auth/actor";
import { organizationId } from "@/server/org";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { contractInput, createTestContact, createTestProperty, monthStart } from "../helpers/rentals";

async function runAutomationJobs() {
  const db = testDb();
  // Solo las automatizaciones de alquileres (otras dependen de acciones de otros módulos)
  const autos = await db.selectFrom("automation_definitions").select("id").where("key", "in", ["contract_expiring_notice", "rent_due_reminder", "rent_adjustment_proposal"]).execute();
  const ids = new Set(autos.map((a) => a.id));
  const all = await db.selectFrom("jobs").select(["id", "payload"]).where("type", "=", "automation.run").where("status", "=", "queued").execute();
  const jobs = all.filter((j) => ids.has(String((j.payload as { automationId?: string }).automationId)));
  const handler = getJobHandler("automation.run")!;
  const actor = systemActor(await organizationId(db), "test");
  for (const j of jobs) {
    await handler(j.payload as Record<string, unknown>, { db, actor, jobId: j.id, attempt: 1, signal: new AbortController().signal });
    await db.updateTable("jobs").set({ status: "succeeded" }).where("id", "=", j.id).execute();
  }
  return jobs;
}

describe("tareas periódicas de alquileres", () => {
  it("registra las tareas diarias y el cron repetido no duplica jobs", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const now = new Date();
    const first = await enqueueScheduled(db, now);
    const second = await enqueueScheduled(db, now);
    expect(second).toBe(0);
    const types = (await db.selectFrom("jobs").select("type").execute()).map((j) => j.type);
    expect(first).toBe(types.length);
    for (const t of ["rentals.fetch_indices", "rentals.generate_obligations", "rentals.mark_overdue", "rentals.expiring_contracts", "rentals.due_reminders", "rentals.adjustments_due", "reports.sync_delivery"]) {
      expect(types).toContain(t);
      expect(getJobHandler(t)).toBeTypeOf("function");
    }
  });

  it("vencimientos, cuotas por vencer y ajustes: eventos una sola vez; queue_message encola a inquilinos una sola vez", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createTestContact(db, "Dueña Automatización");
    const tenant = await createTestContact(db, "Inquilino Con Email", "inquilino.auto@test.local");
    const tenantNoAddress = await createTestContact(db, "Inquilina Sin Datos");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    // Vence dentro de 60 días (setting rentals.expiring_notice_days) y ajusta este mes
    const endDate = monthStart(1);
    const c = await createContract(
      db,
      staff,
      contractInput(property.id, [{ contactId: owner }], [{ contactId: tenant }, { contactId: tenantNoAddress }], {
        startDate: monthStart(-3),
        endDate,
        adjustmentIndexKey: "ICL",
        adjustmentPeriodMonths: 3,
      }),
    );
    await activateContract(db, staff, c.id);
    const system = await testSystemActor(db);

    const run = async () => ({
      expiring: await emitExpiringContracts(db, system),
      due: await emitRentDue(db, system),
      adjustments: await emitAdjustmentsDue(db, system),
    });
    const r1 = await run();
    expect(r1.expiring).toBe(1);
    expect(r1.adjustments).toBe(1);
    const r2 = await run();
    expect(r2).toEqual({ expiring: 0, due: 0, adjustments: 0 });

    const events = await db.selectFrom("domain_events").select(["event_type", "aggregate_id", "payload"]).where("event_type", "in", ["contract.expiring", "rent.due", "rent_adjustment.due"]).execute();
    const mine = events.filter((e) => e.aggregate_id === c.id || (e.payload as { contractId?: string }).contractId === c.id);
    expect(mine.filter((e) => e.event_type === "contract.expiring")).toHaveLength(1);
    expect(mine.filter((e) => e.event_type === "rent_adjustment.due")).toHaveLength(1);
    const dueEvents = mine.filter((e) => e.event_type === "rent.due");
    // Hay cuota por vencer solo si el día de vencimiento cae dentro de los próximos 3 días y no pasó a otro mes
    expect(dueEvents.length).toBeLessThanOrEqual(1);

    await dispatchPendingEvents(db);
    await runAutomationJobs();
    // Reintento del mismo evento: los runs ya exitosos se saltean y los mensajes tienen dedupe
    await sql`update jobs set status = 'queued' where type = 'automation.run'`.execute(db);
    await runAutomationJobs();

    const messages = await db.selectFrom("outbound_messages").select(["to_address", "template_key", "channel"]).where("entity_id", "=", c.id).execute();
    expect(messages).toEqual(dueEvents.length ? [{ to_address: "inquilino.auto@test.local", template_key: "rent_due_reminder", channel: "email" }] : []);

    // Aviso de contrato por vencer: notificación + tarea (una sola)
    const tasks = await db.selectFrom("tasks").select("title").where("entity_id", "=", c.id).execute();
    expect(tasks).toEqual([{ title: "Gestionar renovación o finalización" }]);

    // Ajuste: sin valores de ICL queda aviso, sin propuesta
    const contract = await db.selectFrom("rental_contracts").select("adjustment_pending_note").where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(contract.adjustment_pending_note).toMatch(/faltan ICL/);
    expect(await db.selectFrom("rent_adjustments").select("id").where("contract_id", "=", c.id).execute()).toHaveLength(0);
  });

  it("queue_message con cuota por vencer mañana: un email por inquilino con email, nunca duplicado", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createTestContact(db, "Dueño Recordatorio");
    const tenant = await createTestContact(db, "Inquilina Recordatorio", "recordatorio@test.local");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner }], [{ contactId: tenant }]));
    await activateContract(db, staff, c.id);
    // Forzamos una cuota que vence mañana (dato de prueba)
    const tomorrow = addDays(todayInSalta(), 1);
    const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", c.id).orderBy("period_start", "desc").executeTakeFirstOrThrow();
    await db.updateTable("rent_obligations").set({ due_date: tomorrow, status: "pending" }).where("id", "=", ob.id).execute();
    const system = await testSystemActor(db);
    expect(await emitRentDue(db, system)).toBeGreaterThanOrEqual(1);
    expect(await emitRentDue(db, system)).toBe(0);
    await dispatchPendingEvents(db);
    await runAutomationJobs();
    await sql`update automation_runs set status = 'failed'`.execute(db); // simula un reintento tras falla
    await sql`update jobs set status = 'queued' where type = 'automation.run'`.execute(db);
    await runAutomationJobs();
    const messages = await db.selectFrom("outbound_messages").select(["to_address", "template_key", "payload"]).where("entity_id", "=", c.id).execute();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to_address: "recordatorio@test.local", template_key: "rent_due_reminder" });
    expect(messages[0]!.payload).toMatchObject({ dueDate: tomorrow, contractCode: c.code, currency: "ARS" });
  });
});
