import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { cancelTask, completeTask, createTask, listTasks, reopenTask } from "@/server/tasks/service";
import { cancelAppointment, completeAppointment, confirmAppointment, createAppointment, markNoShow, OVERLAP_MESSAGE, rescheduleAppointment } from "@/server/agenda/service";
import { getAppointmentDetail, listAppointments } from "@/server/agenda/queries";
import { createOpportunity } from "@/server/opportunities/service";
import { createContact } from "@/server/contacts/crud";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { runJobs } from "@/server/jobs/runner";
import "@/server/automation/base-actions";
import { addDays, localDate, localDayRange, utcToLocalInput } from "@/server/crm/time";
import { createStaff, testDb } from "../helpers/db";
import { key, makeProperty } from "../helpers/crm";

describe("tareas", () => {
  it("crear (idempotente), completar, cancelar, reabrir y alcance mío/equipo", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agentA = await createStaff(db, ["agente"]);
    const agentB = await createStaff(db, ["agente"]);
    const c = await createContact(db, agentA, { firstName: "Tarea", idempotencyKey: key() });
    const k = key();
    const t = await createTask(db, agentA, { title: "Llamar para confirmar documentación", kind: "call", dueAt: "2026-01-10T09:00", entityType: "contact", entityId: c.id, idempotencyKey: k });
    expect(await createTask(db, agentA, { title: "Llamar para confirmar documentación", idempotencyKey: k })).toEqual({ id: t.id, replayed: true });
    const row = await db.selectFrom("tasks").select(["due_at", "assigned_user_id"]).where("id", "=", t.id).executeTakeFirstOrThrow();
    expect(row.due_at?.toISOString()).toBe("2026-01-10T12:00:00.000Z");
    expect(row.assigned_user_id).toBe(agentA.userId);
    await expect(createTask(db, agentA, { title: "Para B", assignedUserId: agentB.userId, idempotencyKey: key() })).rejects.toThrow(/No podés asignar/);
    const forB = await createTask(db, admin, { title: "Tarea de B", assignedUserId: agentB.userId, idempotencyKey: key() });

    const overdue = await listTasks(db, agentA, { status: "overdue" }, "2026-09-16");
    expect(overdue.rows.map((r) => r.id)).toEqual([t.id]);
    expect(overdue.rows[0]!.entity_label).toBe("Tarea");
    // El agente no ve las de B ni pidiendo "equipo"
    expect((await listTasks(db, agentA, { view: "team" }, "2026-09-16")).rows.map((r) => r.id)).not.toContain(forB.id);
    expect((await listTasks(db, admin, { view: "team", assignee: agentB.userId }, "2026-09-16")).rows.map((r) => r.id)).toEqual([forB.id]);
    await expect(completeTask(db, agentA, { taskId: forB.id })).rejects.toMatchObject({ code: "not_found" });

    expect(await completeTask(db, agentA, { taskId: t.id })).toEqual({ changed: true });
    expect(await completeTask(db, agentA, { taskId: t.id })).toEqual({ changed: false });
    await expect(cancelTask(db, agentA, { taskId: t.id })).rejects.toThrow(/ya está completada/);
    await reopenTask(db, agentA, { taskId: t.id });
    await cancelTask(db, agentA, { taskId: t.id, reason: "Ya no hace falta" });
    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", t.id).orderBy("id").execute()).map((a) => a.action);
    expect(actions).toEqual(["TASK_CREATED", "TASK_COMPLETED", "TASK_REOPENED", "TASK_CANCELLED"]);
  });
});

