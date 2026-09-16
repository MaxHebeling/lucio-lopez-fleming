import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { getDashboard } from "@/server/dashboard/queries";
import { getJob, jobCounts, listJobs, retryJob } from "@/server/system/jobs";
import { listAutomationRuns, listAutomations, setAutomationEnabled } from "@/server/system/automations";
import { listFeatureFlags, listIntegrationLogs, listIntegrations, setFeatureFlag } from "@/server/system/integrations";
import { isEnabled } from "@/server/flags";
import { listMigrationWarnings, markPropertyVerified, migrationSummary, reviewMigrationWarning } from "@/server/migration/review";
import { auditFilterOptions, listAuditLogs } from "@/server/audit-log/queries";
import { globalSearch } from "@/server/search/global";
import { listMyNotifications, markAllNotificationsRead, markNotificationRead } from "@/server/account/notifications";
import { notifyUser } from "@/server/notifications";
import { captureLead } from "@/server/leads/capture";
import { createProperty } from "@/server/properties/service";
import { createStaff, testDb } from "../helpers/db";

async function location() {
  const db = testDb();
  const r = await db.insertInto("locations").values({ kind: "locality", name: "Salta", slug: "salta-sys" }).returning("id").executeTakeFirst();
  return r!.id;
}

describe("tablero", () => {
  it("base vacía: ceros honestos; bloques según permisos; leads propios vs todos; filtro por sucursal", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const empty = await getDashboard(db, admin, {});
    expect(empty.properties).toMatchObject({ total: 0, published: 0, byStatus: [] });
    expect(empty.leads).toMatchObject({ scope: "all", newInRange: 0, unanswered: 0 });
    expect(empty.jobs).toEqual({ dead: 0, failed: 0, queued_late: 0 });
    expect(empty.integrations).toEqual([]);

    const agent = await createStaff(db, ["agente"]);
    const other = await createStaff(db, ["agente"]);
    const loc = await location();
    const branch = await db.selectFrom("branches").select("id").where("slug", "=", "casa-central").executeTakeFirstOrThrow();
    const p = await createProperty(db, agent, { title: "Casa en Grand Bourg", typeKey: "casa", locationId: loc, branchId: branch.id, operations: [{ operation: "sale", currency: "USD", amount: 100000, priceHidden: false }] });
    const anon = { kind: "anonymous" as const, organizationId: admin.organizationId };
    await captureLead(db, anon, { name: "Uno", email: "uno@mail.com", sourceKey: "web_property", propertyId: p.id });
    await captureLead(db, anon, { name: "Dos", email: "dos@mail.com", sourceKey: "web_contact", assignedUserId: other.userId });

    const forAgent = await getDashboard(db, agent, {});
    expect(forAgent.leads).toMatchObject({ scope: "own", newInRange: 1, unanswered: 1, unassigned: null });
    expect(forAgent.jobs).toBeNull();
    expect(forAgent.integrations).toBeNull();
    expect(forAgent.contracts).toBeNull();
    expect(forAgent.properties).toMatchObject({ total: 1, byStatus: [{ status: "draft", n: 1 }] });

    const forAdmin = await getDashboard(db, admin, { branchId: branch.id });
    expect(forAdmin.leads).toMatchObject({ scope: "all", newInRange: 1 }); // solo el lead con sucursal (vía propiedad)
    const allBranches = await getDashboard(db, admin, { from: "2000-01-01", to: "2100-01-01" });
    expect(allBranches.leads?.newInRange).toBe(2);
    const farPast = await getDashboard(db, admin, { from: "2001-01-01", to: "2001-01-31" });
    expect(farPast.leads?.newInRange).toBe(0);

    await sql`update integrations set status = 'error', last_error = 'HTTP 401', last_error_at = now() where key = 'resend'`.execute(db);
    await enqueue(db, { type: "test.dead" });
    await sql`update jobs set status = 'dead' where type = 'test.dead'`.execute(db);
    const withIssues = await getDashboard(db, admin, {});
    expect(withIssues.integrations?.map((i) => i.key)).toEqual(["resend"]);
    expect(withIssues.jobs?.dead).toBe(1);

    const noDash = { ...agent, roles: [], permissions: new Set<string>() };
    await expect(getDashboard(db, noDash, {})).rejects.toThrow(/permiso/);
  });
});

