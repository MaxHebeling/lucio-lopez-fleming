/**
 * Fecha de negocio = día en Salta (UTC−3), no el día UTC del servidor. Las tareas diarias pueden correr a cualquier hora
 * (hoy el cron cae a las 21:00 de Salta = 00:00 UTC del día siguiente): el resultado y la deduplicación no cambian.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/server/jobs/handlers";
import { sql } from "@/server/db";
import { getJobHandler } from "@/server/jobs/registry";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { emitEvent } from "@/server/events";
import { activateContract, createContract } from "@/server/rentals/contracts";
import { addDays, todayInSalta } from "@/server/rentals/dates";
import { getDashboard } from "@/server/dashboard/queries";
import { systemActor } from "@/server/auth/actor";
import { organizationId } from "@/server/org";
import { createStaff, testDb } from "../helpers/db";
import { contractInput, createTestContact, createTestProperty } from "../helpers/rentals";

/** Instante UTC de una hora local de Salta (UTC−3, sin horario de verano). */
const saltaInstant = (isoDate: string, hhmm: string) => new Date(`${isoDate}T${hhmm}:00-03:00`);

async function runHandler(type: string) {
  const db = testDb();
  const actor = systemActor(await organizationId(db), "test");
  return getJobHandler(type)!({}, { db, actor, jobId: "00000000-0000-4000-8000-0000000000aa", attempt: 1, signal: new AbortController().signal });
}

async function runAutomationJobs() {
  const db = testDb();
  const autos = await db.selectFrom("automation_definitions").select("id").where("key", "=", "rent_due_reminder").execute();
  const ids = new Set(autos.map((a) => a.id));
  const jobs = (await db.selectFrom("jobs").select(["id", "payload"]).where("type", "=", "automation.run").where("status", "=", "queued").execute()).filter((j) =>
    ids.has(String((j.payload as { automationId?: string }).automationId)),
  );
  const handler = getJobHandler("automation.run")!;
  const actor = systemActor(await organizationId(db), "test");
  for (const j of jobs) {
    await handler(j.payload as Record<string, unknown>, { db, actor, jobId: j.id, attempt: 1, signal: new AbortController().signal });
    await db.updateTable("jobs").set({ status: "succeeded" }).where("id", "=", j.id).execute();
  }
}

describe("tareas diarias de alquileres en hora de Salta", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("vencidas, obligaciones y recordatorios usan el día de Salta; correr a otra hora no duplica avisos", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createTestContact(db, "Dueño Horario");
    const tenant = await createTestContact(db, "Inquilina Horario", "inquilina.horario@test.local");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    // Día de negocio simulado: el 15 del mes en curso; la cuota del mes vence ese día.
    const day = `${todayInSalta().slice(0, 7)}-15`;
    const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner }], [{ contactId: tenant }], { paymentDueDay: 15 }));
    await activateContract(db, staff, c.id);
    const dueToday = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", c.id).where("due_date", "=", day).executeTakeFirstOrThrow();
    const dueSoon = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", c.id).where("due_date", ">", day).orderBy("due_date").executeTakeFirstOrThrow();
    await db.updateTable("rent_obligations").set({ status: "pending" }).where("id", "=", dueToday.id).execute();
    await db.updateTable("rent_obligations").set({ due_date: addDays(day, 3), status: "pending" }).where("id", "=", dueSoon.id).execute();

    // 21:30 en Salta = día siguiente en UTC. La cuota que vence hoy (Salta) no pasa a vencida por la hora del servidor.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(saltaInstant(day, "21:30"));
    expect(new Date().toISOString().slice(0, 10)).toBe(addDays(day, 1));
    await runHandler("rentals.mark_overdue");
    expect((await db.selectFrom("rent_obligations").select("status").where("id", "=", dueToday.id).executeTakeFirstOrThrow()).status).toBe("pending");

    // Generar obligaciones a esa hora: la cuota que vence hoy (Salta) nace pendiente, no vencida
    await db.deleteFrom("rent_obligations").where("id", "=", dueToday.id).execute();
    await runHandler("rentals.generate_obligations");
    expect((await db.selectFrom("rent_obligations").select("status").where("contract_id", "=", c.id).where("due_date", "=", day).executeTakeFirstOrThrow()).status).toBe("pending");

    // Recordatorio: corre a la mañana y otra vez a la noche del mismo día (cambio de horario del cron) y al día siguiente
    vi.setSystemTime(saltaInstant(day, "09:00"));
    await runHandler("rentals.due_reminders");
    vi.setSystemTime(saltaInstant(day, "21:30"));
    await runHandler("rentals.due_reminders");
    vi.setSystemTime(saltaInstant(addDays(day, 1), "08:00"));
    await runHandler("rentals.due_reminders");
    vi.useRealTimers();
    const events = await db.selectFrom("domain_events").select(["id"]).where("event_type", "=", "rent.due").where("aggregate_id", "=", dueSoon.id).execute();
    expect(events).toHaveLength(1);

    // Aunque llegara otro evento para la misma cuota y vencimiento (p. ej. un productor con dedupe por día UTC),
    // el aviso al inquilino se deduplica por fecha de negocio.
    await emitEvent(db, systemActor(await organizationId(db), "test"), {
      type: "rent.due",
      aggregateType: "rent_obligation",
      aggregateId: dueSoon.id,
      payload: { contractId: c.id, dueDate: addDays(day, 3) },
      dedupeKey: `rent.due:${dueSoon.id}:utc:${addDays(day, 1)}`,
    });
    await dispatchPendingEvents(db);
    await runAutomationJobs();
    const messages = await db
      .selectFrom("outbound_messages")
      .select(["to_address", "dedupe_key"])
      .where("entity_id", "=", c.id)
      .where("template_key", "=", "rent_due_reminder")
      .where("dedupe_key", "like", `%${dueSoon.id}%`)
      .execute();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.dedupe_key).toContain(`${dueSoon.id}:${addDays(day, 3)}`);
  });

  it("el tablero cuenta contratos por vencer con el día de Salta, no con el reloj UTC de la base", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["direccion"]);
    const owner = await createTestContact(db, "Dueña Tablero");
    const tenant = await createTestContact(db, "Inquilino Tablero");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner }], [{ contactId: tenant }]));
    await activateContract(db, staff, c.id);
    // El día de negocio es "ayer" respecto del reloj de la base: el contrato que vence ese día está por vencer (vence hoy).
    const businessDay = addDays(todayInSalta(), -1);
    await db.updateTable("rental_contracts").set({ end_date: businessDay }).where("id", "=", c.id).execute();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(saltaInstant(businessDay, "12:00"));
    const dashboard = await getDashboard(db, staff, {});
    vi.useRealTimers();
    expect(dashboard.contracts?.items.map((i) => i.id)).toContain(c.id);
  });
});
