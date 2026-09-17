/** Gestión del acceso de propietarios al portal: invitar con email explícito, cortar/restituir acceso y cambiar el email. */
import { describe, expect, it } from "vitest";
import { login, resolveSession } from "@/server/auth/session";
import { changeOwnerEmail, inviteOwner, isResetTokenValid, requestOwnerPasswordReset, setOwnerAccessActive } from "@/server/owners/access";
import { createOwner, createStaff, testDb, TEST_PASSWORD } from "../helpers/db";
import { createTestContact, createTestProperty } from "../helpers/rentals";

async function ownerSession(email: string) {
  const r = await login(testDb(), { email, password: TEST_PASSWORD, area: "owner" });
  if (!r.ok) throw new Error(`login falló: ${r.reason}`);
  return r.token;
}

describe("invitación de propietario con email explícito", () => {
  it("no toma en silencio el email de la ficha del contacto: hay que escribirlo y confirmarlo", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]);
    // La ficha tiene un email (p. ej. cargado desde un formulario público): no alcanza
    const contact = await createTestContact(db, "Hugo Ficha", "hugo.ficha.contaminada@test.local");
    await createTestProperty(db, { ownerContactIds: [{ id: contact }] });

    await expect(inviteOwner(db, staff, { contactId: contact })).rejects.toMatchObject({ code: "validation", details: { email: expect.any(Array) } });
    await expect(inviteOwner(db, staff, { contactId: contact, email: "hugo@test.local", confirmEmail: "otro@test.local" })).rejects.toMatchObject({
      code: "validation",
      details: { confirmEmail: expect.any(Array) },
    });
    const r = await inviteOwner(db, staff, { contactId: contact, email: "  Hugo.Real@Test.local ", confirmEmail: "hugo.real@test.local" });
    expect(r).toMatchObject({ email: "hugo.real@test.local", created: true });
    const msg = await db.selectFrom("outbound_messages").select("to_address").where("entity_id", "=", r.userId).executeTakeFirstOrThrow();
    expect(msg.to_address).toBe("hugo.real@test.local");

    // Reinvitar va al email del usuario; un email distinto no cambia el acceso por la puerta de atrás
    await expect(inviteOwner(db, staff, { contactId: contact, email: "otra.persona@test.local", confirmEmail: "otra.persona@test.local" })).rejects.toMatchObject({ code: "conflict" });
    expect(await inviteOwner(db, staff, { contactId: contact })).toMatchObject({ email: "hugo.real@test.local", created: false });
  });
});

describe("cortar y restituir el acceso de un propietario", () => {
  it("solo users.manage; desactivar revoca sesiones y links pendientes; reactivar vuelve a permitir el ingreso", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["direccion"]); // users.manage
    const rentals = await createStaff(db, ["alquileres"]); // reports.generate, sin users.manage
    const agent = await createStaff(db, ["agente"]);
    const owner = await createOwner(db, "Irene Acceso");
    await createTestProperty(db, { ownerContactIds: [{ id: owner.contactId }] });
    const token = await ownerSession(owner.email);
    await requestOwnerPasswordReset(db, owner.email);
    const resetMsg = await db.selectFrom("outbound_messages").select("payload").where("entity_id", "=", owner.userId).executeTakeFirstOrThrow();
    const resetToken = new URL(String((resetMsg.payload as { resetUrl: string }).resetUrl)).searchParams.get("token")!;
    expect(await isResetTokenValid(db, resetToken)).toBe(true);

    await expect(setOwnerAccessActive(db, agent, { userId: owner.userId, active: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setOwnerAccessActive(db, rentals, { userId: owner.userId, active: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setOwnerAccessActive(db, owner, { userId: owner.userId, active: false })).rejects.toMatchObject({ code: "forbidden" });
    // Un usuario del equipo no se gestiona por acá
    await expect(setOwnerAccessActive(db, admin, { userId: agent.userId, active: false })).rejects.toMatchObject({ code: "not_found" });

    const off = await setOwnerAccessActive(db, admin, { userId: owner.userId, active: false, reason: "Dejó de ser cliente" });
    expect(off.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(db, token)).toBeNull();
    expect((await login(db, { email: owner.email, password: TEST_PASSWORD, area: "owner" })).ok).toBe(false);
    expect(await isResetTokenValid(db, resetToken)).toBe(false);
    await expect(inviteOwner(db, admin, { contactId: owner.contactId })).rejects.toThrow(/desactivado/);
    // Idempotente
    expect(await setOwnerAccessActive(db, admin, { userId: owner.userId, active: false })).toEqual({ sessionsRevoked: 0, changed: false });

    await setOwnerAccessActive(db, admin, { userId: owner.userId, active: true });
    expect((await login(db, { email: owner.email, password: TEST_PASSWORD, area: "owner" })).ok).toBe(true);
    const audits = await db.selectFrom("audit_logs").select(["action", "metadata"]).where("entity_id", "=", owner.userId).orderBy("id").execute();
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["OWNER_ACCESS_DEACTIVATED", "OWNER_ACCESS_REACTIVATED"]));
    expect(audits.find((a) => a.action === "OWNER_ACCESS_DEACTIVATED")?.metadata).toMatchObject({ reason: "Dejó de ser cliente" });
  });
});

