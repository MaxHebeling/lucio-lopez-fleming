import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { queueMessage } from "@/server/messaging/outbound";
import { resumeAwaitingMessages, sendQueuedMessage } from "@/server/messaging/send";
import { registerWhatsAppTemplateSender } from "@/server/messaging/whatsapp-bridge";
import { runJobs } from "@/server/jobs/runner";
import { PermanentJobError } from "@/server/jobs/registry";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { emitEvent } from "@/server/events";
import { json, loadIntegrationReferenceData, mockHttp, setFlag } from "../helpers/integrations";
import { testDb, testSystemActor } from "../helpers/db";

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL", "EMAIL_INTERNAL_TO"] as const;
const saved: Record<string, string | undefined> = {};

async function message(dedupe: string, over: Partial<Parameters<typeof queueMessage>[1]> = {}) {
  const id = await queueMessage(testDb(), {
    channel: "email",
    to: "ana@example.com",
    templateKey: "password_reset",
    payload: { fullName: "Ana", resetUrl: "/crm/restablecer?token=un-solo-uso", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    dedupeKey: dedupe,
    ...over,
  });
  return id!;
}

describe("mensajería saliente (email)", () => {
  beforeAll(async () => {
    await loadIntegrationReferenceData(testDb());
  });
  beforeEach(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.APP_URL = "https://www.luciolopezfleming.com.ar";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    await sql`delete from jobs`.execute(testDb());
    await setFlag(testDb(), "outbound_email", true);
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    registerWhatsAppTemplateSender(undefined);
  });

  it("sin RESEND_API_KEY/EMAIL_FROM → awaiting_credentials visible, nunca sent, sin HTTP", async () => {
    const db = testDb();
    const http = mockHttp([]);
    try {
      const id = await message("t:no-creds");
      const r = await sendQueuedMessage(db, id);
      expect(r.outcome).toBe("awaiting_credentials");
      const row = await db.selectFrom("outbound_messages").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.status).toBe("awaiting_credentials");
      expect(row.last_error).toMatch(/RESEND_API_KEY/);
      expect(http.calls).toHaveLength(0);
      const integ = await db.selectFrom("integrations").select(["status", "last_error"]).where("key", "=", "resend").executeTakeFirstOrThrow();
      expect(integ.status).toBe("awaiting_credentials");
    } finally {
      http.restore();
    }
  });

  it("flag outbound_email apagado → awaiting_credentials aunque haya credenciales", async () => {
    const db = testDb();
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.EMAIL_FROM = "Lucio López Fleming <avisos@luciolopezfleming.com.ar>";
    await setFlag(db, "outbound_email", false);
    const http = mockHttp([]);
    try {
      const id = await message("t:flag-off");
      expect((await sendQueuedMessage(db, id)).outcome).toBe("awaiting_credentials");
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it("envía una sola vez con Idempotency-Key, guarda provider id y redacta el link de un solo uso", async () => {
    const db = testDb();
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.EMAIL_FROM = "Lucio López Fleming <avisos@luciolopezfleming.com.ar>";
    const http = mockHttp([(c) => (c.url === "https://api.resend.com/emails" && c.method === "POST" ? json({ id: "email_abc" }) : undefined)]);
    try {
      const id = await message("t:send-once");
      // El job lo procesa el worker (camino real: queueMessage → messaging.send)
      const stats = await runJobs(db, { budgetMs: 5_000 });
      expect(stats.succeeded).toBeGreaterThanOrEqual(1);
      // Reejecución manual del handler: no reenvía
      expect((await sendQueuedMessage(db, id)).outcome).toBe("skipped");

      expect(http.calls).toHaveLength(1);
      const call = http.calls[0]!;
      expect(call.headers["idempotency-key"]).toBe("t:send-once");
      expect(call.headers.authorization).toBe("Bearer re_test_123");
      const body = JSON.parse(call.body);
      expect(body.to).toEqual(["ana@example.com"]);
      expect(body.html).toContain("https://www.luciolopezfleming.com.ar/crm/restablecer?token=un-solo-uso");
      expect(body.text).toContain("restablecer");

      const row = await db.selectFrom("outbound_messages").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "sent", provider_message_id: "email_abc", attempts: 1 });
      expect(row.sent_at).not.toBeNull();
      expect(JSON.stringify(row.payload)).not.toContain("un-solo-uso");
      const logs = await db.selectFrom("integration_logs").select(["status", "operation"]).where("integration_key", "=", "resend").execute();
      expect(logs).toContainEqual({ status: "ok", operation: "emails.send" });
    } finally {
      http.restore();
    }
  });

  it("5xx → failed reintentable; 4xx → error permanente; plantilla desconocida → permanente sin HTTP", async () => {
    const db = testDb();
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.EMAIL_FROM = "avisos@luciolopezfleming.com.ar";
    let mode: "500" | "422" = "500";
    const http = mockHttp([(c) => (c.url.includes("resend") ? json({ name: "error", message: mode === "500" ? "boom" : "Invalid `to` field" }, Number(mode)) : undefined)]);
    try {
      const a = await message("t:5xx");
      await expect(sendQueuedMessage(db, a)).rejects.not.toBeInstanceOf(PermanentJobError);
      expect((await db.selectFrom("outbound_messages").select(["status", "last_error"]).where("id", "=", a).executeTakeFirstOrThrow()).status).toBe("failed");

      mode = "422";
      const b = await message("t:4xx");
      await expect(sendQueuedMessage(db, b)).rejects.toBeInstanceOf(PermanentJobError);

      const before = http.calls.length;
      const c = await message("t:unknown", { templateKey: "plantilla_inexistente" });
      await expect(sendQueuedMessage(db, c)).rejects.toBeInstanceOf(PermanentJobError);
      expect(http.calls.length).toBe(before);
      expect((await db.selectFrom("outbound_messages").select(["status", "last_error"]).where("id", "=", c).executeTakeFirstOrThrow()).last_error).toMatch(/desconocida/);
    } finally {
      http.restore();
    }
  });

  it("links temporales vencidos se cancelan en vez de enviarse tarde", async () => {
    const db = testDb();
    const id = await message("t:expired", { payload: { fullName: "Ana", resetUrl: "/crm/restablecer?token=viejo", expiresAt: new Date(Date.now() - 1000).toISOString() } });
    expect((await sendQueuedMessage(db, id)).outcome).toBe("cancelled");
    const row = await db.selectFrom("outbound_messages").select(["status", "payload"]).where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.status).toBe("cancelled");
    expect(JSON.stringify(row.payload)).not.toContain("viejo");
  });

  it("WhatsApp sin sendWhatsAppTemplate registrado → awaiting_credentials (no se simula); con sender → sent", async () => {
    const db = testDb();
    await setFlag(db, "outbound_whatsapp", true);
    const id = await message("t:wa", { channel: "whatsapp", to: "+5493875551234", templateKey: "rent_due_reminder", payload: { x: 1 } });
    expect((await sendQueuedMessage(db, id)).outcome).toBe("awaiting_credentials");
    expect((await db.selectFrom("outbound_messages").select("last_error").where("id", "=", id).executeTakeFirstOrThrow()).last_error).toMatch(/sendWhatsAppTemplate/);

    let calls = 0;
    registerWhatsAppTemplateSender(async () => {
      calls++;
      return { status: "sent", providerMessageId: "wamid.1" };
    });
    expect(await resumeAwaitingMessages(db)).toMatchObject({ requeued: expect.any(Number) });
    await runJobs(db, { budgetMs: 5_000 });
    expect(calls).toBe(1);
    expect((await db.selectFrom("outbound_messages").select(["status", "provider_message_id"]).where("id", "=", id).executeTakeFirstOrThrow())).toEqual({ status: "sent", provider_message_id: "wamid.1" });
    await setFlag(db, "outbound_whatsapp", false);
  });

  it("lead.created → aviso interno por email (sin datos de contacto) a EMAIL_INTERNAL_TO, una sola vez", async () => {
    const db = testDb();
    process.env.EMAIL_INTERNAL_TO = "ventas@luciolopezfleming.com.ar, gerencia@luciolopezfleming.com.ar";
    const system = await testSystemActor(db);
    const contact = await db.insertInto("contacts").values({ organization_id: system.organizationId, display_name: "Juan <b>Pérez</b>", kind: "person" }).returning("id").executeTakeFirstOrThrow();
    const lead = await db
      .insertInto("leads")
      .values({ organization_id: system.organizationId, contact_id: contact.id, source_key: "web_contact", message: "Quiero visitar la casa" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await emitEvent(db, system, { type: "lead.created", aggregateType: "lead", aggregateId: lead.id, payload: {} });
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 8_000 });
    await dispatchPendingEvents(db);
    const msgs = await db.selectFrom("outbound_messages").selectAll().where("template_key", "=", "lead_internal_notice").where("entity_id", "=", lead.id).execute();
    expect(msgs.map((m) => m.to_address).sort()).toEqual(["gerencia@luciolopezfleming.com.ar", "ventas@luciolopezfleming.com.ar"]);
    expect(msgs.every((m) => m.status === "awaiting_credentials")).toBe(true);
    expect(JSON.stringify(msgs[0]!.payload)).not.toMatch(/@example|\+54/);
  });
});
