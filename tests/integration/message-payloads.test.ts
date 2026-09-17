/**
 * Contrato productor ↔ plantilla: cada productor REAL encola una fila en outbound_messages y esa fila, tal como quedó
 * guardada, tiene que renderizar con su plantilla (email) o armar su plantilla de WhatsApp sin errores.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "@/server/jobs/handlers";
import { sql } from "@/server/db";
import { getJobHandler } from "@/server/jobs/registry";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { renderEmail, renderWhatsApp } from "@/server/messaging/templates";
import { inviteUser } from "@/server/users/service";
import { requestPasswordReset } from "@/server/account/recovery";
import { inviteOwner, requestOwnerPasswordReset } from "@/server/owners/access";
import { generateOwnerReport, sendOwnerReport } from "@/server/reports/service";
import { activateContract, createContract } from "@/server/rentals/contracts";
import { registerPayment } from "@/server/rentals/payments";
import { emitRentDue } from "@/server/rentals/jobs";
import { addDays, todayInSalta } from "@/server/rentals/dates";
import { systemActor } from "@/server/auth/actor";
import { organizationId } from "@/server/org";
import { createOwner, createStaff, testDb, testSystemActor } from "../helpers/db";
import { contractInput, createTestContact, createTestProperty, idemKey, monthStart } from "../helpers/rentals";

type Row = { id: string; channel: string; template_key: string; payload: unknown };

async function messagesFor(entityId: string): Promise<Row[]> {
  return testDb().selectFrom("outbound_messages").select(["id", "channel", "template_key", "payload"]).where("entity_id", "=", entityId).orderBy("created_at").execute();
}

function renderRow(row: Row): unknown {
  return row.channel === "email" ? renderEmail(row.template_key, row.payload) : renderWhatsApp(row.template_key, row.payload as Record<string, unknown>);
}

function emailText(row: Row | undefined): string {
  expect(row?.channel).toBe("email");
  return renderEmail(row!.template_key, row!.payload).text;
}

async function runRentalAutomations() {
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

describe("payloads encolados por los productores reales renderizan con su plantilla", () => {
  const prevAppUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = "https://www.luciolopezfleming.com.ar";
  });
  afterAll(() => {
    process.env.APP_URL = prevAppUrl;
  });

  it("invitación de equipo (con y sin quien invita)", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["super_admin"]);
    const byPerson = await inviteUser(db, admin, { email: `nuevo-${crypto.randomUUID().slice(0, 6)}@test.local`, fullName: "Nora Nueva", roles: ["agente"] });
    const bySystem = await inviteUser(db, await testSystemActor(db), { email: `sistema-${crypto.randomUUID().slice(0, 6)}@test.local`, fullName: "Sergio Script", roles: ["agente"] });
    const [a] = await messagesFor(byPerson.userId);
    const [b] = await messagesFor(bySystem.userId);
    expect(emailText(a)).toContain(admin.fullName);
    expect(emailText(b)).toContain("Tenés acceso al CRM");
    // El link va una sola vez y en la clave del contrato (nada de copias en otras claves)
    expect(Object.keys(a!.payload as object)).not.toContain("resetUrl");
    expect(emailText(a)).toContain(byPerson.inviteUrl);
    expect(emailText(a)).toContain("72 horas");
  });

  it("recuperación de contraseña del equipo", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    expect(await requestPasswordReset(db, { email: staff.email })).toBe("queued");
    const [m] = await messagesFor(staff.userId);
    expect(emailText(m)).toContain("/crm/restablecer?token=");
  });

  it("invitación y recuperación del propietario", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["direccion"]);
    const contact = await createTestContact(db, "Olga Propietaria", "olga.payload@test.local");
    await createTestProperty(db, { ownerContactIds: [{ id: contact }] });
    const invite = await inviteOwner(db, staff, { contactId: contact, email: "olga.payload@test.local", confirmEmail: "olga.payload@test.local" });
    const [inv] = await messagesFor(invite.userId);
    const invText = emailText(inv);
    expect(invText).toContain("Hola, Olga Propietaria.");
    expect(invText).toContain("/propietarios/restablecer?token=");
    expect(invText).toContain("72 horas");

    const owner = await createOwner(db, "Pablo Recupero");
    await requestOwnerPasswordReset(db, owner.email);
    const [reset] = await messagesFor(owner.userId);
    const resetText = emailText(reset);
    expect(resetText).toContain("Hola, Pablo Recupero.");
    expect(resetText).toContain("60 minutos");
  });

  it("informe listo para el propietario", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createOwner(db, "Quimey Informe");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner.contactId }] });
    const report = await generateOwnerReport(db, staff, { ownerContactId: owner.contactId, propertyId: property.id, periodStart: monthStart(-1), periodEnd: addDays(monthStart(0), -1) });
    await sendOwnerReport(db, staff, report.id);
    const [m] = await messagesFor(report.id);
    const text = emailText(m);
    expect(text).toContain("Hola, Quimey Informe.");
    expect(text).toContain(`https://www.luciolopezfleming.com.ar/propietarios/informes/${report.id}`);
  });

  it("recordatorio de alquiler por email y por WhatsApp, con el saldo pendiente de una cuota parcialmente pagada", async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createTestContact(db, "Dueña Payload");
    const byEmail = await createTestContact(db, "Inés Email", "ines.payload@test.local");
    const byWhatsapp = await createTestContact(db, "Walter WhatsApp");
    await db.insertInto("contact_phones").values({ contact_id: byWhatsapp, phone_raw: "387 555-1234", phone_e164: "+5493875551234", is_whatsapp: true, is_primary: true }).execute();
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner }], [{ contactId: byEmail }, { contactId: byWhatsapp }]));
    await activateContract(db, staff, c.id);
    const tomorrow = addDays(todayInSalta(), 1);
    const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", c.id).orderBy("period_start", "desc").executeTakeFirstOrThrow();
    await db.updateTable("rent_obligations").set({ due_date: tomorrow, status: "pending" }).where("id", "=", ob.id).execute();
    await registerPayment(db, staff, { obligationId: ob.id, amount: "100000", paidOn: todayInSalta(), method: "transfer", idempotencyKey: idemKey() });

    expect(await emitRentDue(db, await testSystemActor(db))).toBeGreaterThanOrEqual(1);
    await dispatchPendingEvents(db);
    await runRentalAutomations();

    const rows = await messagesFor(c.id);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "whatsapp"]);
    for (const row of rows) expect(() => renderRow(row)).not.toThrow();

    const email = rows.find((r) => r.channel === "email")!;
    const text = renderEmail(email.template_key, email.payload).text;
    expect(text).toContain(`Propiedad de prueba ${property.code}`);
    expect(text).toContain("$ 350.000"); // 450.000 − 100.000 pagados
    expect(text).not.toContain("450.000");

    const wa = rows.find((r) => r.channel === "whatsapp")!;
    const spec = renderWhatsApp(wa.template_key, wa.payload as Record<string, unknown>);
    expect(spec.name).toBe("rent_due_reminder");
    expect(spec.bodyParameters).toHaveLength(4);
    expect(spec.bodyParameters[0]).toBe("Walter WhatsApp");
    expect(spec.bodyParameters[3]).toBe("$ 350.000");
    // Lo guardado en la fila es exactamente lo que el sender de WhatsApp va a leer
    expect((wa.payload as { whatsappTemplate: unknown }).whatsappTemplate).toEqual({ name: spec.name, bodyParameters: spec.bodyParameters });
  });
});
