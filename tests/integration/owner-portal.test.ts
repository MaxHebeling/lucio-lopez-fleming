/** Portal de propietarios: aislamiento (listados e IDOR), acceso, invitación e informes. */
import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { login, consumePasswordReset } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { AppError } from "@/server/errors";
import { resetFlagCache } from "@/server/flags";
import { organizationId } from "@/server/org";
import {
  getOwnerContract,
  getOwnerProperty,
  getOwnerReport,
  getOwnerSettlement,
  listOwnerContracts,
  listOwnerDocuments,
  listOwnerProperties,
  listOwnerReports,
  listOwnerSettlements,
  ownerDocumentFile,
} from "@/server/owners/portal";
import { inviteOwner, isResetTokenValid, requestOwnerPasswordReset } from "@/server/owners/access";
import { generateOwnerReport, sendOwnerReport, syncReportDeliveryStatus } from "@/server/reports/service";
import { listContracts } from "@/server/rentals/queries";
import { activateContract, createContract } from "@/server/rentals/contracts";
import { registerPayment } from "@/server/rentals/payments";
import { approveSettlement, generateSettlements } from "@/server/rentals/settlements";
import { todayInSalta } from "@/server/rentals/dates";
import type { OwnerActor } from "@/server/auth/actor";
import { createOwner, createStaff, testDb, TEST_PASSWORD } from "../helpers/db";
import { contractInput, createTestContact, createTestProperty, idemKey, monthStart } from "../helpers/rentals";

