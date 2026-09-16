import { describe, expect, it } from "vitest";
import { assignLead, changeLeadPriority, changeLeadStatus, createManualLead, registerFirstContact } from "@/server/leads/service";
import { getLeadDetail, listLeads } from "@/server/leads/queries";
import { captureLead } from "@/server/leads/capture";
import { addNote } from "@/server/notes/service";
import { logOutreach } from "@/server/activities/outreach";
import { getContactTimeline } from "@/server/contacts/queries";
import { createStaff, testDb } from "../helpers/db";
import { key, makeProperty, uniqueEmail, uniquePhone } from "../helpers/crm";

describe("leads: alcance por permiso (IDOR)", () => {
  it("con leads.read_own solo se ven y operan los asignados; un lead ajeno por id es 404", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agentA = await createStaff(db, ["agente"]);
    const agentB = await createStaff(db, ["agente"]);
    const anon = { kind: "anonymous" as const, organizationId: admin.organizationId };
    const mine = await captureLead(db, anon, { name: "Lead de A", phone: uniquePhone(), sourceKey: "web_contact", assignedUserId: agentA.userId });
    const other = await captureLead(db, anon, { name: "Lead de B", phone: uniquePhone(), sourceKey: "web_contact", assignedUserId: agentB.userId });
    const unassigned = await captureLead(db, anon, { name: "Sin asignar", email: uniqueEmail(), sourceKey: "web_contact" });

    const listA = await listLeads(db, agentA, {});
    expect(listA.rows.map((r) => r.id)).toEqual([mine.leadId]);
    expect(listA.scopeAll).toBe(false);
    // Ni forzando el filtro de asignado se cuela otro
    expect((await listLeads(db, agentA, { assigned: agentB.userId })).rows).toEqual([]);
    const listAdmin = await listLeads(db, admin, {});
    expect(listAdmin.rows.map((r) => r.id)).toEqual(expect.arrayContaining([mine.leadId, other.leadId, unassigned.leadId]));

    await expect(getLeadDetail(db, agentA, other.leadId)).rejects.toMatchObject({ code: "not_found" });
    await expect(getLeadDetail(db, agentA, unassigned.leadId)).rejects.toMatchObject({ code: "not_found" });
    await expect(changeLeadStatus(db, agentA, { leadId: other.leadId, status: "qualified" })).rejects.toMatchObject({ code: "not_found" });
    await expect(changeLeadPriority(db, agentA, { leadId: other.leadId, priority: "urgent" })).rejects.toMatchObject({ code: "not_found" });
    await expect(registerFirstContact(db, agentA, { leadId: other.leadId, channel: "call" })).rejects.toMatchObject({ code: "not_found" });
    await expect(addNote(db, agentA, { entityType: "lead", entityId: other.leadId, body: "hola" })).rejects.toMatchObject({ code: "not_found" });
    await expect(logOutreach(db, agentA, { entityType: "lead", entityId: other.leadId, channel: "call" })).rejects.toMatchObject({ code: "not_found" });
    await expect(assignLead(db, agentA, { leadId: other.leadId, userId: agentA.userId })).rejects.toMatchObject({ code: "forbidden" });
    const untouched = await db.selectFrom("leads").select(["status", "priority", "assigned_user_id", "first_response_at"]).where("id", "=", other.leadId).executeTakeFirstOrThrow();
    expect(untouched).toMatchObject({ status: "new", priority: "normal", assigned_user_id: agentB.userId, first_response_at: null });

    // Timeline del contacto tampoco muestra el lead ajeno
    const tl = await getContactTimeline(db, agentA, other.contactId);
    expect(tl.some((i) => i.kind === "lead")).toBe(false);
    expect((await getContactTimeline(db, admin, other.contactId)).some((i) => i.kind === "lead")).toBe(true);

    // Un usuario sin permisos de leads no ve la bandeja
    const marketing = await createStaff(db, ["marketing"]);
    await expect(listLeads(db, marketing, {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("asignar: permiso leads.assign, evento lead.assigned, aviso al agente e idempotencia", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agent = await createStaff(db, ["agente"]);
    const r = await captureLead(db, { kind: "anonymous", organizationId: admin.organizationId }, { name: "Para asignar", email: uniqueEmail(), sourceKey: "web_contact" });
    expect(await assignLead(db, admin, { leadId: r.leadId, userId: agent.userId })).toEqual({ changed: true });
    expect(await assignLead(db, admin, { leadId: r.leadId, userId: agent.userId })).toEqual({ changed: false });
    const events = await db.selectFrom("domain_events").select(["event_type", "payload"]).where("aggregate_id", "=", r.leadId).where("event_type", "=", "lead.assigned").execute();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ assignedUserId: agent.userId });
    const notes = await db.selectFrom("notifications").select(["kind", "link"]).where("user_id", "=", agent.userId).execute();
    expect(notes).toEqual([{ kind: "lead.assigned", link: `/crm/leads/${r.leadId}` }]);
    // Ahora el agente lo ve
    const detail = await getLeadDetail(db, agent, r.leadId);
    expect(detail.lead.id).toBe(r.leadId);
    await expect(assignLead(db, admin, { leadId: r.leadId, userId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/Usuario inválido/);
  });

  it("primer contacto se registra una sola vez; estado y prioridad auditados; filtros", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const admin = await createStaff(db, ["administrador"]);
    const prop = await makeProperty(db, admin, "Departamento céntrico");
    const k = key();
    const input = { name: "Carga Manual", phone: uniquePhone(), sourceKey: "phone" as const, propertyId: prop.id, message: "Llamó por el depto", idempotencyKey: k };
    const created = await createManualLead(db, agent, input);
    const again = await createManualLead(db, agent, input);
    expect(again).toMatchObject({ leadId: created.leadId, duplicate: true });
    // Sin leads.assign queda asignado a quien lo carga
    expect(created.assignedUserId).toBe(agent.userId);
    await expect(createManualLead(db, agent, { ...input, idempotencyKey: key(), assignedUserId: admin.userId })).rejects.toThrow(/No podés asignar/);
    await expect(createManualLead(db, agent, { name: "Sin datos", sourceKey: "manual", idempotencyKey: key() } as never)).rejects.toThrow();

    expect((await listLeads(db, agent, { unanswered: "1" })).rows.map((r) => r.id)).toContain(created.leadId);
    expect((await listLeads(db, agent, { property: String(prop.code) })).rows.map((r) => r.id)).toEqual([created.leadId]);
    expect((await listLeads(db, agent, { source: "web_contact" })).rows).toEqual([]);

    expect(await registerFirstContact(db, agent, { leadId: created.leadId, channel: "whatsapp", note: "Le mandé fotos" })).toEqual({ alreadyRegistered: false });
    const first = await db.selectFrom("leads").select(["first_response_at", "status"]).where("id", "=", created.leadId).executeTakeFirstOrThrow();
    expect(first.status).toBe("contacted");
    expect(await registerFirstContact(db, agent, { leadId: created.leadId, channel: "call" })).toEqual({ alreadyRegistered: true });
    await changeLeadStatus(db, agent, { leadId: created.leadId, status: "qualified" });
    await changeLeadStatus(db, agent, { leadId: created.leadId, status: "contacted" });
    const after = await db.selectFrom("leads").select(["first_response_at"]).where("id", "=", created.leadId).executeTakeFirstOrThrow();
    expect(after.first_response_at?.getTime()).toBe(first.first_response_at?.getTime());
    await changeLeadPriority(db, agent, { leadId: created.leadId, priority: "high" });
    expect((await listLeads(db, agent, { unanswered: "1" })).rows.map((r) => r.id)).not.toContain(created.leadId);
    expect((await listLeads(db, agent, { priority: "high", status: "contacted" })).rows.map((r) => r.id)).toEqual([created.leadId]);
    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", created.leadId).orderBy("id").execute()).map((a) => a.action);
    expect(actions).toEqual(["LEAD_CREATED", "LEAD_FIRST_CONTACT", "LEAD_STATUS_CHANGED", "LEAD_STATUS_CHANGED", "LEAD_PRIORITY_CHANGED"]);
    const detail = await getLeadDetail(db, agent, created.leadId);
    expect(detail.activities.map((a) => a.kind)).toContain("first_contact");
    expect(detail.property?.code).toBe(prop.code);
  });
});