describe("sistema", () => {
  it("jobs: listado por estado, detalle y reintento auditado solo con automations.manage", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const readonly = await createStaff(db, ["solo_lectura"]);
    const id = (await enqueue(db, { type: "test.failing", payload: { a: 1 }, dedupeKey: "retry-test" }))!;
    await sql`update jobs set status = 'dead', attempts = 5, max_attempts = 5, last_error = 'boom', finished_at = now() where id = ${id}`.execute(db);

    expect((await jobCounts(db, readonly)).dead).toBeGreaterThanOrEqual(1);
    expect((await listJobs(db, readonly, { status: "dead" })).items.map((j) => j.id)).toContain(id);
    expect((await getJob(db, readonly, id)).last_error).toBe("boom");
    await expect(retryJob(db, readonly, id)).rejects.toThrow(/permiso/);
    await retryJob(db, admin, id);
    const job = await db.selectFrom("jobs").select(["status", "max_attempts"]).where("id", "=", id).executeTakeFirstOrThrow();
    expect(job).toEqual({ status: "queued", max_attempts: 6 });
    await expect(retryJob(db, admin, id)).rejects.toThrow(/Solo se reintentan/);
    const audit = await db.selectFrom("audit_logs").select(["action", "before"]).where("entity_type", "=", "job").where("entity_id", "=", id).executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ action: "JOB_RETRIED", before: { status: "dead", lastError: "boom" } });
    const agent = await createStaff(db, ["agente"]);
    await expect(listJobs(db, agent, {})).rejects.toThrow(/permiso/);
  });

  it("automatizaciones: listar, ver ejecuciones y activar/desactivar auditado", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const readonly = await createStaff(db, ["solo_lectura"]);
    const autos = await listAutomations(db, readonly);
    const target = autos.find((a) => a.key === "visit_followup")!;
    expect(target.is_enabled).toBe(true);
    await expect(setAutomationEnabled(db, readonly, target.id, false)).rejects.toThrow(/permiso/);
    await setAutomationEnabled(db, admin, target.id, false);
    expect((await listAutomations(db, admin)).find((a) => a.key === "visit_followup")?.is_enabled).toBe(false);
    await setAutomationEnabled(db, admin, target.id, false); // idempotente, sin auditoría extra
    const logs = await db.selectFrom("audit_logs").select("action").where("entity_type", "=", "automation").where("entity_id", "=", target.id).execute();
    expect(logs.map((l) => l.action)).toEqual(["AUTOMATION_DISABLED"]);
    expect(await listAutomationRuns(db, readonly, { status: "failed" })).toEqual([]);
  });

  it("integraciones y feature flags: cambio auditado que se refleja al instante", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const readonly = await createStaff(db, ["solo_lectura"]);
    expect((await listIntegrations(db, readonly)).map((i) => i.key)).toContain("whatsapp_cloud");
    expect(await listIntegrationLogs(db, readonly, { integrationKey: "resend" })).toEqual([]);
    expect(await isEnabled(db, "portal_sync")).toBe(false);
    await expect(setFeatureFlag(db, readonly, "portal_sync", true)).rejects.toThrow(/permiso/);
    await setFeatureFlag(db, admin, "portal_sync", true);
    expect(await isEnabled(db, "portal_sync")).toBe(true);
    const flag = (await listFeatureFlags(db, admin)).find((f) => f.key === "portal_sync");
    expect(flag).toMatchObject({ enabled: true, updated_by_name: admin.fullName });
    await expect(setFeatureFlag(db, admin, "no_existe", true)).rejects.toThrow(/no encontrad/);
    const audit = await db.selectFrom("audit_logs").select(["action", "before", "after"]).where("entity_type", "=", "feature_flag").executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ action: "FEATURE_FLAG_CHANGED", before: { enabled: false }, after: { enabled: true } });
    await setFeatureFlag(db, admin, "portal_sync", false);
  });
});

