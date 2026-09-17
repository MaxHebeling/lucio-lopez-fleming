import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { callIntegration, countsAsIntegrationFailure, RetryableError, TimeoutError, UncertainOutcomeError } from "@/server/resilience";
import { PermanentIntegrationError } from "@/server/integrations/http";
import { testDb } from "../helpers/db";

const KEY = "mercadolibre";

async function state() {
  return testDb().selectFrom("integrations").select(["consecutive_failures", "circuit_open_until", "status"]).where("key", "=", KEY).executeTakeFirstOrThrow();
}

async function failWith(e: unknown) {
  await expect(callIntegration(testDb(), KEY, "items.test", async () => Promise.reject(e))).rejects.toBe(e);
}

describe("circuit breaker: qué cuenta como falla de la integración", () => {
  beforeEach(async () => {
    const db = testDb();
    await sql`update integrations set consecutive_failures = 0, circuit_open_until = null, status = 'active' where key = ${KEY}`.execute(db);
    await sql`delete from domain_events where event_type = 'integration.failed'`.execute(db);
  });

  it("clasifica: 4xx de datos no; credenciales, límites, 5xx, timeouts y red sí", () => {
    for (const s of [400, 404, 409, 422]) expect(countsAsIntegrationFailure(new PermanentIntegrationError("dato", s))).toBe(false);
    for (const s of [401, 403]) expect(countsAsIntegrationFailure(new PermanentIntegrationError("credenciales", s))).toBe(true);
    for (const s of [408, 429, 500, 503]) expect(countsAsIntegrationFailure(new RetryableError("transitorio", s))).toBe(true);
    expect(countsAsIntegrationFailure(new TimeoutError(10))).toBe(true);
    expect(countsAsIntegrationFailure(new UncertainOutcomeError("incierto"))).toBe(true);
    expect(countsAsIntegrationFailure(new TypeError("fetch failed"))).toBe(true);
    // Meta: token vencido llega como HTTP 400 con code 190
    expect(countsAsIntegrationFailure(Object.assign(new Error("OAuth"), { status: 400, code: 190 }))).toBe(true);
    // WhatsApp: límite de throughput con HTTP 400 pero marcado reintentable
    expect(countsAsIntegrationFailure(Object.assign(new Error("rate"), { status: 400, retryable: true }))).toBe(true);
  });

  it("muchos 400/404/422 seguidos no abren el circuito ni alertan", async () => {
    for (let i = 0; i < 8; i++) await failWith(new PermanentIntegrationError("Mercado Libre: HTTP 400 · dato inválido", [400, 404, 422][i % 3]));
    const s = await state();
    expect(s.consecutive_failures).toBe(0);
    expect(s.circuit_open_until).toBeNull();
    const events = await testDb().selectFrom("domain_events").select("id").where("event_type", "=", "integration.failed").execute();
    expect(events).toHaveLength(0);
    // Igual queda el rastro en integration_logs
    const logs = await testDb().selectFrom("integration_logs").select("http_status").where("operation", "=", "items.test").execute();
    expect(logs.length).toBeGreaterThanOrEqual(8);
    // y la llamada sigue permitida
    expect(await callIntegration(testDb(), KEY, "items.test", async () => "ok")).toBe("ok");
  });

  it("fallas reales abren el circuito; la alerta se repite (máx. 1 por hora) mientras siga caída", async () => {
    const db = testDb();
    for (let i = 0; i < 3; i++) await failWith(new RetryableError("HTTP 503", 503));
    let events = await db.selectFrom("domain_events").select(["dedupe_key"]).where("event_type", "=", "integration.failed").execute();
    expect(events).toHaveLength(1);
    // Otra falla en la misma hora: no duplica
    await failWith(new TimeoutError(1000));
    events = await db.selectFrom("domain_events").select(["dedupe_key"]).where("event_type", "=", "integration.failed").execute();
    expect(events).toHaveLength(1);
    // Una hora después sigue caída (fallas > umbral): vuelve a alertar
    await sql`update domain_events set dedupe_key = 'integration.failed:mercadolibre:hace-una-hora' where event_type = 'integration.failed'`.execute(db);
    await failWith(new TimeoutError(1000));
    events = await db.selectFrom("domain_events").select(["dedupe_key"]).where("event_type", "=", "integration.failed").execute();
    expect(events).toHaveLength(2);
    const s = await state();
    expect(s.consecutive_failures).toBe(5);
    expect(s.circuit_open_until).not.toBeNull();
  });
});
