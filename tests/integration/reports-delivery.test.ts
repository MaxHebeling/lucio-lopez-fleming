/** Envío de informes a propietarios: un envío que no salió (sin credenciales / fallido) no deja el informe trabado. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "@/server/jobs/handlers";
import { sql } from "@/server/db";
import { sendQueuedMessage } from "@/server/messaging/send";
import { generateOwnerReport, getReport, sendOwnerReport, syncReportDeliveryStatus } from "@/server/reports/service";
import { todayInSalta } from "@/server/rentals/dates";
import { loadIntegrationReferenceData, setFlag } from "../helpers/integrations";
import { createOwner, createStaff, testDb } from "../helpers/db";
import { createTestProperty, monthStart } from "../helpers/rentals";

describe("reenvío de informes", () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, app: process.env.APP_URL };
  beforeAll(async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    process.env.APP_URL = "https://www.luciolopezfleming.com.ar";
    await loadIntegrationReferenceData(testDb());
    await setFlag(testDb(), "outbound_email", true);
  });
  afterAll(() => {
    for (const [k, v] of [["RESEND_API_KEY", saved.key], ["EMAIL_FROM", saved.from], ["APP_URL", saved.app]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("sin credenciales: el informe refleja el estado y se puede reenviar sin duplicar el aviso pendiente", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createOwner(db, "Rita Reenvío");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner.contactId }] });
    const report = await generateOwnerReport(db, staff, { ownerContactId: owner.contactId, propertyId: property.id, periodStart: monthStart(0), periodEnd: todayInSalta() });

    const first = await sendOwnerReport(db, staff, report.id);
    // Mientras el primer mensaje está en cola, no se reenvía (evita duplicados)
    await expect(sendOwnerReport(db, staff, report.id)).rejects.toMatchObject({ code: "conflict" });
    expect((await sendQueuedMessage(db, first.messageId!)).outcome).toBe("awaiting_credentials");

    // Aunque el job de sincronización todavía no corrió, el equipo ve el estado real y puede reenviar
    const detail = await getReport(db, staff, report.id);
    expect(detail.delivery).toMatchObject({ status: "awaiting_credentials" });
    const second = await sendOwnerReport(db, staff, report.id);
    expect(second.messageId).not.toBe(first.messageId);
    const firstRow = await db.selectFrom("outbound_messages").select(["status"]).where("id", "=", first.messageId!).executeTakeFirstOrThrow();
    expect(firstRow.status).toBe("cancelled"); // el anterior no se reanuda cuando lleguen las credenciales

    // La sincronización refleja "sin credenciales" en el informe
    expect((await sendQueuedMessage(db, second.messageId!)).outcome).toBe("awaiting_credentials");
    await syncReportDeliveryStatus(db);
    const r1 = await db.selectFrom("owner_reports").select(["status", "last_error"]).where("id", "=", report.id).executeTakeFirstOrThrow();
    expect(r1.status).toBe("awaiting_credentials");
    expect(r1.last_error).toMatch(/RESEND_API_KEY/);

    // Fallido → también se reenvía; enviado → ya no
    await sql`update outbound_messages set status = 'failed', last_error = 'rebotado' where id = ${second.messageId}`.execute(db);
    const third = await sendOwnerReport(db, staff, report.id);
    await sql`update outbound_messages set status = 'sent', sent_at = now() where id = ${third.messageId}`.execute(db);
    await expect(sendOwnerReport(db, staff, report.id)).rejects.toThrow(/ya fue enviado/);
    await syncReportDeliveryStatus(db);
    expect((await db.selectFrom("owner_reports").select("status").where("id", "=", report.id).executeTakeFirstOrThrow()).status).toBe("sent");
    const audits = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", report.id).execute();
    expect(audits.filter((a) => a.action === "OWNER_REPORT_QUEUED")).toHaveLength(3);
  });
});