describe("migración", () => {
  it("tablas vacías no rompen; resolver/descartar advertencias y verificar propiedad quedan auditados", async () => {
    const db = testDb();
    const reviewer = await createStaff(db, ["administrador"]);
    const empty = await migrationSummary(db, reviewer);
    expect(empty).toEqual({ runs: [], stages: [], warnings: [] });
    expect((await listMigrationWarnings(db, reviewer, {})).total).toBe(0);

    const p = await createProperty(db, reviewer, { title: "Casa migrada", typeKey: "casa", operations: [{ operation: "sale", currency: "USD", amount: 1, priceHidden: false }] });
    const run = await db.insertInto("migration_runs").values({ source: "adinco", triggered_by: "test" }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("migration_records").values({ source: "adinco", external_id: "3021", last_run_id: run.id, stage: "review_required", property_id: p.id }).execute();
    const w1 = await db.insertInto("migration_warnings").values({ run_id: run.id, source: "adinco", external_id: "3021", property_id: p.id, code: "price_mismatch", field: "price", value_a: "230000", value_b: "215000", message: "El precio difiere", severity: "error" }).returning("id").executeTakeFirstOrThrow();
    const w2 = await db.insertInto("migration_warnings").values({ run_id: run.id, source: "adinco", external_id: "3021", property_id: p.id, code: "missing_alt", field: "media", message: "Fotos sin texto", severity: "info" }).returning("id").executeTakeFirstOrThrow();

    const open = await listMigrationWarnings(db, reviewer, {});
    expect(open.items.map((w) => w.id)).toEqual([w1.id, w2.id]);
    expect(open.items[0]).toMatchObject({ property_code: p.code, record_stage: "review_required" });
    expect((await listMigrationWarnings(db, reviewer, { severity: "info" })).items.map((w) => w.id)).toEqual([w2.id]);

    const agent = await createStaff(db, ["agente"]);
    await expect(listMigrationWarnings(db, agent, {})).rejects.toThrow(/permiso/);
    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(reviewMigrationWarning(db, readonly, w1.id, "resolved")).rejects.toThrow(/permiso/);

    await reviewMigrationWarning(db, reviewer, w1.id, "resolved");
    await reviewMigrationWarning(db, reviewer, w2.id, "dismissed");
    expect((await listMigrationWarnings(db, reviewer, {})).total).toBe(0);
    expect((await listMigrationWarnings(db, reviewer, { status: "resolved" })).items[0]).toMatchObject({ id: w1.id, reviewed_by_name: reviewer.fullName });

    await expect(markPropertyVerified(db, agent, p.id)).rejects.toThrow(/permiso/);
    const v = await markPropertyVerified(db, reviewer, p.id);
    expect(v.records).toBe(1);
    const prop = await db.selectFrom("properties").select(["manually_verified_at", "manually_verified_by"]).where("id", "=", p.id).executeTakeFirstOrThrow();
    expect(prop.manually_verified_by).toBe(reviewer.userId);
    const record = await db.selectFrom("migration_records").select("stage").where("property_id", "=", p.id).executeTakeFirstOrThrow();
    expect(record.stage).toBe("verified");
    const summary = await migrationSummary(db, reviewer);
    expect(summary.stages).toEqual([{ source: "adinco", stage: "verified", n: 1 }]);
    const actions = (await db.selectFrom("audit_logs").select("action").where("action", "like", "MIGRATION_%").execute()).map((a) => a.action);
    expect(actions.sort()).toEqual(["MIGRATION_WARNING_DISMISSED", "MIGRATION_WARNING_RESOLVED"]);
  });
});

describe("auditoría, búsqueda y notificaciones", () => {
  it("auditoría filtra por entidad, actor, acción y fechas; exige audit.read", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const p = await createProperty(db, admin, { title: "Casa auditada", typeKey: "casa", operations: [{ operation: "sale", currency: "USD", amount: 1, priceHidden: false }] });
    const byEntity = await listAuditLogs(db, admin, { entityType: "property", entityId: p.id });
    expect(byEntity.items.map((i) => i.action)).toEqual(["PROPERTY_CREATED"]);
    expect(byEntity.items[0]).toMatchObject({ actor_name: admin.fullName });
    expect((await listAuditLogs(db, admin, { actorId: admin.userId, action: "PROPERTY_CREATED" })).total).toBeGreaterThanOrEqual(1);
    expect((await listAuditLogs(db, admin, { entityId: p.id, from: "2001-01-01", to: "2001-12-31" })).total).toBe(0);
    // Parámetros inválidos se ignoran, no rompen
    expect((await listAuditLogs(db, admin, { action: "drop table", actorId: "x" })).total).toBeGreaterThan(0);
    expect((await auditFilterOptions(db, admin)).actions).toContain("PROPERTY_CREATED");
    const agent = await createStaff(db, ["agente"]);
    await expect(listAuditLogs(db, agent, {})).rejects.toThrow(/permiso/);
  });

  it("búsqueda global respeta permisos (marketing no ve contactos)", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const p = await createProperty(db, admin, { title: "Oficina en calle Mitre", typeKey: "oficina", addressStreet: "Mitre", operations: [{ operation: "rent", currency: "ARS", amount: 1, priceHidden: false }] });
    await captureLead(db, { kind: "anonymous", organizationId: admin.organizationId }, { name: "Jimena Mitre", email: "jimena@mail.com", phone: "387 4556677", sourceKey: "web_contact" });
    const all = await globalSearch(db, admin, "mitre");
    expect(all.properties?.map((x) => x.id)).toContain(p.id);
    expect(all.contacts?.map((c) => c.display_name)).toContain("Jimena Mitre");
    expect((await globalSearch(db, admin, String(p.code))).properties?.[0]?.id).toBe(p.id);
    expect((await globalSearch(db, admin, "4556677")).contacts?.map((c) => c.display_name)).toContain("Jimena Mitre");
    const marketing = await createStaff(db, ["marketing"]);
    const limited = await globalSearch(db, marketing, "mitre");
    expect(limited.contacts).toBeNull();
    expect(limited.properties?.length).toBeGreaterThan(0);
    await expect(globalSearch(db, { kind: "anonymous", organizationId: admin.organizationId }, "mitre")).rejects.toThrow(/Iniciá sesión/);
  });

  it("notificaciones: cada uno ve y marca solo las suyas", async () => {
    const db = testDb();
    const a = await createStaff(db, ["agente"]);
    const b = await createStaff(db, ["agente"]);
    await notifyUser(db, a.userId, { kind: "test", title: "Primera", link: "/crm" });
    await notifyUser(db, a.userId, { kind: "test", title: "Segunda" });
    await notifyUser(db, b.userId, { kind: "test", title: "De B" });
    const mine = await listMyNotifications(db, a);
    expect(mine.items.map((n) => n.title).sort()).toEqual(["Primera", "Segunda"]);
    expect(mine.unread).toBe(2);
    const bItem = (await listMyNotifications(db, b)).items[0]!;
    await expect(markNotificationRead(db, a, bItem.id)).rejects.toThrow(/no encontrad/);
    await markNotificationRead(db, a, mine.items[0]!.id);
    expect((await listMyNotifications(db, a, { unreadOnly: true })).total).toBe(1);
    expect(await markAllNotificationsRead(db, a)).toBe(1);
    expect((await listMyNotifications(db, b)).unread).toBe(1);
  });
});
