/**
 * Cuentas sin contraseña (invitaciones pendientes y agentes importados de Adinco):
 * - "Olvidé mi contraseña" no las activa: solo una invitación de un administrador.
 * - Ni recuperación ni login permiten distinguirlas por tiempo de una cuenta real o inexistente.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { requestPasswordReset, RESET_MIN_RESPONSE_MS } from "@/server/account/recovery";
import { organizationId } from "@/server/org";
import { createStaff, testDb, TEST_PASSWORD } from "../helpers/db";

// Cuenta las verificaciones argon2 con un módulo de sesión fresco (el setup ya cargó el real antes de cualquier mock).
const argon = { verifyCalls: 0 };
let login: typeof import("@/server/auth/session").login;
beforeAll(async () => {
  vi.resetModules();
  vi.doMock("@node-rs/argon2", async () => {
    const real = await vi.importActual<typeof import("@node-rs/argon2")>("@node-rs/argon2");
    return {
      ...real,
      verify: (...args: Parameters<typeof real.verify>) => {
        argon.verifyCalls++;
        return real.verify(...args);
      },
    };
  });
  ({ login } = await import("@/server/auth/session"));
});

async function passwordlessStaff(email: string) {
  const db = testDb();
  return db
    .insertInto("users")
    .values({ organization_id: await organizationId(db), kind: "staff", email, full_name: "Agente importado", password_hash: null, must_change_password: true, is_active: true })
    .returning("id")
    .executeTakeFirstOrThrow();
}

describe("cuentas sin contraseña", () => {
  it("recuperar contraseña no emite token ni email para un usuario sin contraseña (se activa solo por invitación)", async () => {
    const db = testDb();
    const u = await passwordlessStaff("importado.adinco@test.local");
    expect(await requestPasswordReset(db, { email: "importado.adinco@test.local", ip: "10.1.0.1" })).toBe("unknown_email");
    expect(await db.selectFrom("password_reset_tokens").select("id").where("user_id", "=", u.id).execute()).toHaveLength(0);
    expect(await db.selectFrom("outbound_messages").select("id").where("entity_id", "=", u.id).execute()).toHaveLength(0);
  });

  it("recuperar tarda al menos el piso de respuesta en todos los caminos (no se distingue por tiempo)", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    await passwordlessStaff("sin.clave.tiempo@test.local");
    const timed = async (email: string, ip: string) => {
      const t0 = performance.now();
      const outcome = await requestPasswordReset(db, { email, ip });
      return { outcome, ms: performance.now() - t0 };
    };
    const real = await timed(staff.email, "10.1.1.1");
    const none = await timed("no.existe.tiempo@test.local", "10.1.1.2");
    const noPassword = await timed("sin.clave.tiempo@test.local", "10.1.1.3");
    expect(real.outcome).toBe("queued");
    for (const r of [real, none, noPassword]) expect(r.ms).toBeGreaterThanOrEqual(RESET_MIN_RESPONSE_MS - 5);
  });

  it("login de un usuario existente sin contraseña verifica contra un hash de relleno y nunca entra", async () => {
    const db = testDb();
    await passwordlessStaff("sin.clave.login@test.local");
    await login(db, { email: "precalentar@test.local", password: "x", area: "staff" }); // genera el hash de relleno
    argon.verifyCalls = 0;
    expect(await login(db, { email: "sin.clave.login@test.local", password: "cualquier-cosa-1", area: "staff" })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(argon.verifyCalls).toBe(1);
    // Ni siquiera con la contraseña del hash de relleno
    expect((await login(db, { email: "sin.clave.login@test.local", password: "sin-usuario-llf-2026", area: "staff" })).ok).toBe(false);
  });

  it("login de una cuenta bloqueada también cuesta una verificación (misma respuesta y tiempo que una inexistente)", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    for (let i = 0; i < 5; i++) await login(db, { email: staff.email, password: "mala-clave-123", area: "staff" });
    argon.verifyCalls = 0;
    expect(await login(db, { email: staff.email, password: TEST_PASSWORD, area: "staff" })).toEqual({ ok: false, reason: "locked" });
    expect(argon.verifyCalls).toBe(1);
  });
});
