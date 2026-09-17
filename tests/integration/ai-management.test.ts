/**
 * IA Fase 5 · AI Management contra Postgres real: preguntas de dirección (RBAC, flag, organización, definiciones y
 * períodos, copiloto con y sin clave), Resumen de hoy por rol (cache, invalidación, IA con guardas y proveedor caído),
 * Tareas sugeridas (alcance/IDOR, aceptar → tarea real sin duplicar, descartar, posponer, vencimiento), anomalías
 * (evidencia sin PII, dedupe, tope diario, n chico), Centro de comando, observabilidad y filtro de compatibles.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import "@/server/jobs/handlers";
import { sql, type Database } from "@/server/db";
import type { StaffActor, SystemActor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import { createDefaultRegistry } from "@/server/ai/domains";
import { askCopilot } from "@/server/ai/copilot/service";
import { setTaskProviderForTests } from "@/server/ai/run-task";
import { getDailyBrief, refreshDailyBrief } from "@/server/ai/brief/service";
import { markBriefsStale } from "@/server/ai/brief/cache";
import { acceptSuggestion, dismissSuggestion, listSuggestions, refreshSuggestions, snoozeSuggestion } from "@/server/ai/task-center/service";
import { detectAnomalies, listOpenAnomalies } from "@/server/ai/anomalies/service";
import { getCommandCenter } from "@/server/ai/command-center/service";
import { getAiUsage } from "@/server/ai/observability";
import { acceptRecommendation } from "@/server/sales/nba/service";
import { listProperties } from "@/server/properties/queries";
import { organizationId } from "@/server/org";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { setFlag } from "../helpers/integrations";
import { FakeProvider, analystFinal, result, toolCall } from "../helpers/ai";
import { makeProperty } from "../helpers/crm";
import { contactIn, listedProperty, resetSalesCaches, salesCatalog } from "../helpers/sales";

const HOUR = 3_600_000;
let admin: StaffActor;
let direccion: StaffActor;
let agente: StaffActor;
let otroAgente: StaffActor;
let marketing: StaffActor;
let soloLectura: StaffActor;
let system: SystemActor;
let otherOrg: string;
let otherOrgUser: string;
let propId: string;

const expectCode = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
};

async function lead(db: Database, o: { org?: string; assigned?: string | null; hoursAgo: number; firstResponseAfterHours?: number; source?: string; name?: string; propertyId?: string | null; status?: string }) {
  const org = o.org ?? admin.organizationId;
  const contact = await contactIn(db, org, o.name ?? `Contacto ${randomUUID().slice(0, 6)}`);
  const created = new Date(Date.now() - o.hoursAgo * HOUR);
  const row = await db
    .insertInto("leads")
    .values({
      organization_id: org,
      contact_id: contact,
      source_key: o.source ?? "web_contact",
      assigned_user_id: o.assigned ?? null,
      created_at: created,
      first_response_at: o.firstResponseAfterHours === undefined ? null : new Date(created.getTime() + o.firstResponseAfterHours * HOUR),
      property_id: o.propertyId ?? null,
      status: o.status ?? "new",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { leadId: row.id, contactId: contact };
}

async function visit(db: Database, o: { agent: string; status: string; startsHoursAgo: number; finishedHoursAgo?: number; contactId?: string | null }) {
  const starts = new Date(Date.now() - o.startsHoursAgo * HOUR);
  return (
    await db
      .insertInto("appointments")
      .values({
        kind: "visit",
        title: "Visita de prueba",
        starts_at: starts,
        ends_at: new Date(starts.getTime() + HOUR),
        status: o.status,
        property_id: propId,
        contact_id: o.contactId ?? null,
        assigned_user_id: o.agent,
        finished_at: o.finishedHoursAgo === undefined ? null : new Date(Date.now() - o.finishedHoursAgo * HOUR),
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

beforeAll(async () => {
  const db = testDb();
  admin = await createStaff(db, ["administrador"]);
  direccion = await createStaff(db, ["direccion"]);
  agente = await createStaff(db, ["agente"]);
  otroAgente = await createStaff(db, ["agente"]);
  marketing = await createStaff(db, ["marketing"]);
  soloLectura = await createStaff(db, ["solo_lectura"]);
  system = await testSystemActor(db);
  otherOrg = (await db.insertInto("organizations").values({ name: "Otra inmobiliaria", slug: "otra-inmo-mgmt" }).returning("id").executeTakeFirstOrThrow()).id;
  otherOrgUser = (await db.insertInto("users").values({ organization_id: otherOrg, email: "ajeno-mgmt@test.local", full_name: "Agente Ajeno", kind: "staff" }).returning("id").executeTakeFirstOrThrow()).id;
  propId = (await makeProperty(db, admin, "Casa para gestión")).id;
  await salesCatalog(db);
  resetSalesCaches();
});

beforeEach(() => setTaskProviderForTests(null));

// ─────────────────────────────── Dirección (primero: datos limpios) ───────────────────────────────

describe("preguntas de dirección (Executive AI)", () => {
  it("RBAC y chips: solo con ai.executive; cuatro chips deterministas; el flag se verifica al ejecutar", async () => {
    const db = testDb();
    const registry = createDefaultRegistry();
    const ctx = (actor: StaffActor) => ({ db, actor, now: new Date(), screen: null });
    const flags = new Set(["ai_executive"]);
    expect(registry.quickQueries(agente, null, flags).filter((q) => q.id.startsWith("exec_"))).toEqual([]);
    expect(registry.quickQueries(admin, null, flags).filter((q) => q.id.startsWith("exec_")).map((q) => q.label)).toEqual(["¿Cómo estuvo la semana?", "Leads del mes", "Seguimientos atrasados", "Cuellos de botella"]);
    expect(registry.quickQueries(direccion, null, flags).some((q) => q.id === "exec_semana")).toBe(true);
    expect(registry.quickQueries(soloLectura, null, flags).some((q) => q.id === "exec_semana")).toBe(false);
    expect(await registry.invoke(ctx(agente), "executive_week_review", {}, ["read"])).toMatchObject({ ok: false, code: "permission_denied" });
    await setFlag(db, "ai_executive", false);
    expect(await registry.invoke(ctx(admin), "executive_week_review", {}, ["read"])).toMatchObject({ ok: false, code: "permission_denied" });
    await setFlag(db, "ai_executive", true);
  });

  it("«¿Cómo estuvo la semana?»: hechos con cifra, definición, período y origen; solo la organización; sin % con muestra chica", async () => {
    const db = testDb();
    // Últimos 7 días: 6 leads (3 con primer contacto a las 2, 4 y 6 h); 7 días anteriores: 2. Otra organización: 5.
    for (const h of [2, 4, 6]) await lead(db, { hoursAgo: 30 + h, firstResponseAfterHours: h, assigned: agente.userId, status: "contacted" });
    for (let i = 0; i < 3; i++) await lead(db, { hoursAgo: 10 + i, source: "whatsapp" });
    for (let i = 0; i < 2; i++) await lead(db, { hoursAgo: 8 * 24 + i });
    for (let i = 0; i < 5; i++) await lead(db, { org: otherOrg, hoursAgo: 5 });
    await visit(db, { agent: agente.userId, status: "completed", startsHoursAgo: 48, finishedHoursAgo: 47 });
    await visit(db, { agent: agente.userId, status: "no_show", startsHoursAgo: 72 });
    const registry = createDefaultRegistry();
    const r = await registry.invoke({ db, actor: admin, now: new Date(), screen: null }, "executive_week_review", {}, ["read"]);
    if (!r.ok) throw new Error(r.message);
    const item = (label: string) => r.result.items.find((i) => i.label === label)!;
    expect(item("Leads nuevos").detail).toBe("6 (período anterior: 2, +4, +200 %)");
    expect(item("Leads nuevos").definition).toContain("Consultas creadas en el período");
    expect(item("Leads nuevos").href).toMatch(/^\/crm\/leads\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(item("Tiempo mediano a primer contacto").detail).toBe("4 h (n=3; período anterior: sin muestra suficiente, n=0)");
    expect(item("Visitas realizadas").detail).toBe("1 (período anterior: 0, +1; muestra chica, sin variación porcentual)");
    expect(item("Visitas «no se presentó»").detail).toContain("muestra chica");
    expect(r.result.period).toMatch(/^Últimos 7 días \(\d{2}\/\d{2} al \d{2}\/\d{2}\) · comparado con: 7 días anteriores/);
    expect(r.result.source).toEqual({ label: "Tablero y Leads", href: "/crm" });

    const bySource = await registry.invoke({ db, actor: direccion, now: new Date(), screen: null }, "executive_leads_by_source", { period: "last_7_days" }, ["read"]);
    if (!bySource.ok) throw new Error(bySource.message);
    expect(bySource.result.items.find((i) => i.label === "Origen: WhatsApp")?.detail ?? bySource.result.items.find((i) => i.label.startsWith("Origen: whats"))?.detail).toContain("3 (período anterior: 0");
    expect(bySource.result.items[0]).toMatchObject({ label: "Total de leads nuevos" });
  });

  it("copiloto sin clave: chip y pregunta libre usan el reporte determinista; un agente no puede pedirlo", async () => {
    const db = testDb();
    const chip = await askCopilot(db, admin, { mode: "analyst", quickQueryId: "exec_semana" }, { provider: null });
    expect(chip.generatedBy).toBe("data");
    expect(chip.facts[0]).toMatchObject({ title: "¿Cómo estuvo la semana?", scope: "all" });
    expect(chip.facts[0]!.period).toContain("Últimos 7 días");
    expect(chip.facts[0]!.items.every((i) => Boolean(i.definition))).toBe(true);
    const free = await askCopilot(db, admin, { mode: "analyst", question: "¿Cómo estuvo la semana?" }, { provider: null });
    expect(free.facts[0]!.title).toBe("¿Cómo estuvo la semana?");
    const cuellos = await askCopilot(db, direccion, { mode: "analyst", question: "¿Dónde están los cuellos de botella?" }, { provider: null });
    expect(cuellos.facts[0]!.title).toBe("Cuellos de botella");
    await expectCode(askCopilot(db, agente, { mode: "analyst", quickQueryId: "exec_semana" }, { provider: null }), "forbidden");
    // Pregunta libre de un agente: no hay reporte de dirección para su rol.
    const agentFree = await askCopilot(db, agente, { mode: "analyst", question: "¿Cómo estuvo la semana?" }, { provider: null });
    expect(agentFree.facts.some((f) => f.title === "¿Cómo estuvo la semana?")).toBe(false);
  });

  it("copiloto con IA: hechos desde la herramienta e interpretación aparte; un agente no puede ejecutar la herramienta aunque el modelo la pida", async () => {
    const db = testDb();
    const provider = new FakeProvider([
      toolCall("executive_week_review"),
      analystFinal({ answer: "En los últimos 7 días entraron 6 leads nuevos.", interpretation: ["Conviene revisar el tiempo de primer contacto."], answered: true }),
    ]);
    const res = await askCopilot(db, admin, { mode: "analyst", question: "Dame un balance ejecutivo" }, { provider });
    expect(res.generatedBy).toBe("ai");
    expect(res.facts[0]!.title).toBe("¿Cómo estuvo la semana?");
    expect(res.interpretation).toEqual(["Conviene revisar el tiempo de primer contacto."]);
    // Cifra inventada → se descarta el texto y quedan los hechos
    const liar = new FakeProvider([toolCall("executive_week_review"), analystFinal({ answer: "Entraron 48 leads nuevos.", interpretation: [], answered: true })]);
    const blocked = await askCopilot(db, admin, { mode: "analyst", question: "Dame un balance ejecutivo" }, { provider: liar });
    expect(blocked.generatedBy).toBe("data");
    expect(blocked.facts[0]!.title).toBe("¿Cómo estuvo la semana?");
    // Agente: el modelo pide la herramienta, el registro la rechaza.
    const sneaky = new FakeProvider([toolCall("executive_week_review"), analystFinal({ answer: "No tengo esos datos.", interpretation: [], answered: false })]);
    const agentRes = await askCopilot(db, agente, { mode: "analyst", question: "balance de la semana de toda la empresa" }, { provider: sneaky });
    expect(agentRes.facts).toEqual([]);
    const toolsOffered = (sneaky.calls[0]!.tools ?? []).map((t) => t.name);
    expect(toolsOffered.some((n) => n.startsWith("executive_"))).toBe(false);
    const row = await db.selectFrom("ai_interactions").select("tool_calls").where("user_id", "=", agente.userId).orderBy("created_at", "desc").executeTakeFirstOrThrow();
    expect(JSON.stringify(row.tool_calls)).toContain("permission_denied");
  });
});

// ─────────────────────────────── Tareas sugeridas ───────────────────────────────

describe("Tareas sugeridas", () => {
  let visitA: string;
  let visitB: string;

  it("alcance: el agente ve lo suyo, el equipo todo, otra organización nada; decidir sobre lo ajeno = 404", async () => {
    const db = testDb();
    visitA = await visit(db, { agent: agente.userId, status: "completed", startsHoursAgo: 4, finishedHoursAgo: 3 });
    visitB = await visit(db, { agent: otroAgente.userId, status: "completed", startsHoursAgo: 30, finishedHoursAgo: 29 });
    // Fila de otra organización asignada (mal) al mismo agente: nunca se ve.
    await db
      .insertInto("sales_recommendations")
      .values({ organization_id: otherOrg, entity_type: "organization", entity_id: otherOrg, rule_key: "job_failure_spike", fingerprint: "f".repeat(32), priority: "high", title: "Ajena", reason: "Fila de otra organización", status: "open", source: "anomaly", assigned_user_id: agente.userId })
      .execute();
    await refreshSuggestions(db, system, { sources: ["visit"] });

    const mine = await listSuggestions(db, agente, {});
    expect(mine.items.some((i) => i.ruleKey === "visit_report" && i.link === `/crm/mis-visitas/${visitA}`)).toBe(true);
    expect(mine.items.some((i) => i.link === `/crm/mis-visitas/${visitB}`)).toBe(false);
    expect(mine.items.some((i) => i.title === "Ajena")).toBe(false);
    expect(mine.canTeam).toBe(false);
    // Pedir «equipo» sin permiso no amplía el alcance.
    expect((await listSuggestions(db, agente, { vista: "equipo" })).items.map((i) => i.link)).toEqual(mine.items.map((i) => i.link));

    const team = await listSuggestions(db, admin, { vista: "equipo" });
    expect(team.items.map((i) => i.link)).toEqual(expect.arrayContaining([`/crm/mis-visitas/${visitA}`, `/crm/mis-visitas/${visitB}`]));
    expect(team.items.some((i) => i.title === "Ajena")).toBe(false);
    // Orden: «alta» (visita de hace 29 h) antes que «media».
    const reports = team.items.filter((i) => i.ruleKey === "visit_report");
    expect(reports.find((r) => r.link === `/crm/mis-visitas/${visitB}`)!.priority).toBe("high");
    expect(reports.find((r) => r.link === `/crm/mis-visitas/${visitA}`)!.priority).toBe("medium");
    const firstMedium = reports.findIndex((r) => r.priority === "medium");
    expect(reports.slice(firstMedium).every((r) => r.priority !== "high")).toBe(true);
    expect((await listSuggestions(db, admin, {})).items).toEqual([]);

    const otherRow = team.items.find((i) => i.link === `/crm/mis-visitas/${visitB}` && i.ruleKey === "visit_report")!;
    await expectCode(acceptSuggestion(db, agente, { id: otherRow.id }), "not_found");
    await expectCode(dismissSuggestion(db, agente, { id: otherRow.id }), "not_found");
    const foreign = await db.selectFrom("sales_recommendations").select("id").where("organization_id", "=", otherOrg).executeTakeFirstOrThrow();
    await expectCode(acceptSuggestion(db, admin, { id: foreign.id }), "not_found");
    // Solo lectura: ve el equipo (tasks.read_all) pero no decide.
    await expectCode(acceptSuggestion(db, soloLectura, { id: otherRow.id }), "forbidden");
    await expectCode(listSuggestions(db, marketing, {}), "forbidden");
  });

  it("aceptar crea la tarea real (idempotente); posponer y descartar quedan auditados con eventos sin PII", async () => {
    const db = testDb();
    const mine = await listSuggestions(db, agente, {});
    const report = mine.items.find((i) => i.ruleKey === "visit_report" && i.link === `/crm/mis-visitas/${visitA}`)!;
    const a1 = await acceptSuggestion(db, agente, { id: report.id });
    const a2 = await acceptSuggestion(db, agente, { id: report.id });
    expect(a2).toEqual({ taskId: a1.taskId, replayed: true });
    const task = await db.selectFrom("tasks").select(["title", "entity_type", "entity_id", "assigned_user_id", "status", "priority"]).where("id", "=", a1.taskId).executeTakeFirstOrThrow();
    expect(task).toMatchObject({ entity_type: "appointment", entity_id: visitA, assigned_user_id: agente.userId, status: "open", priority: "high" });
    expect(await db.selectFrom("audit_logs").select("action").where("entity_id", "=", report.id).execute()).toEqual([{ action: "AI_RECOMMENDATION_ACCEPTED" }]);
    expect((await listSuggestions(db, agente, {})).items.some((i) => i.id === report.id)).toBe(false);

    const thanks = mine.items.find((i) => i.ruleKey === "visit_thanks" && i.link === `/crm/mis-visitas/${visitA}`)!;
    const now = new Date();
    await expectCode(snoozeSuggestion(db, agente, { id: thanks.id, until: "2020-01-01" }, now), "validation");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + 3 * 24 * HOUR));
    const snoozed = await snoozeSuggestion(db, agente, { id: thanks.id, until: day }, now);
    expect(snoozed.until.toISOString()).toBe(new Date(`${day}T08:00:00-03:00`).toISOString());
    expect((await listSuggestions(db, agente, {})).items.some((i) => i.id === thanks.id)).toBe(false);
    expect((await listSuggestions(db, agente, { estado: "pospuestas" })).items.map((i) => i.id)).toEqual([thanks.id]);
    // Pasada la fecha, vuelve a pendientes.
    expect((await listSuggestions(db, agente, {}, new Date(now.getTime() + 5 * 24 * HOUR))).items.some((i) => i.id === thanks.id)).toBe(true);

    await dismissSuggestion(db, agente, { id: thanks.id, note: "Ya le escribí por teléfono a Juana (387 4123456)" });
    const row = await db.selectFrom("sales_recommendations").select(["status", "dismiss_note", "decided_by"]).where("id", "=", thanks.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "dismissed", decided_by: agente.userId });
    const audits = await db.selectFrom("audit_logs").select(["action", "after"]).where("entity_id", "=", thanks.id).orderBy("id").execute();
    expect(audits.map((a) => a.action)).toEqual(["AI_RECOMMENDATION_SNOOZED", "AI_RECOMMENDATION_DISMISSED"]);
    expect(JSON.stringify(audits)).not.toContain("Juana");
    const events = await db.selectFrom("domain_events").select(["event_type", "payload"]).where("aggregate_id", "in", [report.id, thanks.id]).orderBy("id").execute();
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(["ai.recommendation.accepted", "ai.recommendation.snoozed", "ai.recommendation.dismissed"]));
    expect(JSON.stringify(events)).not.toMatch(/Juana|387/);
  });

  it("vencen solas cuando la situación desaparece; el seguimiento aceptado usa el servicio de visitas (sin duplicar)", async () => {
    const db = testDb();
    await db.insertInto("appointment_reports").values({ appointment_id: visitB, author_user_id: otroAgente.userId, body: "Muy interesado", interest: "high", status: "confirmed", confirmed_by: otroAgente.userId, confirmed_at: new Date() }).execute();
    await refreshSuggestions(db, system, { sources: ["visit"] });
    const recs = await db.selectFrom("sales_recommendations").select(["id", "rule_key", "status", "priority"]).where("entity_id", "=", visitB).orderBy("rule_key").execute();
    expect(recs.find((r) => r.rule_key === "visit_report")!.status).toBe("expired");
    const fu = recs.find((r) => r.rule_key === "visit_followup")!;
    expect(fu).toMatchObject({ status: "open", priority: "high" });
    const accepted = await acceptSuggestion(db, admin, { id: fu.id });
    const appt = await db.selectFrom("appointments").select("follow_up_task_id").where("id", "=", visitB).executeTakeFirstOrThrow();
    expect(appt.follow_up_task_id).toBe(accepted.taskId);
    expect((await db.selectFrom("tasks").select("assigned_user_id").where("id", "=", accepted.taskId).executeTakeFirstOrThrow()).assigned_user_id).toBe(otroAgente.userId);
    await refreshSuggestions(db, system, { sources: ["visit"] });
    expect(await db.selectFrom("sales_recommendations").select("id").where("entity_id", "=", visitB).where("rule_key", "=", "visit_followup").execute()).toHaveLength(1);
  });

  it("ventas: aceptar en la bandeja y en el lead crea UNA tarea; asignaciones solo para quien asigna; reasignar quita el acceso", async () => {
    const db = testDb();
    const mineLead = await lead(db, { hoursAgo: 3, assigned: agente.userId });
    const unassigned = await lead(db, { hoursAgo: 3 });
    await refreshSuggestions(db, system, { sources: ["sales_nba", "assignment"] });
    const agentItems = (await listSuggestions(db, agente, { origen: "ventas" })).items;
    const first = agentItems.find((i) => i.ruleKey === "first_response" && i.link === `/crm/leads/${mineLead.leadId}`)!;
    expect(first).toMatchObject({ priority: "high", sourceLabel: "Ventas · siguiente acción" });
    expect((await listSuggestions(db, agente, { origen: "asignaciones" })).items).toEqual([]);
    expect((await listSuggestions(db, admin, { vista: "equipo", origen: "asignaciones" })).items.map((i) => i.link)).toContain(`/crm/leads/${unassigned.leadId}`);

    const viaInbox = await acceptSuggestion(db, agente, { id: first.id });
    const rec = await db.selectFrom("sales_recommendations").select(["rule_key", "fingerprint"]).where("id", "=", first.id).executeTakeFirstOrThrow();
    const viaLead = await acceptRecommendation(db, agente, { entityType: "contact", entityId: mineLead.contactId, ruleKey: rec.rule_key, fingerprint: rec.fingerprint });
    expect(viaLead.taskId).toBe(viaInbox.taskId);

    // Otro lead del agente, reasignado a otro agente: deja de verse al instante (antes de recalcular).
    const moved = await lead(db, { hoursAgo: 5, assigned: agente.userId });
    await refreshSuggestions(db, system, { sources: ["sales_nba"] });
    expect((await listSuggestions(db, agente, { origen: "ventas" })).items.some((i) => i.link === `/crm/leads/${moved.leadId}`)).toBe(true);
    await db.updateTable("leads").set({ assigned_user_id: otroAgente.userId }).where("id", "=", moved.leadId).execute();
    expect((await listSuggestions(db, agente, { origen: "ventas" })).items.some((i) => i.link === `/crm/leads/${moved.leadId}`)).toBe(false);
  });
});

// ─────────────────────────────── Anomalías ───────────────────────────────

describe("anomalías", () => {
  it("lead sin contactar > 24 h: evidencia sin PII, aviso único con tope diario, se resuelve sola y respeta el alcance", async () => {
    const db = testDb();
    await sql`update ai_anomalies set resolved_at = now()`.execute(db);
    await db.updateTable("settings").set({ value: JSON.stringify(1) }).where("key", "=", "ai.anomalies.max_notifications_per_user_per_day").execute();
    const l1 = await lead(db, { hoursAgo: 30, assigned: otroAgente.userId, name: "Juana Privada" });
    const l2 = await lead(db, { hoursAgo: 40, assigned: otroAgente.userId, name: "Pedro Privado" });
    await detectAnomalies(db, system);
    const rows = await db.selectFrom("ai_anomalies").select(["id", "kind", "severity", "evidence", "entity_id", "assigned_user_id", "notified_at"]).where("entity_id", "in", [l1.leadId, l2.leadId]).execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "lead_uncontacted" && r.severity === "warning" && r.assigned_user_id === otroAgente.userId && r.notified_at)).toBe(true);
    expect(JSON.stringify(rows.map((r) => r.evidence))).not.toMatch(/Juana|Pedro|@/);
    // Tope diario = 1: dos anomalías, un solo aviso.
    const notes = await db.selectFrom("notifications").select("kind").where("user_id", "=", otroAgente.userId).where("kind", "like", "ai.anomaly.%").execute();
    expect(notes).toHaveLength(1);
    await detectAnomalies(db, system);
    expect(await db.selectFrom("ai_anomalies").select("id").where("entity_id", "in", [l1.leadId, l2.leadId]).execute()).toHaveLength(2);
    expect(await db.selectFrom("notifications").select("kind").where("user_id", "=", otroAgente.userId).where("kind", "like", "ai.anomaly.%").execute()).toHaveLength(1);
    expect(await db.selectFrom("domain_events").select("id").where("event_type", "=", "ai.anomaly.detected").where("aggregate_id", "in", rows.map((r) => r.id)).execute()).toHaveLength(2);

    expect((await listOpenAnomalies(db, otroAgente)).map((a) => a.id)).toEqual(expect.arrayContaining(rows.map((r) => r.id)));
    expect((await listOpenAnomalies(db, agente)).some((a) => rows.some((r) => r.id === a.id))).toBe(false);
    expect((await listOpenAnomalies(db, direccion)).length).toBeGreaterThanOrEqual(2);

    await db.updateTable("leads").set({ first_response_at: new Date() }).where("id", "=", l1.leadId).execute();
    await detectAnomalies(db, system);
    expect((await db.selectFrom("ai_anomalies").select("resolved_at").where("entity_id", "=", l1.leadId).executeTakeFirstOrThrow()).resolved_at).not.toBeNull();
    await db.updateTable("settings").set({ value: JSON.stringify(5) }).where("key", "=", "ai.anomalies.max_notifications_per_user_per_day").execute();
  });

  it("caída de consultas: con muestra chica no se afirma nada; con base suficiente sí, y llega a Tareas sugeridas del responsable", async () => {
    const db = testDb();
    const locs = await salesCatalog(db);
    const p = await listedProperty(db, admin, { title: "Casa que dejó de recibir consultas", locationId: locs.salta, amount: 120000 });
    await db.updateTable("properties").set({ published_at: new Date(Date.now() - 120 * 24 * HOUR) }).where("id", "=", p.id).execute();
    await db.deleteFrom("property_agents").where("property_id", "=", p.id).execute();
    await db.insertInto("property_agents").values({ property_id: p.id, user_id: agente.userId, role: "lead" }).execute();
    for (let i = 0; i < 5; i++) await lead(db, { hoursAgo: (20 + i * 7) * 24, propertyId: p.id, status: "discarded" });
    await detectAnomalies(db, system);
    expect(await db.selectFrom("ai_anomalies").select("id").where("entity_id", "=", p.id).execute()).toEqual([]);
    for (let i = 0; i < 19; i++) await lead(db, { hoursAgo: (16 + i * 2.5) * 24, propertyId: p.id, status: "discarded" });
    await detectAnomalies(db, system);
    const a = await db.selectFrom("ai_anomalies").select(["kind", "severity", "assigned_user_id"]).where("entity_id", "=", p.id).executeTakeFirstOrThrow();
    expect(a).toEqual({ kind: "property_inquiry_drop", severity: "warning", assigned_user_id: agente.userId });
    await refreshSuggestions(db, system, { sources: ["anomaly"] });
    const s = (await listSuggestions(db, agente, { origen: "anomalias" })).items;
    expect(s.map((x) => x.link)).toContain(`/crm/propiedades/${p.id}`);
  });

  it("pico de jobs muertos: anomalía de la organización visible solo para quien ve operaciones", async () => {
    const db = testDb();
    for (let i = 0; i < 6; i++) await db.insertInto("jobs").values({ type: "test.spike", status: "dead", finished_at: new Date(), last_error: "x", attempts: 1 }).execute();
    await detectAnomalies(db, system);
    const spike = await db.selectFrom("ai_anomalies").select(["id", "entity_type"]).where("kind", "=", "job_failure_spike").where("resolved_at", "is", null).executeTakeFirstOrThrow();
    expect(spike.entity_type).toBe("organization");
    expect((await listOpenAnomalies(db, admin)).some((x) => x.id === spike.id)).toBe(true);
    expect((await listOpenAnomalies(db, agente)).some((x) => x.id === spike.id)).toBe(false);
    await refreshSuggestions(db, system, { sources: ["anomaly"] });
    expect((await listSuggestions(db, admin, { vista: "equipo", origen: "anomalias" })).items.some((x) => x.link === "/crm/sistema/jobs?status=dead")).toBe(true);
    expect((await listSuggestions(db, soloLectura, { vista: "equipo", origen: "anomalias" })).items.some((x) => x.link === "/crm/sistema/jobs?status=dead")).toBe(true);
    await sql`delete from jobs where type = 'test.spike'`.execute(db);
  });
});

// ─────────────────────────────── Resumen de hoy ───────────────────────────────

describe("Resumen de hoy", () => {
  it("por rol y alcance, con links a listas filtradas; ceros ocultos; otra organización no suma", async () => {
    const db = testDb();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Salta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const noon = new Date(`${today}T12:00:00-03:00`);
    await db.insertInto("appointments").values({ kind: "visit", title: "Visita de hoy", starts_at: noon, ends_at: new Date(noon.getTime() + HOUR), property_id: propId, assigned_user_id: agente.userId, status: "completed", finished_at: new Date(noon.getTime() + HOUR) }).execute();
    await db.insertInto("tasks").values({ title: "Seguimiento vencido", kind: "follow_up", due_at: new Date(Date.now() - 2 * HOUR), assigned_user_id: agente.userId }).execute();
    await db.insertInto("tasks").values({ title: "Seguimiento ajeno", kind: "follow_up", due_at: new Date(Date.now() - 2 * HOUR), assigned_user_id: otherOrgUser, created_by: otherOrgUser }).execute();

    const b = (await getDailyBrief(db, agente))!;
    expect(b.greeting).toMatch(/^Buen día|^Buenas tardes|^Buenas noches/);
    const agentKeys = Object.fromEntries(b.items.map((i) => [i.key, i]));
    const dayFrom = new Date(`${today}T00:00:00-03:00`);
    const dayTo = new Date(dayFrom.getTime() + 24 * HOUR);
    const agentVisits = await sql<{ n: number }>`select count(*)::int as n from appointments where kind = 'visit' and status <> 'cancelled' and assigned_user_id = ${agente.userId}
      and starts_at >= ${dayFrom} and starts_at < ${dayTo}`.execute(db);
    expect(agentKeys.visits_today).toMatchObject({ count: agentVisits.rows[0]!.n, scope: "own", href: "/crm/mis-visitas" });
    expect(agentKeys.visits_today!.count).toBeGreaterThanOrEqual(1);
    expect(agentKeys.overdue_followups).toMatchObject({ count: 1, scope: "own", href: "/crm/tareas?status=overdue&kind=follow_up" });
    expect(agentKeys.unassigned_visits).toBeUndefined();
    expect(b.items.every((i) => i.count > 0)).toBe(true);

    const a = (await getDailyBrief(db, admin))!;
    const adminKeys = Object.fromEntries(a.items.map((i) => [i.key, i]));
    expect(adminKeys.overdue_followups).toMatchObject({ scope: "all", href: "/crm/tareas?status=overdue&kind=follow_up&view=team" });
    const orgFollowUps = await sql<{ n: number }>`select count(*)::int as n from tasks t join users u on u.id = t.assigned_user_id where t.kind = 'follow_up' and t.status = 'open' and t.due_at < now() and u.organization_id = ${admin.organizationId}`.execute(db);
    expect(adminKeys.overdue_followups!.count).toBe(orgFollowUps.rows[0]!.n);
    expect(adminKeys.visits_today).toMatchObject({ scope: "all", href: "/crm/centro-operativo" });
    expect(adminKeys.clients_follow_up?.href).toBe("/crm/tareas-sugeridas?origen=ventas&vista=equipo");

    // Marketing no tiene visitas ni tareas: esos ítems no existen para su rol.
    const m = (await getDailyBrief(db, marketing))!;
    expect(m.items.some((i) => ["visits_today", "overdue_followups", "clients_follow_up", "high_intent_leads"].includes(i.key))).toBe(false);
  });

  it("cache por usuario y día, invalidación y límite de «Actualizar»; flag apagado = sin tarjeta", async () => {
    const db = testDb();
    const first = (await getDailyBrief(db, otroAgente))!;
    const again = (await getDailyBrief(db, otroAgente))!;
    expect(again.computedAt.getTime()).toBe(first.computedAt.getTime());
    await markBriefsStale(db, [otroAgente.userId]);
    const recomputed = (await getDailyBrief(db, otroAgente))!;
    expect(recomputed.computedAt.getTime()).toBeGreaterThan(first.computedAt.getTime());
    await refreshDailyBrief(db, otroAgente);
    await expectCode(refreshDailyBrief(db, otroAgente), "rate_limited");
    await setFlag(db, "ai_daily_brief", false);
    expect(await getDailyBrief(db, otroAgente)).toBeNull();
    await setFlag(db, "ai_daily_brief", true);
  });

  it("con clave: 2–3 líneas verificadas contra los conteos; cifra inventada o proveedor caído → sin redacción, la tarjeta sigue", async () => {
    const db = testDb();
    const brief = (await getDailyBrief(db, agente, { refresh: true }))!;
    const n = brief.items.find((i) => i.key === "overdue_followups")!.count;
    const tool = (value: Record<string, unknown>) => result([{ type: "tool_use", id: "t", name: "emitir_resultado", input: value }], "tool_use", "claude-haiku-4-5-20251001");
    const good = new FakeProvider([tool({ hechos: `Tenés ${n} seguimiento vencido y visitas para hoy.`, interpretacion: ["Conviene arrancar por el seguimiento."] })]);
    setTaskProviderForTests(good);
    const withAi = (await getDailyBrief(db, agente, { refresh: true }))!;
    expect(withAi.narrative).toEqual({ hechos: `Tenés ${n} seguimiento vencido y visitas para hoy.`, interpretacion: ["Conviene arrancar por el seguimiento."] });
    expect(good.calls[0]!.system.join("\n")).toContain('<datos_no_confiables origen="conteos">');
    // Mismos conteos: no se vuelve a llamar al modelo.
    await getDailyBrief(db, agente, { refresh: true });
    expect(good.calls).toHaveLength(1);

    // Cambian los conteos → nueva redacción; el modelo inventa una cifra → se descarta.
    await db.insertInto("tasks").values({ title: "Otro seguimiento vencido", kind: "follow_up", due_at: new Date(Date.now() - HOUR), assigned_user_id: agente.userId }).execute();
    const liar = new FakeProvider([tool({ hechos: "Tenés 99 seguimientos vencidos.", interpretacion: [] })]);
    setTaskProviderForTests(liar);
    const blocked = (await getDailyBrief(db, agente, { refresh: true }))!;
    expect(blocked.narrative).toBeNull();
    expect(blocked.items.find((i) => i.key === "overdue_followups")!.count).toBe(n + 1);
    const usage = await db.selectFrom("ai_interactions").select(["status", "fallback_reason"]).where("feature", "=", "management.daily_brief").orderBy("created_at", "desc").executeTakeFirstOrThrow();
    expect(usage).toEqual({ status: "blocked", fallback_reason: "guard_blocked" });

    await db.insertInto("tasks").values({ title: "Tercer seguimiento vencido", kind: "follow_up", due_at: new Date(Date.now() - HOUR), assigned_user_id: agente.userId }).execute();
    setTaskProviderForTests(new FakeProvider([new Error("503 Service Unavailable")]));
    const down = (await getDailyBrief(db, agente, { refresh: true }))!;
    expect(down.narrative).toBeNull();
    expect(down.items.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────── Centro de comando, observabilidad, compatibles ───────────────────────────────

describe("Centro de comando, observabilidad y compatibles", () => {
  it("dirección ve el centro compuesto; un agente no; con el flag apagado no está disponible", async () => {
    const db = testDb();
    const c = await getCommandCenter(db, direccion);
    expect(c.brief).not.toBeNull();
    expect(c.suggestions!.length).toBeGreaterThan(0);
    expect(c.anomalies.length).toBeGreaterThan(0);
    expect(c.visits).not.toBeNull();
    expect(c.aiHealth!.automations).toBeDefined();
    await expectCode(getCommandCenter(db, agente), "forbidden");
    await expectCode(getCommandCenter(db, soloLectura), "forbidden");
    await setFlag(db, "ai_executive", false);
    await expectCode(getCommandCenter(db, admin), "unavailable");
    await setFlag(db, "ai_executive", true);
  });

  it("Uso de IA: automatizaciones de IA y gestión por función; sin permiso, prohibido", async () => {
    const db = testDb();
    const u = await getAiUsage(db, admin, { days: 7 });
    expect(u.automations.map((a) => a.key)).toEqual(expect.arrayContaining(["ai_reaction_visit_finished", "sales_lead_qualify", "ai_quality_property_created"]));
    expect(u.management.suggestions.map((s) => s.source)).toEqual(expect.arrayContaining(["visit", "sales_nba", "anomaly"]));
    expect(u.byFeature.find((f) => f.feature === "management.daily_brief")).toMatchObject({ requests: expect.any(Number) });
    await expectCode(getAiUsage(db, agente, {}), "forbidden");
  });

  it("propiedades nuevas con compradores compatibles: cada agente ve solo las de sus clientes", async () => {
    const db = testDb();
    const locs = await salesCatalog(db);
    const p = await listedProperty(db, admin, { title: "Casa nueva compatible", locationId: locs.tresCerritos, amount: 150000 });
    const cliente = await contactIn(db, admin.organizationId, "Comprador de otro agente", otroAgente.userId);
    await db.insertInto("property_matches").values({ organization_id: admin.organizationId, contact_id: cliente, property_id: p.id, score: 80, algorithm_version: "match-test", trigger: "property_published", status: "candidate" }).execute();
    expect((await listProperties(db, admin, { compatibles: "recientes" })).items.map((x) => x.id)).toContain(p.id);
    expect((await listProperties(db, otroAgente, { compatibles: "recientes" })).items.map((x) => x.id)).toContain(p.id);
    expect((await listProperties(db, agente, { compatibles: "recientes" })).items.map((x) => x.id)).not.toContain(p.id);
    expect((await listProperties(db, marketing, { compatibles: "recientes" })).total).toBe(0);
    await organizationId(db);
  });
});