describe("cambiar el email de un propietario", () => {
  it("normaliza, exige confirmación, es único, revoca sesiones y links, y queda auditado", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const rentals = await createStaff(db, ["alquileres"]);
    const owner = await createOwner(db, "Julia Email");
    const other = await createOwner(db, "Karina Otra");
    const token = await ownerSession(owner.email);
    await requestOwnerPasswordReset(db, owner.email);
    const pending = await db.selectFrom("password_reset_tokens").select("token_hash").where("user_id", "=", owner.userId).where("used_at", "is", null).execute();
    expect(pending.length).toBeGreaterThanOrEqual(1);

    await expect(changeOwnerEmail(db, rentals, { userId: owner.userId, email: "julia.nueva@test.local", confirmEmail: "julia.nueva@test.local" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(changeOwnerEmail(db, admin, { userId: owner.userId, email: "julia.nueva@test.local", confirmEmail: "julia.otra@test.local" })).rejects.toMatchObject({ code: "validation" });
    await expect(changeOwnerEmail(db, admin, { userId: owner.userId, email: "no-es-email", confirmEmail: "no-es-email" })).rejects.toMatchObject({ code: "validation" });
    await expect(changeOwnerEmail(db, admin, { userId: owner.userId, email: other.email.toUpperCase(), confirmEmail: other.email })).rejects.toMatchObject({ code: "conflict" });
    await expect(changeOwnerEmail(db, admin, { userId: owner.userId, email: admin.email, confirmEmail: admin.email })).rejects.toMatchObject({ code: "conflict" });
    await expect(changeOwnerEmail(db, admin, { userId: admin.userId, email: "x@test.local", confirmEmail: "x@test.local" })).rejects.toMatchObject({ code: "not_found" });

    const r = await changeOwnerEmail(db, admin, { userId: owner.userId, email: "  Julia.Nueva@Test.LOCAL", confirmEmail: "julia.nueva@test.local" });
    expect(r).toMatchObject({ email: "julia.nueva@test.local", changed: true });
    expect(r.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(db, token)).toBeNull();
    for (const p of pending) {
      const t = await db.selectFrom("password_reset_tokens").select("used_at").where("token_hash", "=", p.token_hash).executeTakeFirstOrThrow();
      expect(t.used_at).not.toBeNull();
    }
    expect((await login(db, { email: owner.email, password: TEST_PASSWORD, area: "owner" })).ok).toBe(false);
    expect((await login(db, { email: "julia.nueva@test.local", password: TEST_PASSWORD, area: "owner" })).ok).toBe(true);
    const audit = await db.selectFrom("audit_logs").select(["before", "after"]).where("entity_id", "=", owner.userId).where("action", "=", "OWNER_EMAIL_CHANGED").executeTakeFirstOrThrow();
    expect(audit.before).toMatchObject({ email: owner.email });
    expect(audit.after).toMatchObject({ email: "julia.nueva@test.local" });
    expect(await changeOwnerEmail(db, admin, { userId: owner.userId, email: "julia.nueva@test.local", confirmEmail: "julia.nueva@test.local" })).toMatchObject({ changed: false });
  });
});
