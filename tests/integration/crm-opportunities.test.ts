import { describe, expect, it } from "vitest";
import { assignOpportunity, createOpportunity, loseOpportunity, moveOpportunityStage, pauseOpportunity, updateOpportunity, winOpportunity } from "@/server/opportunities/service";
import { getBoard, getOpportunityDetail } from "@/server/opportunities/queries";
import { captureLead } from "@/server/leads/capture";
import { createContact } from "@/server/contacts/crud";
import { createStaff, testDb } from "../helpers/db";
import { key, makeProperty, uniquePhone } from "../helpers/crm";

async function stage(pipelineKey: string, stageKey: string) {
  const db = testDb();
  return db
    .selectFrom("pipeline_stages as s")
    .innerJoin("pipelines as p", "p.id", "s.pipeline_id")
    .select("s.id")
    .where("p.key", "=", pipelineKey)
    .where("s.key", "=", stageKey)
    .executeTakeFirstOrThrow();
}

describe("oportunidades y pipeline", () => {
  it("convertir lead: pipeline por interés, lead convertido, historial y sin duplicar", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agent = await createStaff(db, ["agente"]);
    const prop = await makeProperty(db, admin);
    const lead = await captureLead(db, { kind: "anonymous", organizationId: admin.organizationId }, { name: "Quiere alquilar", phone: uniquePhone(), sourceKey: "web_property", propertyId: prop.id, operationInterest: "rent", assignedUserId: agent.userId });
    const k = key();
    const o = await createOpportunity(db, agent, { leadId: lead.leadId, budgetMax: 800000, budgetCurrency: "ARS", idempotencyKey: k });
    expect(o.replayed).toBe(false);
    expect(await createOpportunity(db, agent, { leadId: lead.leadId, idempotencyKey: key() })).toEqual({ id: o.id, replayed: true });
    expect(await createOpportunity(db, agent, { leadId: lead.leadId, idempotencyKey: k })).toEqual({ id: o.id, replayed: true });
    const detail = await getOpportunityDetail(db, agent, o.id);
    expect(detail.pipeline.key).toBe("alquileres");
    expect(detail.opp).toMatchObject({ status: "open", assigned_user_id: agent.userId, property_id: prop.id, operation: "rent", budget_max: "800000.00" });
    expect(detail.history).toHaveLength(1);
    const l = await db.selectFrom("leads").select("status").where("id", "=", lead.leadId).executeTakeFirstOrThrow();
    expect(l.status).toBe("converted");
    const events = await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", o.id).execute();
    expect(events.map((e) => e.event_type)).toEqual(["opportunity.created"]);
  });

  it("mover, perder (motivo obligatorio), pausar, reabrir y ganar con historial y auditoría", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const c = await createContact(db, agent, { firstName: "Comprador", idempotencyKey: key() });
    const o = await createOpportunity(db, agent, { contactId: c.id, pipelineKey: "ventas", idempotencyKey: key() });
    const calificado = await stage("ventas", "calificado");
    const perdido = await stage("ventas", "perdido");
    const otherPipelineStage = await stage("alquileres", "contactado");
    expect(await moveOpportunityStage(db, agent, { opportunityId: o.id, stageId: calificado.id, note: "Tiene preaprobado el crédito" })).toMatchObject({ changed: true });
    expect(await moveOpportunityStage(db, agent, { opportunityId: o.id, stageId: calificado.id })).toMatchObject({ changed: false });
    await expect(moveOpportunityStage(db, agent, { opportunityId: o.id, stageId: otherPipelineStage.id })).rejects.toThrow(/no pertenece/);
    await expect(moveOpportunityStage(db, agent, { opportunityId: o.id, stageId: perdido.id })).rejects.toMatchObject({ details: { lostReason: expect.any(Array) } });
    await expect(loseOpportunity(db, agent, { opportunityId: o.id })).rejects.toThrow(/motivo/);
    await loseOpportunity(db, agent, { opportunityId: o.id, lostReason: "Compró con otra inmobiliaria" });
    let row = await db.selectFrom("opportunities").select(["status", "lost_reason", "closed_at"]).where("id", "=", o.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "lost", lost_reason: "Compró con otra inmobiliaria" });
    expect(row.closed_at).not.toBeNull();
    // Reabrir moviendo a una etapa abierta limpia el cierre
    await moveOpportunityStage(db, agent, { opportunityId: o.id, stageId: calificado.id, note: "Volvió a consultar" });
    row = await db.selectFrom("opportunities").select(["status", "lost_reason", "closed_at"]).where("id", "=", o.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "open", lost_reason: null, closed_at: null });
    await pauseOpportunity(db, agent, { opportunityId: o.id, note: "Viaja dos meses" });
    await winOpportunity(db, agent, { opportunityId: o.id, valueAmount: 120000, valueCurrency: "USD" });
    row = await db.selectFrom("opportunities").select(["status", "lost_reason", "closed_at"]).where("id", "=", o.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("won");
    const history = await db.selectFrom("opportunity_stage_history").select("note").where("opportunity_id", "=", o.id).orderBy("id").execute();
    expect(history).toHaveLength(6);
    expect(history[2]!.note).toContain("Motivo: Compró con otra inmobiliaria");
    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", o.id).orderBy("id").execute()).map((a) => a.action);
    expect(actions.filter((a) => a === "OPPORTUNITY_STAGE_CHANGED")).toHaveLength(5);

    await updateOpportunity(db, agent, { opportunityId: o.id, budgetMin: 100000, budgetMax: 130000, requirements: { text: "3 dormitorios", bedroomsMin: 3 } });
    await expect(updateOpportunity(db, agent, { opportunityId: o.id, budgetMin: 200000 })).rejects.toThrow(/mínimo supera/);
    const upd = await db.selectFrom("opportunities").select(["budget_min", "budget_currency", "requirements"]).where("id", "=", o.id).executeTakeFirstOrThrow();
    expect(upd).toMatchObject({ budget_min: "100000.00", budget_currency: "USD", requirements: { text: "3 dormitorios", bedroomsMin: 3 } });
  });

  it("alcance: el agente solo ve y mueve las suyas (IDOR); asignar requiere opportunities.assign", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agentA = await createStaff(db, ["agente"]);
    const agentB = await createStaff(db, ["agente"]);
    const c = await createContact(db, admin, { firstName: "Cliente", idempotencyKey: key() });
    const ofB = await createOpportunity(db, admin, { contactId: c.id, pipelineKey: "ventas", assignedUserId: agentB.userId, idempotencyKey: key() });
    const ofA = await createOpportunity(db, agentA, { contactId: c.id, pipelineKey: "ventas", idempotencyKey: key() });
    await expect(createOpportunity(db, agentA, { contactId: c.id, assignedUserId: agentB.userId, idempotencyKey: key() })).rejects.toThrow(/No podés asignar/);

    const boardA = await getBoard(db, agentA, { pipelineKey: "ventas", agent: agentB.userId });
    expect(boardA.cards.map((x) => x.id)).toEqual([ofA.id]);
    const boardAdmin = await getBoard(db, admin, { pipelineKey: "ventas", agent: agentB.userId });
    expect(boardAdmin.cards.map((x) => x.id)).toEqual([ofB.id]);

    const calificado = await stage("ventas", "calificado");
    await expect(getOpportunityDetail(db, agentA, ofB.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(moveOpportunityStage(db, agentA, { opportunityId: ofB.id, stageId: calificado.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(winOpportunity(db, agentA, { opportunityId: ofB.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(updateOpportunity(db, agentA, { opportunityId: ofB.id, title: "Hackeada" })).rejects.toMatchObject({ code: "not_found" });
    await expect(assignOpportunity(db, agentA, { opportunityId: ofB.id, userId: agentA.userId })).rejects.toMatchObject({ code: "forbidden" });

    await assignOpportunity(db, admin, { opportunityId: ofB.id, userId: agentA.userId });
    expect((await getBoard(db, agentA, { pipelineKey: "ventas" })).cards.map((x) => x.id).sort()).toEqual([ofA.id, ofB.id].sort());
    const notif = await db.selectFrom("notifications").select("kind").where("user_id", "=", agentA.userId).execute();
    expect(notif.map((n) => n.kind)).toContain("opportunity.assigned");
  });
});
