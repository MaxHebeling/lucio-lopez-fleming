import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { login, resolveSession, logout, createPasswordReset, consumePasswordReset, changePassword } from "@/server/auth/session";
import { createOwner, createStaff, testDb, TEST_PASSWORD } from "../helpers/db";

describe("autenticación", () => {
  it("login correcto crea sesión con roles y permisos del rol", async () => {
    const db = testDb();
    const actor = await createStaff(db, ["agente"]);
    expect(actor.roles).toEqual(["agente"]);
    expect(actor.permissions.has("leads.read_own")).toBe(true);
    expect(actor.permissions.has("users.manage")).toBe(false);
  });

  it("contraseña incorrecta no revela si el usuario existe y bloquea a los 5 intentos", async () => {
    const db = testDb();
    const actor = await createStaff(db, ["agente"]);
    const unknown = await login(db, { email: "nadie@test.local", password: "x", area: "staff" });
    expect(unknown).toEqual({ ok: false, reason: "invalid_credentials" });
    for (let i = 0; i < 4; i++) {
      expect(await login(db, { email: actor.email, password: "mala-clave-123", area: "staff" })).toEqual({ ok: false, reason: "invalid_credentials" });
    }
    expect(await login(db, { email: actor.email, password: "mala-clave-123", area: "staff" })).toEqual({ ok: false, reason: "locked" });
    // Bloqueada: ni con la contraseña correcta entra
    expect(await login(db, { email: actor.email, password: TEST_PASSWORD, area: "staff" })).toEqual({ ok: false, reason: "locked" });
  });

  it("un propietario no puede entrar por el login del equipo (y viceversa)", async () => {
    const db = testDb();
    const owner = await createOwner(db);
    expect((await login(db, { email: owner.email, password: TEST_PASSWORD, area: "staff" })).ok).toBe(false);
    const staff = await createStaff(db, ["agente"]);
    expect((await login(db, { email: staff.email, password: TEST_PASSWORD, area: "owner" })).ok).toBe(false);
  });

  it("logout revoca la sesión y usuario desactivado pierde acceso", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    const res = await login(db, { email: staff.email, password: TEST_PASSWORD, area: "staff" });
    if (!res.ok) throw new Error("login");
    expect(await resolveSession(db, res.token)).not.toBeNull();
    await logout(db, res.token);
    expect(await resolveSession(db, res.token)).toBeNull();

    const res2 = await login(db, { email: staff.email, password: TEST_PASSWORD, area: "staff" });
    if (!res2.ok) throw new Error("login");
    await db.updateTable("users").set({ is_active: false }).where("id", "=", staff.userId).execute();
    expect(await resolveSession(db, res2.token)).toBeNull();
  });

  it("reset de contraseña: token de un solo uso que revoca todas las sesiones", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    const session = await login(db, { email: staff.email, password: TEST_PASSWORD, area: "staff" });
    if (!session.ok) throw new Error("login");
    const reset = await createPasswordReset(db, staff.email);
    expect(reset).not.toBeNull();
    const [a, b] = await Promise.all([
      consumePasswordReset(db, reset!.token, "Nueva-clave-segura-1"),
      consumePasswordReset(db, reset!.token, "Otra-clave-segura-2"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await resolveSession(db, session.token)).toBeNull();
    expect(await createPasswordReset(db, "inexistente@test.local")).toBeNull();
    const audits = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", staff.userId).execute();
    expect(audits.map((x) => x.action)).toContain("PASSWORD_RESET");
  });

  it("cambio de contraseña exige la actual y conserva solo la sesión en uso", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    const other = await login(db, { email: staff.email, password: TEST_PASSWORD, area: "staff" });
    if (!other.ok) throw new Error("login");
    expect((await changePassword(db, staff.userId, "incorrecta-123", "Nueva-clave-2026", staff.sessionId)).ok).toBe(false);
    expect((await changePassword(db, staff.userId, TEST_PASSWORD, "Nueva-clave-2026", staff.sessionId)).ok).toBe(true);
    expect(await resolveSession(db, other.token)).toBeNull();
  });

  it("auditoría es de solo inserción", async () => {
    const db = testDb();
    await createStaff(db, ["agente"]);
    await expect(sql`update audit_logs set action = 'HACK'`.execute(db)).rejects.toThrow(/solo inserción/);
    await expect(sql`delete from audit_logs`.execute(db)).rejects.toThrow(/solo inserción/);
  });

  it("post-migrate deja RLS activo en todas las tablas", async () => {
    const db = testDb();
    const r = await sql<{ n: number }>`select count(*)::int as n from pg_tables where schemaname='public' and not rowsecurity`.execute(db);
    expect(r.rows[0]!.n).toBe(0);
  });
});