async function ownerWorld(name: string) {
  const db = testDb();
  const staff = await createStaff(db, ["direccion"]);
  const owner = await createOwner(db, name);
  const property = await createTestProperty(db, { ownerContactIds: [{ id: owner.contactId }], published: false });
  const tenant = await createTestContact(db, `Inquilino de ${name}`);
  const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner.contactId }], [{ contactId: tenant }]));
  await activateContract(db, staff, c.id);
  const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", c.id).orderBy("period_start").executeTakeFirstOrThrow();
  await registerPayment(db, staff, { obligationId: ob.id, amount: "450000", paidOn: todayInSalta(), method: "transfer", idempotencyKey: idemKey() });
  const [s] = await generateSettlements(db, staff, { contractId: c.id, month: todayInSalta().slice(0, 7) });
  await approveSettlement(db, staff, s!.settlementId!);
  const orgFile = await db
    .insertInto("files")
    .values({ storage_driver: "local", bucket: "private", storage_key: `test/${crypto.randomUUID()}.pdf`, content_type: "application/pdf", size_bytes: 10, visibility: "private" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const visibleDoc = await db.insertInto("rental_contract_documents").values({ contract_id: c.id, file_id: orgFile.id, kind: "contract", title: "Contrato firmado", visible_to_owner: true }).returning("id").executeTakeFirstOrThrow();
  const hiddenDoc = await db.insertInto("rental_contract_documents").values({ contract_id: c.id, file_id: orgFile.id, kind: "guarantee", title: "Garantía (interna)", visible_to_owner: false }).returning("id").executeTakeFirstOrThrow();
  const propDoc = await db.insertInto("property_documents").values({ property_id: property.id, file_id: orgFile.id, kind: "deed", title: "Escritura", visible_to_owner: true }).returning("id").executeTakeFirstOrThrow();
  const report = await generateOwnerReport(db, staff, { ownerContactId: owner.contactId, periodStart: monthStart(0), periodEnd: todayInSalta() });
  await sendOwnerReport(db, staff, report.id);
  return { db, staff, owner, property, contractId: c.id, settlementId: s!.settlementId!, visibleDoc: visibleDoc.id, hiddenDoc: hiddenDoc.id, propDoc: propDoc.id, reportId: report.id };
}

describe("aislamiento del portal de propietarios", () => {
  it("A no ve propiedades, contratos, liquidaciones, documentos ni informes de B (listados ni por id)", async () => {
    const a = await ownerWorld("Ana Propietaria");
    const b = await ownerWorld("Beto Propietario");
    const db = a.db;

    expect((await listOwnerProperties(db, a.owner)).map((p) => p.id)).toEqual([a.property.id]);
    expect((await listOwnerContracts(db, a.owner)).map((c) => c.id)).toEqual([a.contractId]);
    expect((await listOwnerSettlements(db, a.owner)).map((s) => s.id)).toEqual([a.settlementId]);
    expect((await listOwnerReports(db, a.owner)).map((r) => r.id)).toEqual([a.reportId]);
    const docs = await listOwnerDocuments(db, a.owner);
    expect(docs.map((d) => d.id).sort()).toEqual([a.visibleDoc, a.propDoc].sort());

    // IDOR: ids de B en la URL → no encontrado
    await expect(getOwnerProperty(db, a.owner, b.property.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getOwnerContract(db, a.owner, b.contractId)).rejects.toMatchObject({ code: "not_found" });
    await expect(getOwnerSettlement(db, a.owner, b.settlementId)).rejects.toMatchObject({ code: "not_found" });
    await expect(getOwnerReport(db, a.owner, b.reportId)).rejects.toMatchObject({ code: "not_found" });
    expect(await ownerDocumentFile(db, a.owner, "contrato", b.visibleDoc)).toBeNull();
    expect(await ownerDocumentFile(db, a.owner, "propiedad", b.propDoc)).toBeNull();
    // Ni siquiera documentos propios no marcados como visibles
    expect(await ownerDocumentFile(db, a.owner, "contrato", a.hiddenDoc)).toBeNull();
    expect(await ownerDocumentFile(db, a.owner, "contrato", a.visibleDoc)).toMatchObject({ title: "Contrato firmado" });
    await expect(getOwnerProperty(db, a.owner, "no-es-un-uuid")).rejects.toMatchObject({ code: "not_found" });

    // Lo propio sí se ve, con actividad agregada y sin datos del inquilino más allá del nombre
    const own = await getOwnerContract(db, a.owner, a.contractId);
    expect(own.tenants).toEqual(["Inquilino de Ana Propietaria"]);
    expect(Object.keys(own.contract)).not.toContain("notes");
    const prop = await getOwnerProperty(db, a.owner, a.property.id);
    expect(prop.activity).toHaveLength(12);

    // Un contacto propietario que es parte de un contrato ajeno con otro rol (garante) no ve ese contrato
    await db.insertInto("rental_contract_parties").values({ contract_id: b.contractId, contact_id: a.owner.contactId, role: "guarantor" }).execute();
    expect((await listOwnerContracts(db, a.owner)).map((c) => c.id)).toEqual([a.contractId]);
    await expect(getOwnerContract(db, a.owner, b.contractId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("borradores de liquidación e informes sin enviar no se muestran", async () => {
    const a = await ownerWorld("Carla Propietaria");
    const db = a.db;
    const draft = await generateOwnerReport(db, a.staff, { ownerContactId: a.owner.contactId, periodStart: monthStart(-1), periodEnd: monthStart(0) });
    expect((await listOwnerReports(db, a.owner)).map((r) => r.id)).not.toContain(draft.id);
    await expect(getOwnerReport(db, a.owner, draft.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("staff no entra por el login de propietarios; propietario no usa servicios del CRM; flag apaga el portal", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["super_admin"]);
    expect((await login(db, { email: staff.email, password: TEST_PASSWORD, area: "owner" })).ok).toBe(false);
    const owner = await createOwner(db, "Dora Propietaria");
    await expect(listContracts(db, owner, {})).rejects.toBeInstanceOf(AppError);
    await expect(listOwnerProperties(db, staff as unknown as OwnerActor)).rejects.toMatchObject({ code: "forbidden" });

    await db.updateTable("feature_flags").set({ enabled: false }).where("key", "=", "owner_portal").execute();
    resetFlagCache();
    await expect(listOwnerProperties(db, owner)).rejects.toMatchObject({ code: "unavailable" });
    await db.updateTable("feature_flags").set({ enabled: true }).where("key", "=", "owner_portal").execute();
    resetFlagCache();
  });
});

describe("invitación y recuperación de acceso", () => {
  it("invita (72 h), el propietario define contraseña y entra; reinvitar invalida el token anterior", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]); // reports.generate
    const agent = await createStaff(db, ["agente"]);
    const contact = await createTestContact(db, "Elena Nueva", "elena.nueva@test.local");
    await expect(inviteOwner(db, staff, { contactId: contact })).rejects.toThrow(/no figura como propietario/);
    await createTestProperty(db, { ownerContactIds: [{ id: contact }] });
    await expect(inviteOwner(db, agent, { contactId: contact })).rejects.toMatchObject({ code: "forbidden" });

    const first = await inviteOwner(db, staff, { contactId: contact });
    expect(first).toMatchObject({ email: "elena.nueva@test.local", created: true });
    const user = await db.selectFrom("users").select(["kind", "contact_id", "password_hash"]).where("id", "=", first.userId).executeTakeFirstOrThrow();
    expect(user).toEqual({ kind: "owner", contact_id: contact, password_hash: null });
    const msg1 = await db.selectFrom("outbound_messages").select(["template_key", "payload", "to_address"]).where("entity_id", "=", first.userId).executeTakeFirstOrThrow();
    expect(msg1.template_key).toBe("owner_invite");
    const token1 = new URL(String((msg1.payload as { inviteUrl: string }).inviteUrl)).searchParams.get("token")!;
    const tok = await db.selectFrom("password_reset_tokens").select(["expires_at"]).where("token_hash", "=", hashToken(token1)).executeTakeFirstOrThrow();
    const hours = (tok.expires_at.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);

    const second = await inviteOwner(db, staff, { contactId: contact });
    expect(second).toMatchObject({ userId: first.userId, created: false });
    expect(await isResetTokenValid(db, token1)).toBe(false);
    const msgs = await db.selectFrom("outbound_messages").select("payload").where("entity_id", "=", first.userId).orderBy("created_at", "desc").execute();
    const token2 = new URL(String((msgs[0]!.payload as { inviteUrl: string }).inviteUrl)).searchParams.get("token")!;
    expect(await isResetTokenValid(db, token2)).toBe(true);
    expect(await consumePasswordReset(db, token2, "Clave-propietaria-2026")).toBe(true);
    expect((await login(db, { email: "elena.nueva@test.local", password: "Clave-propietaria-2026", area: "owner" })).ok).toBe(true);
    const audits = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", first.userId).orderBy("id").execute();
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["OWNER_INVITED", "OWNER_REINVITED", "PASSWORD_RESET", "LOGIN"]));
  });

  it("recuperar contraseña solo aplica a propietarios y no revela si el email existe", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    const owner = await createOwner(db, "Fabio Propietario");
    await requestOwnerPasswordReset(db, staff.email);
    await requestOwnerPasswordReset(db, "nadie@test.local");
    expect(await db.selectFrom("password_reset_tokens").select("id").where("user_id", "=", staff.userId).execute()).toHaveLength(0);
    await requestOwnerPasswordReset(db, owner.email.toUpperCase());
    const msg = await db.selectFrom("outbound_messages").select(["template_key", "to_address"]).where("entity_id", "=", owner.userId).execute();
    expect(msg).toEqual([{ template_key: "owner_password_reset", to_address: owner.email }]);
  });
});

describe("informes a propietarios", () => {
  it("snapshot con datos reales, idempotente por período, envío con estados", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createOwner(db, "Gabriela Informe");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner.contactId }], published: true });
    const orgId = await organizationId(db);
    // Actividad real cargada en la base: 2 consultas (una web, una WhatsApp) y 1 visita realizada
    const lead = await createTestContact(db, "Interesado Privado", "interesado.privado@test.local");
    for (const source of ["web_property", "whatsapp"]) {
      await db.insertInto("leads").values({ organization_id: orgId, contact_id: lead, source_key: source, property_id: property.id }).execute();
    }
    const now = new Date();
    await db
      .insertInto("appointments")
      .values({ kind: "visit", title: "Visita", starts_at: new Date(now.getTime() - 3_600_000), ends_at: new Date(now.getTime() - 1_800_000), status: "completed", property_id: property.id, assigned_user_id: staff.userId })
      .execute();
    await db.insertInto("property_price_history").values({ property_id: property.id, operation: "rent", new_currency: "ARS", new_amount: "500000", source: "crm" }).execute();

    const input = { ownerContactId: owner.contactId, propertyId: property.id, periodStart: monthStart(0), periodEnd: todayInSalta() };
    const r1 = await generateOwnerReport(db, staff, input);
    const r2 = await generateOwnerReport(db, staff, input);
    expect(r2).toEqual({ id: r1.id, created: false, refreshed: false });
    const [c1, c2] = await Promise.all([
      generateOwnerReport(db, staff, { ...input, periodStart: monthStart(-1) }),
      generateOwnerReport(db, staff, { ...input, periodStart: monthStart(-1) }),
    ]);
    expect(c1.id).toBe(c2.id);

    const row = await db.selectFrom("owner_reports").select(["data", "status"]).where("id", "=", r1.id).executeTakeFirstOrThrow();
    const data = row.data as unknown as import("@/server/reports/service").ReportData;
    expect(data.properties).toHaveLength(1);
    expect(data.properties[0]).toMatchObject({
      inquiries: { total: 2, byChannel: [{ channel: "web", count: 1 }, { channel: "whatsapp", count: 1 }] },
      visits: { completed: 1 },
      isPublished: true,
      publicPath: `/propiedades/${property.slug}`,
    });
    expect(data.properties[0]!.priceChanges).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("interesado.privado");
    expect(JSON.stringify(data)).not.toContain("Interesado Privado");

    // Sin usuario de portal activo no se envía (otro propietario sin acceso)
    const noPortal = await createTestContact(db, "Sin Portal");
    const p2 = await createTestProperty(db, { ownerContactIds: [{ id: noPortal }] });
    const r3 = await generateOwnerReport(db, staff, { ownerContactId: noPortal, propertyId: p2.id, periodStart: monthStart(0), periodEnd: todayInSalta() });
    await expect(sendOwnerReport(db, staff, r3.id)).rejects.toThrow(/invitalo/);

    await sendOwnerReport(db, staff, r1.id);
    await expect(sendOwnerReport(db, staff, r1.id)).rejects.toThrow(/ya fue enviado/);
    const queued = await db.selectFrom("owner_reports").select("status").where("id", "=", r1.id).executeTakeFirstOrThrow();
    expect(queued.status).toBe("queued");
    const msg = await db.selectFrom("outbound_messages").select(["id", "template_key", "payload"]).where("entity_id", "=", r1.id).executeTakeFirstOrThrow();
    expect(msg.template_key).toBe("owner_report_ready");
    expect((msg.payload as { reportUrl: string }).reportUrl).toMatch(new RegExp(`/propietarios/informes/${r1.id}$`));

    await sql`update outbound_messages set status = 'failed', last_error = 'rebotado' where id = ${msg.id}`.execute(db);
    expect((await syncReportDeliveryStatus(db)).updated).toBeGreaterThanOrEqual(1);
    expect((await db.selectFrom("owner_reports").select(["status", "last_error"]).where("id", "=", r1.id).executeTakeFirstOrThrow())).toEqual({ status: "failed", last_error: "rebotado" });
    await sendOwnerReport(db, staff, r1.id); // reenvío tras falla
    const msgs = await db.selectFrom("outbound_messages").select("id").where("entity_id", "=", r1.id).execute();
    expect(msgs).toHaveLength(2);
    await sql`update outbound_messages set status = 'sent', sent_at = now() where entity_id = ${r1.id} and status = 'queued'`.execute(db);
    await syncReportDeliveryStatus(db);
    expect((await db.selectFrom("owner_reports").select("status").where("id", "=", r1.id).executeTakeFirstOrThrow()).status).toBe("sent");
  });
});