describe("agenda y visitas", () => {
  it("visita: superposición con error claro, idempotencia, evento, avance de oportunidad y cierre con resultado", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agent = await createStaff(db, ["agente"]);
    const prop = await makeProperty(db, admin, "Casa para visitar");
    const c = await createContact(db, agent, { firstName: "Visitante", idempotencyKey: key() });
    const opp = await createOpportunity(db, agent, { contactId: c.id, pipelineKey: "ventas", propertyId: prop.id, idempotencyKey: key() });

    const tomorrow = addDays(localDate(new Date()), 1);
    const k = key();
    const visit = await createAppointment(db, agent, { kind: "visit", startsAt: `${tomorrow}T10:00`, durationMinutes: 60, opportunityId: opp.id, idempotencyKey: k });
    expect(visit.opportunityAdvanced).toBe(true);
    expect(await createAppointment(db, agent, { kind: "visit", startsAt: `${tomorrow}T10:00`, durationMinutes: 60, opportunityId: opp.id, idempotencyKey: k })).toMatchObject({ id: visit.id, replayed: true });
    const detail = await getAppointmentDetail(db, agent, visit.id);
    expect(detail.appointment).toMatchObject({ property_id: prop.id, contact_id: c.id, assigned_user_id: agent.userId, status: "scheduled" });
    expect(utcToLocalInput(detail.appointment.starts_at)).toBe(`${tomorrow}T10:00`);

    await expect(createAppointment(db, agent, { kind: "call", startsAt: `${tomorrow}T10:30`, durationMinutes: 30, idempotencyKey: key() })).rejects.toMatchObject({ message: OVERLAP_MESSAGE, details: { startsAt: [OVERLAP_MESSAGE] } });
    await expect(createAppointment(db, agent, { kind: "visit", startsAt: `${tomorrow}T12:00`, idempotencyKey: key() })).rejects.toThrow(/Elegí la propiedad/);
    const call = await createAppointment(db, agent, { kind: "call", startsAt: `${tomorrow}T11:00`, durationMinutes: 30, contactId: c.id, idempotencyKey: key() });
    await expect(rescheduleAppointment(db, agent, { appointmentId: call.id, startsAt: `${tomorrow}T10:15`, durationMinutes: 30 })).rejects.toThrow(OVERLAP_MESSAGE);
    await rescheduleAppointment(db, agent, { appointmentId: call.id, startsAt: `${tomorrow}T15:00`, durationMinutes: 30 });
    await cancelAppointment(db, agent, { appointmentId: call.id, reason: "El cliente no puede" });
    await expect(cancelAppointment(db, agent, { appointmentId: visit.id })).rejects.toThrow(/motivo/);

    const events = await db.selectFrom("domain_events").select(["event_type", "payload"]).where("aggregate_id", "=", visit.id).execute();
    // Con el núcleo operativo de visitas encendido (flag visits_operations) se suman los eventos appointment.*.
    expect(events.map((e) => e.event_type)).toEqual(["visit.scheduled", "appointment.created", "appointment.assigned"]);
    let stageKey = await db.selectFrom("opportunities as o").innerJoin("pipeline_stages as s", "s.id", "o.stage_id").select("s.key").where("o.id", "=", opp.id).executeTakeFirstOrThrow();
    expect(stageKey.key).toBe("visita_programada");

    await confirmAppointment(db, agent, { appointmentId: visit.id });
    await expect(completeAppointment(db, agent, { appointmentId: visit.id, result: "Le gustó" })).rejects.toThrow(/todavía no empezó/);
    await sql`update appointments set starts_at = starts_at - interval '2 days', ends_at = ends_at - interval '2 days' where id = ${visit.id}`.execute(db);
    await expect(completeAppointment(db, agent, { appointmentId: visit.id })).rejects.toMatchObject({ details: { result: expect.any(Array) } });
    const done = await completeAppointment(db, agent, { appointmentId: visit.id, result: "Le gustó, pide segunda visita con su pareja" });
    expect(done).toMatchObject({ changed: true, opportunityAdvanced: true });
    stageKey = await db.selectFrom("opportunities as o").innerJoin("pipeline_stages as s", "s.id", "o.stage_id").select("s.key").where("o.id", "=", opp.id).executeTakeFirstOrThrow();
    expect(stageKey.key).toBe("visita_realizada");
    const oppAudit = await db.selectFrom("audit_logs").select(["action", "metadata"]).where("entity_id", "=", opp.id).where("action", "=", "OPPORTUNITY_STAGE_CHANGED").orderBy("id").execute();
    expect(oppAudit.map((a) => a.metadata)).toEqual([{ automatic: "Visita agendada" }, { automatic: "Visita realizada" }]);

    // visit.completed dispara la automatización de seguimiento con tarea para el agente
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 300_000 });
    const followUp = await db.selectFrom("tasks").select(["assigned_user_id", "entity_type", "entity_id"]).where("entity_id", "=", visit.id).executeTakeFirst();
    expect(followUp).toEqual({ assigned_user_id: agent.userId, entity_type: "appointment", entity_id: visit.id });
  });

  it("alcance: agente ve su agenda, no la ajena (IDOR); no agenda para otros; administración ve todo", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agentA = await createStaff(db, ["agente"]);
    const agentB = await createStaff(db, ["agente"]);
    const day = addDays(localDate(new Date()), 3);
    const ofB = await createAppointment(db, admin, { kind: "meeting", startsAt: `${day}T09:00`, durationMinutes: 45, assignedUserId: agentB.userId, idempotencyKey: key() });
    const ofA = await createAppointment(db, agentA, { kind: "meeting", startsAt: `${day}T09:00`, durationMinutes: 45, idempotencyKey: key() });
    await expect(createAppointment(db, agentA, { kind: "call", startsAt: `${day}T13:00`, assignedUserId: agentB.userId, idempotencyKey: key() })).rejects.toThrow(/No podés agendar/);
    const range = localDayRange(day, 1);
    expect((await listAppointments(db, agentA, { ...range, agent: agentB.userId })).rows.map((r) => r.id)).toEqual([ofA.id]);
    expect((await listAppointments(db, admin, range)).rows.map((r) => r.id).sort()).toEqual([ofA.id, ofB.id].sort());
    await expect(getAppointmentDetail(db, agentA, ofB.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(confirmAppointment(db, agentA, { appointmentId: ofB.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(markNoShow(db, agentA, { appointmentId: ofB.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(rescheduleAppointment(db, agentA, { appointmentId: ofA.id, startsAt: `${day}T10:00`, durationMinutes: 30, assignedUserId: agentB.userId })).rejects.toThrow(/No podés pasar/);
    const n = await db.selectFrom("notifications").select("kind").where("user_id", "=", agentB.userId).execute();
    expect(n.map((x) => x.kind)).toEqual(["appointment.assigned"]);
  });
});
