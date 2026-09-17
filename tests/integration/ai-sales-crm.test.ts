/**
 * IA Fase 2 · Ventas — CRM contra Postgres real: perfil del comprador (campos cerrados, sugerido/confirmado, historial,
 * RBAC y otra organización), coincidencias (filtros duros, alcance), match inverso idempotente SIN contacto automático,
 * siguiente acción (aceptar crea tarea, descartar/posponer se registra), calificación de leads, «Ponme al día» en el
 * copiloto y memoria de cliente del AI Core.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import "@/server/jobs/handlers";
import { sql } from "@/server/db";
import type { StaffActor } from "@/server/auth/actor";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { runJobs } from "@/server/jobs/runner";
import { changePrice } from "@/server/properties/service";
import { clearPreference, confirmPreference, getBuyerProfile, proposePreferences, rejectPreference, setPreference } from "@/server/sales/profile/service";
import { BuyerProfileMemory } from "@/server/sales/profile/memory";
import { computeMatchesForProperty, dismissMatch, listCompatibleClients, listCompatibleProperties } from "@/server/sales/matching/service";
import { acceptRecommendation, dismissRecommendation, getNextActions, snoozeRecommendation } from "@/server/sales/nba/service";
import { getLeadQualification, qualifyLead } from "@/server/sales/qualification/service";
import { createDefaultRegistry } from "@/server/ai/domains";
import { askCopilot, getCopilotStatus } from "@/server/ai/copilot/service";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { setFlag } from "../helpers/integrations";
import { FakeProvider, result } from "../helpers/ai";
import { contactIn, listedProperty, resetSalesCaches, salesCatalog } from "../helpers/sales";

let admin: StaffActor;
let agente: StaffActor;
let otroAgente: StaffActor;
let alquileres: StaffActor;
let locs: Awaited<ReturnType<typeof salesCatalog>>;
let enPresupuesto: { id: string; code: number };
let caraSinTolerancia: { id: string; code: number };
let reservada: { id: string; code: number };
let noPublicada: { id: string; code: number };
let deptoAlquiler: { id: string; code: number };
let clienteAgente: string;
let clienteOtro: string;
let clienteAjeno: string;
let otherOrgId: string;

const TYPES_CASA = { contactId: "", field: "property_types", value: ["casa"] };

async function withProfile(actor: StaffActor, contactId: string) {
  const db = testDb();
  await setPreference(db, actor, { ...TYPES_CASA, contactId });
  await setPreference(db, actor, { contactId, field: "transaction_type", value: "sale" });
  await setPreference(db, actor, { contactId, field: "budget", value: { min: null, max: 180000, currency: "USD" } });
  await setPreference(db, actor, { contactId, field: "locations", value: [{ kind: "area", slug: "tres-cerritos", name: "Tres Cerritos, Salta", localitySlug: "salta" }] });
  await setPreference(db, actor, { contactId, field: "bedrooms_min", value: 3 });
}

beforeAll(async () => {
  const db = testDb();
  admin = await createStaff(db, ["administrador"]);
  agente = await createStaff(db, ["agente"]);
  otroAgente = await createStaff(db, ["agente"]);
  alquileres = await createStaff(db, ["alquileres"]);
  locs = await salesCatalog(db);
  enPresupuesto = await listedProperty(db, admin, { title: "Casa 3 dormitorios con jardín", locationId: locs.tresCerritos, amount: 175000, bedrooms: 3, features: ["jardin"] });
  caraSinTolerancia = await listedProperty(db, admin, { title: "Casa cara", locationId: locs.tresCerritos, amount: 250000, bedrooms: 4 });
  reservada = await listedProperty(db, admin, { title: "Casa reservada", locationId: locs.tresCerritos, amount: 160000, bedrooms: 3, status: "reserved" });
  noPublicada = await listedProperty(db, admin, { title: "Casa sin publicar", locationId: locs.tresCerritos, amount: 150000, bedrooms: 3, publish: false });
  deptoAlquiler = await listedProperty(db, admin, { title: "Depto en alquiler", typeKey: "departamento", locationId: locs.tresCerritos, amount: 700000, currency: "ARS", operation: "rent", bedrooms: 1 });
  clienteAgente = await contactIn(db, admin.organizationId, "Cliente Del Agente", agente.userId);
  clienteOtro = await contactIn(db, admin.organizationId, "Cliente De Otro Agente", otroAgente.userId);
  otherOrgId = (await db.insertInto("organizations").values({ name: "Otra inmobiliaria", slug: "otra-inmo-sales" }).returning("id").executeTakeFirstOrThrow()).id;
  clienteAjeno = await contactIn(db, otherOrgId, "Cliente de otra organización", agente.userId);
  resetSalesCaches();
});

describe("perfil del comprador", () => {
  it("el equipo carga datos confirmados, con auditoría, historial y recálculo encolado", async () => {
    const db = testDb();
    await withProfile(agente, clienteAgente);
    const p = await getBuyerProfile(db, agente, clienteAgente);
    expect(p.confirmedCount).toBe(5);
    expect(p.fields.find((f) => f.field === "budget")!.confirmed!.display).toBe("Hasta USD 180.000");
    expect(await db.selectFrom("audit_logs").select("id").where("action", "=", "CLIENT_PREFERENCE_SET").where("entity_id", "=", clienteAgente).execute()).toHaveLength(5);
    expect(await db.selectFrom("jobs").select("id").where("dedupe_key", "=", `sales.match_contact:${clienteAgente}`).execute()).toHaveLength(1);
    // Mismo valor otra vez: sin cambios ni historial nuevo
    expect(await setPreference(db, agente, { contactId: clienteAgente, field: "bedrooms_min", value: 3 })).toMatchObject({ changed: false });
    await setPreference(db, agente, { contactId: clienteAgente, field: "bedrooms_min", value: 2 });
    await setPreference(db, agente, { contactId: clienteAgente, field: "bedrooms_min", value: 3 });
    const hist = (await getBuyerProfile(db, agente, clienteAgente)).history.filter((h) => h.field === "bedrooms_min");
    expect(hist.map((h) => h.status)).toEqual(["confirmed", "superseded", "superseded"]);
  });

  it("lista cerrada: campos o claves sensibles, catálogos inexistentes y valores inválidos se rechazan", async () => {
    const db = testDb();
    await expect(setPreference(db, admin, { contactId: clienteAgente, field: "religion", value: "x" })).rejects.toThrow();
    await expect(setPreference(db, admin, { contactId: clienteAgente, field: "budget", value: { max: 100000, currency: "USD", min: null, salud: "x" } })).rejects.toMatchObject({ code: "validation" });
    await expect(setPreference(db, admin, { contactId: clienteAgente, field: "features", value: ["helipuerto"] })).rejects.toMatchObject({ code: "validation" });
    await expect(setPreference(db, admin, { contactId: clienteAgente, field: "locations", value: [{ kind: "locality", slug: "narnia", name: "Narnia", localitySlug: null }] })).rejects.toMatchObject({ code: "validation" });
    await expect(setPreference(db, admin, { contactId: clienteAgente, field: "budget", value: { min: 200000, max: 100000, currency: "USD" } })).rejects.toMatchObject({ code: "validation" });
  });

  it("sugerencias: nunca pisan lo confirmado, no se repiten, se confirman o descartan con decisión registrada", async () => {
    const db = testDb();
    const c = await contactIn(db, admin.organizationId, "Cliente Sugerido", agente.userId);
    const first = await proposePreferences(db, { organizationId: admin.organizationId, contactId: c, source: "concierge", items: [{ field: "bedrooms_min", value: 2, confidence: 0.9 }, { field: "notes", value: "no", confidence: 1 }, { field: "features", value: ["inventada"], confidence: 1 }] });
    expect(first.proposed).toHaveLength(1);
    expect((await proposePreferences(db, { organizationId: admin.organizationId, contactId: c, source: "form", items: [{ field: "bedrooms_min", value: 2, confidence: 0.9 }] })).proposed).toHaveLength(0);
    await expect(confirmPreference(db, otroAgente, { preferenceId: first.proposed[0] })).rejects.toMatchObject({ code: "not_found" });
    expect(await confirmPreference(db, agente, { preferenceId: first.proposed[0] })).toEqual({ changed: true });
    const s2 = await proposePreferences(db, { organizationId: admin.organizationId, contactId: c, source: "lead_message", items: [{ field: "bedrooms_min", value: 4, confidence: 0.6 }] });
    expect(await rejectPreference(db, agente, { preferenceId: s2.proposed[0] })).toEqual({ changed: true });
    // Lo que el equipo descartó no se vuelve a proponer
    expect((await proposePreferences(db, { organizationId: admin.organizationId, contactId: c, source: "lead_message", items: [{ field: "bedrooms_min", value: 4, confidence: 0.6 }] })).proposed).toHaveLength(0);
    const p = await getBuyerProfile(db, agente, c);
    expect(p.fields.find((f) => f.field === "bedrooms_min")).toMatchObject({ confirmed: { value: 2, source: "concierge" }, suggested: null });
    expect(await clearPreference(db, agente, { contactId: c, field: "bedrooms_min" })).toEqual({ changed: true });
  });

  it("RBAC: agente solo sus clientes; otra organización nunca; rol sin alcance comercial no ve perfiles", async () => {
    const db = testDb();
    await expect(getBuyerProfile(db, agente, clienteOtro)).rejects.toMatchObject({ code: "not_found" });
    await expect(setPreference(db, agente, { contactId: clienteOtro, field: "bedrooms_min", value: 2 })).rejects.toMatchObject({ code: "not_found" });
    await expect(getBuyerProfile(db, admin, clienteAjeno)).rejects.toMatchObject({ code: "not_found" });
    await expect(getBuyerProfile(db, agente, clienteAjeno)).rejects.toMatchObject({ code: "not_found" });
    await expect(getBuyerProfile(db, alquileres, clienteAgente)).rejects.toMatchObject({ code: "forbidden" });
    expect((await getBuyerProfile(db, admin, clienteOtro)).canEdit).toBe(true);
  });

  it("memoria de cliente del AI Core: solo confirmados; las propuestas quedan sugeridas", async () => {
    const db = testDb();
    const memory = new BuyerProfileMemory();
    const p = await memory.getProfile(db, agente, clienteAgente);
    expect(p).toMatchObject({ contactId: clienteAgente, operation: "sale", propertyTypes: ["casa"], budgetMax: 180000, budgetCurrency: "USD", minBedrooms: 3, localities: ["Tres Cerritos, Salta"] });
    const c = await contactIn(db, admin.organizationId, "Cliente Memoria", agente.userId);
    expect(await memory.getProfile(db, agente, c)).toBeNull();
    const { proposalId } = await memory.proposeUpdate(db, agente, c, { operation: "rent", minBedrooms: 2 });
    expect(proposalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await memory.getProfile(db, agente, c)).toBeNull();
    expect(await db.selectFrom("client_preferences").select(["status", "source"]).where("contact_id", "=", c).execute()).toEqual([
      { status: "suggested", source: "conversation" },
      { status: "suggested", source: "conversation" },
    ]);
  });
});

describe("coincidencias", () => {
  it("filtros duros: presupuesto con tolerancia, disponibilidad, publicación y operación; explicación y etiqueta estimada", async () => {
    const db = testDb();
    const r = await listCompatibleProperties(db, agente, clienteAgente);
    expect(r.matchable).toBe(true);
    expect(r.items.map((i) => i.code)).toEqual([enPresupuesto.code]);
    const [item] = r.items;
    expect(item!.matched).toEqual(expect.arrayContaining(["En venta", "Casa", "Presupuesto", "3 dormitorios"]));
    expect(r.items.map((i) => i.code)).not.toContain(caraSinTolerancia.code);
    expect(r.items.map((i) => i.code)).not.toContain(reservada.code);
    expect(r.items.map((i) => i.code)).not.toContain(noPublicada.code);
    expect(r.items.map((i) => i.code)).not.toContain(deptoAlquiler.code);
  });

  it("cliente sin preferencias: no hay coincidencias y se explica qué falta", async () => {
    const db = testDb();
    const c = await contactIn(db, admin.organizationId, "Cliente Vacío", agente.userId);
    const r = await listCompatibleProperties(db, agente, c);
    expect(r).toMatchObject({ matchable: false, items: [] });
    expect(r.missing.length).toBe(2);
  });

  it("clientes compatibles de una propiedad: el agente ve solo los suyos; administración todos", async () => {
    const db = testDb();
    await withProfile(otroAgente, clienteOtro);
    const all = await listCompatibleClients(db, admin, enPresupuesto.id);
    expect(all.items.map((i) => i.name).sort()).toEqual(["Cliente De Otro Agente", "Cliente Del Agente"]);
    const own = await listCompatibleClients(db, agente, enPresupuesto.id);
    expect(own).toMatchObject({ scope: "own" });
    expect(own.items.map((i) => i.name)).toEqual(["Cliente Del Agente"]);
    expect((await listCompatibleClients(db, admin, reservada.id)).available).toBe(false);
  });

  it("descartar con motivo: sale de compatibles, queda auditado y alimenta la siguiente acción", async () => {
    const db = testDb();
    const c = await contactIn(db, admin.organizationId, "Cliente Descarta", agente.userId);
    await withProfile(agente, c);
    await expect(dismissMatch(db, otroAgente, { contactId: c, propertyId: enPresupuesto.id, reason: "price" })).rejects.toMatchObject({ code: "not_found" });
    expect(await dismissMatch(db, agente, { contactId: c, propertyId: enPresupuesto.id, reason: "price" })).toEqual({ changed: true });
    expect(await dismissMatch(db, agente, { contactId: c, propertyId: enPresupuesto.id, reason: "price" })).toEqual({ changed: false });
    expect((await listCompatibleProperties(db, agente, c)).items).toEqual([]);
    expect((await listCompatibleProperties(db, agente, c)).dismissed).toBe(1);
  });
});

describe("match inverso (job)", () => {
  it("idempotente, avisa al agente responsable una sola vez y NUNCA contacta al cliente", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    await sql`delete from property_matches where property_id = ${enPresupuesto.id} and status <> 'dismissed'`.execute(db);
    await sql`delete from notifications where kind = 'sales.match'`.execute(db);
    const outboundBefore = (await sql<{ n: number }>`select (select count(*) from outbound_messages)::int + (select count(*) from conversation_messages)::int as n`.execute(db)).rows[0]!.n;
    const first = await computeMatchesForProperty(db, system, enPresupuesto.id, "property_published", "1");
    expect(first).toMatchObject({ newCandidates: 2, notified: 2 });
    const second = await computeMatchesForProperty(db, system, enPresupuesto.id, "property_published", "1");
    expect(second).toMatchObject({ newCandidates: 0, notified: 0 });
    const rows = await db.selectFrom("property_matches").select(["contact_id", "status", "score", "algorithm_version", "notified_user_id"]).where("property_id", "=", enPresupuesto.id).execute();
    expect(rows.filter((r) => r.status === "candidate")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "dismissed")).toHaveLength(1);
    expect(rows.every((r) => r.algorithm_version.startsWith("match-"))).toBe(true);
    const notes = await db.selectFrom("notifications").select(["user_id", "title", "link"]).where("kind", "=", "sales.match").execute();
    expect(notes.map((n) => n.user_id).sort()).toEqual([agente.userId, otroAgente.userId].sort());
    expect(notes[0]!.link).toBe(`/crm/propiedades/${enPresupuesto.id}#clientes-compatibles`);
    const outboundAfter = (await sql<{ n: number }>`select (select count(*) from outbound_messages)::int + (select count(*) from conversation_messages)::int as n`.execute(db)).rows[0]!.n;
    expect(outboundAfter).toBe(outboundBefore);
    const events = await db.selectFrom("domain_events").select(["payload"]).where("event_type", "=", "match.candidates_computed").where("aggregate_id", "=", enPresupuesto.id).execute();
    expect(events).toHaveLength(1);
  });

  it("un aumento de precio fuera de la tolerancia deja las coincidencias obsoletas (y las descartadas siguen descartadas)", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    await changePrice(db, admin, enPresupuesto.id, { operation: "sale", currency: "USD", amount: 260000, priceHidden: false });
    const r = await computeMatchesForProperty(db, system, enPresupuesto.id, "price_changed", "2");
    expect(r.candidates).toBe(0);
    expect(r.stale).toBe(2);
    expect(await db.selectFrom("property_matches").select("status").where("property_id", "=", enPresupuesto.id).where("status", "=", "dismissed").execute()).toHaveLength(1);
    await changePrice(db, admin, enPresupuesto.id, { operation: "sale", currency: "USD", amount: 175000, priceHidden: false });
    await computeMatchesForProperty(db, system, enPresupuesto.id, "price_changed", "3");
  });

  it("vía automatización: property.published → job → candidatos (sin loops: nadie escucha match.candidates_computed)", async () => {
    const db = testDb();
    const nueva = await listedProperty(db, admin, { title: "Casa recién publicada", locationId: locs.tresCerritos, amount: 170000, bedrooms: 3 });
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 300_000 });
    const rows = await db.selectFrom("property_matches").select(["contact_id", "trigger"]).where("property_id", "=", nueva.id).execute();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.trigger === "property_published")).toBe(true);
    const listeners = await db.selectFrom("automation_definitions").select("key").where("trigger_event", "in", ["match.candidates_computed", "lead.qualified", "recommendation.created", "recommendation.accepted", "recommendation.dismissed"]).execute();
    expect(listeners).toEqual([]);
  });
});

describe("siguiente acción recomendada", () => {
  async function leadWithVisit(assigned: StaffActor) {
    const db = testDb();
    const c = await contactIn(db, admin.organizationId, `Cliente Visita ${randomUUID().slice(0, 4)}`, assigned.userId);
    const lead = await db.insertInto("leads").values({ organization_id: admin.organizationId, contact_id: c, source_key: "web_property", property_id: enPresupuesto.id, assigned_user_id: assigned.userId, created_at: new Date(Date.now() - 5 * 3_600_000) }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("activities").values({ entity_type: "contact", entity_id: c, kind: "visit_requested", summary: "Pidió visita", metadata: JSON.stringify({ leadId: lead.id, propertyId: enPresupuesto.id }) }).execute();
    return { contactId: c, leadId: lead.id };
  }

  it("aceptar crea una tarea real (idempotente) y se registra con evento; descartar y posponer ocultan la sugerencia", async () => {
    const db = testDb();
    const { contactId, leadId } = await leadWithVisit(agente);
    const r = await getNextActions(db, agente, { entityType: "lead", entityId: leadId });
    expect(r.items.map((i) => i.ruleKey)).toEqual(expect.arrayContaining(["contact_today", "schedule_visit"]));
    const visit = r.items.find((i) => i.ruleKey === "schedule_visit")!;
    expect(visit.reason).toBe(`Pidió visitar la propiedad #${enPresupuesto.code} y no hay una visita agendada.`);

    const decision = { entityType: "lead" as const, entityId: leadId, ruleKey: visit.ruleKey, fingerprint: visit.fingerprint };
    const accepted = await acceptRecommendation(db, agente, decision);
    const again = await acceptRecommendation(db, agente, decision);
    expect(again).toEqual({ taskId: accepted.taskId, replayed: true });
    const task = await db.selectFrom("tasks").selectAll().where("id", "=", accepted.taskId).executeTakeFirstOrThrow();
    expect(task).toMatchObject({ entity_type: "lead", entity_id: leadId, assigned_user_id: agente.userId, status: "open", kind: "call" });
    expect(await db.selectFrom("sales_recommendations").select(["status", "task_id"]).where("contact_id", "=", contactId).where("rule_key", "=", "schedule_visit").executeTakeFirstOrThrow()).toEqual({ status: "accepted", task_id: accepted.taskId });
    expect(await db.selectFrom("domain_events").select("id").where("event_type", "=", "recommendation.accepted").execute()).toHaveLength(1);

    // Desde la ficha del contacto la sugerencia ya decidida tampoco aparece
    const contact = await getNextActions(db, agente, { entityType: "contact", entityId: contactId });
    expect(contact.items.map((i) => i.ruleKey)).not.toContain("schedule_visit");

    const today = r.items.find((i) => i.ruleKey === "contact_today")!;
    await snoozeRecommendation(db, agente, { entityType: "lead", entityId: leadId, ruleKey: today.ruleKey, fingerprint: today.fingerprint, days: 3 });
    const after = await getNextActions(db, agente, { entityType: "lead", entityId: leadId });
    expect(after.items.map((i) => i.ruleKey)).not.toContain("contact_today");
    const other = after.items[0];
    if (other) {
      await dismissRecommendation(db, agente, { entityType: "lead", entityId: leadId, ruleKey: other.ruleKey, fingerprint: other.fingerprint, note: "ya lo hablamos" });
      expect((await getNextActions(db, agente, { entityType: "lead", entityId: leadId })).items.map((i) => i.ruleKey)).not.toContain(other.ruleKey);
    }
  });

  it("una huella que ya no aplica no crea tareas; lead de otro agente → 404", async () => {
    const db = testDb();
    const { leadId } = await leadWithVisit(otroAgente);
    await expect(getNextActions(db, agente, { entityType: "lead", entityId: leadId })).rejects.toMatchObject({ code: "not_found" });
    await expect(acceptRecommendation(db, otroAgente, { entityType: "lead", entityId: leadId, ruleKey: "schedule_visit", fingerprint: "0".repeat(32) })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("calificación de leads", () => {
  it("resumen determinista + sugerencias desde la consulta escrita, siguiente acción propuesta y lead.qualified (idempotente)", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    const c = await contactIn(db, admin.organizationId, "Cliente Consulta", agente.userId);
    const lead = await db
      .insertInto("leads")
      .values({ organization_id: admin.organizationId, contact_id: c, source_key: "web_contact", assigned_user_id: agente.userId, operation_interest: "sale", message: "Hola, busco casa de 3 dormitorios en Tres Cerritos hasta USD 200.000. Mi DNI es 30.123.456." })
      .returning("id")
      .executeTakeFirstOrThrow();
    const r1 = await qualifyLead(db, system, lead.id, { provider: null });
    expect(r1.suggested).toBeGreaterThanOrEqual(4);
    expect(r1.recommendations).toBeGreaterThan(0);
    const r2 = await qualifyLead(db, system, lead.id, { provider: null });
    expect(r2.suggested).toBe(0);
    expect(await db.selectFrom("domain_events").select("id").where("event_type", "=", "lead.qualified").where("aggregate_id", "=", lead.id).execute()).toHaveLength(1);
    const prefs = await db.selectFrom("client_preferences").select(["field", "source", "status"]).where("contact_id", "=", c).execute();
    expect(prefs.every((p) => p.source === "lead_message" && p.status === "suggested")).toBe(true);

    const summary = await getLeadQualification(db, agente, lead.id);
    expect(summary.rows.find((r) => r.key === "budget")).toMatchObject({ value: "Hasta USD 200.000", confirmed: false });
    expect(summary.missing).toEqual(expect.arrayContaining(["Plazo para mudarse o cerrar", "Cómo piensa pagar (contado o crédito)"]));
    await expect(getLeadQualification(db, otroAgente, lead.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("con IA: la consulta viaja minimizada (sin DNI) y como datos; cifras inventadas se descartan", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    const c = await contactIn(db, admin.organizationId, "Cliente IA", agente.userId);
    const lead = await db.insertInto("leads").values({ organization_id: admin.organizationId, contact_id: c, source_key: "web_contact", message: "Quiero algo para vivir con mi familia, DNI 30.123.456, que tenga pileta" }).returning("id").executeTakeFirstOrThrow();
    const out = { transactionType: null, propertyTypes: [], budgetMin: null, budgetMax: 500000, currency: "USD", locations: [], bedrooms: null, bathrooms: null, surfaceMin: null, surfaceMax: null, garages: null, features: ["pileta"], moveTimeframe: null, financing: null, preferences: [], unparsed: [] };
    const fake = new FakeProvider([result([{ type: "tool_use", id: "t1", name: "necesidades_del_cliente", input: out }], "tool_use", "claude-haiku-4-5-20251001")]);
    const r = await qualifyLead(db, system, lead.id, { provider: fake });
    expect(String(fake.calls[0]!.messages[0]!.content)).not.toContain("30.123.456");
    expect(String(fake.calls[0]!.messages[0]!.content)).toContain("<datos_no_confiables");
    expect(r.aiUsed).toBe(false); // monto inventado → guarda
    const row = await db.selectFrom("ai_interactions").select(["purpose", "status", "fallback_reason", "user_id"]).where("feature", "=", "sales.lead_qualification").orderBy("created_at", "desc").executeTakeFirstOrThrow();
    expect(row).toEqual({ purpose: "lead_qualification", status: "fallback", fallback_reason: "guard_blocked", user_id: null });
  });
});

describe("«Ponme al día» en el copiloto", () => {
  it("chip solo con un contacto o lead en pantalla y el flag encendido; hechos con alcance del agente", async () => {
    const db = testDb();
    const noScreen = await getCopilotStatus(db, agente, { path: "/crm" }, { provider: null });
    expect(noScreen.quickQueries.map((q) => q.id)).not.toContain("ponme_al_dia");
    const onContact = await getCopilotStatus(db, agente, { path: `/crm/contactos/${clienteAgente}` }, { provider: null });
    expect(onContact.quickQueries.map((q) => q.id)).toContain("ponme_al_dia");
    const answer = await askCopilot(db, agente, { mode: "analyst", quickQueryId: "ponme_al_dia", path: `/crm/contactos/${clienteAgente}` }, { provider: null });
    const facts = answer.facts[0]!;
    expect(facts.title).toBe("Ponme al día · Cliente Del Agente");
    expect(facts.items.map((i) => i.label)).toEqual(expect.arrayContaining(["Presupuesto: Hasta USD 180.000", "Zonas: Tres Cerritos, Salta"]));
    expect(JSON.stringify(facts)).not.toMatch(/@|\+54/);
    // Contacto de otro agente en pantalla: se ignora el contexto (sin revelar existencia) y no hay chip
    const foreign = await getCopilotStatus(db, agente, { path: `/crm/contactos/${clienteOtro}` }, { provider: null });
    expect(foreign.quickQueries.map((q) => q.id)).toContain("ponme_al_dia"); // contacts.read ve la ficha…
    const denied = await askCopilot(db, agente, { mode: "analyst", quickQueryId: "ponme_al_dia", path: `/crm/contactos/${clienteOtro}` }, { provider: null });
    expect(denied.facts).toEqual([]); // …pero el perfil comercial está fuera de su alcance
    await setFlag(db, "ai_matching", false);
    expect((await getCopilotStatus(db, agente, { path: `/crm/contactos/${clienteAgente}` }, { provider: null })).quickQueries.map((q) => q.id)).not.toContain("ponme_al_dia");
    await setFlag(db, "ai_matching", true);
  });

  it("la herramienta está registrada como read con permisos de leads", () => {
    const t = createDefaultRegistry().get("client_briefing")!;
    expect(t).toMatchObject({ capability: "read", domain: "sales", permissions: ["leads.read_own", "leads.read_all"] });
  });
});
