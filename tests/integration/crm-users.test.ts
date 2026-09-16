import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { inviteUser, resendInvite, setUserActive, setUserBranches, setUserRoles, updateUserProfile } from "@/server/users/service";
import { getUserDetail, listUsers, userFormOptions } from "@/server/users/queries";
import { requestPasswordReset, resetPasswordWithToken, RESET_LIMITS } from "@/server/account/recovery";
import { changeOwnPassword } from "@/server/account/password";
import { login, resolveSession } from "@/server/auth/session";
import { systemActor } from "@/server/auth/actor";
import { createOwner, createStaff, testDb, TEST_PASSWORD } from "../helpers/db";

function tokenFrom(url: string): string {
  return new URL(url).searchParams.get("token")!;
}

describe("usuarios del equipo", () => {
  it("invitar: usuario sin contraseña, token de 72 h, email staff_invite encolado y auditado; el link define la contraseña", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const branch = await db.selectFrom("branches").select("id").where("slug", "=", "casa-central").executeTakeFirstOrThrow();
    const r = await inviteUser(db, admin, { email: "Nueva.Agente@LLF.com.ar", fullName: "Nueva Agente", roles: ["agente"], branchIds: [branch.id], whatsapp: "387 5123456" });
    const user = await db.selectFrom("users").select(["email", "password_hash", "whatsapp_e164", "is_active"]).where("id", "=", r.userId).executeTakeFirstOrThrow();
    expect(user).toEqual({ email: "nueva.agente@llf.com.ar", password_hash: null, whatsapp_e164: "+5493875123456", is_active: true });
    const token = await db.selectFrom("password_reset_tokens").select(sql<number>`round(extract(epoch from expires_at - created_at) / 3600)::int`.as("hours")).where("user_id", "=", r.userId).executeTakeFirstOrThrow();
    expect(token.hours).toBe(72);
    const msg = await db.selectFrom("outbound_messages").select(["template_key", "to_address", "payload", "status"]).where("entity_id", "=", r.userId).executeTakeFirstOrThrow();
    expect(msg).toMatchObject({ template_key: "staff_invite", to_address: "nueva.agente@llf.com.ar", status: "queued" });
    expect((msg.payload as { inviteUrl: string }).inviteUrl).toBe(r.inviteUrl);
    expect(await db.selectFrom("jobs").select("type").where("type", "=", "messaging.send").execute()).not.toHaveLength(0);

    // Sin contraseña no puede entrar
    expect((await login(db, { email: "nueva.agente@llf.com.ar", password: "cualquier-cosa-1", area: "staff" })).ok).toBe(false);
    expect(await resetPasswordWithToken(db, { token: tokenFrom(r.inviteUrl), password: "Bienvenida-2026", confirm: "Bienvenida-2026" })).toBe(true);
    expect((await login(db, { email: "nueva.agente@llf.com.ar", password: "Bienvenida-2026", area: "staff" })).ok).toBe(true);
    expect(await resetPasswordWithToken(db, { token: tokenFrom(r.inviteUrl), password: "Otra-clave-2026", confirm: "Otra-clave-2026" })).toBe(false);
    await expect(resendInvite(db, admin, r.userId)).rejects.toThrow(/ya definió/);

    await expect(inviteUser(db, admin, { email: "nueva.agente@llf.com.ar", fullName: "Duplicada", roles: ["agente"] })).rejects.toThrow(/Ya existe/);
    const audit = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", r.userId).execute();
    expect(audit.map((a) => a.action)).toContain("USER_INVITED");
  });

  it("anti-escalamiento: sin roles.manage solo se asignan roles con permisos propios; nunca super_admin", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    await expect(inviteUser(db, admin, { email: "x1@test.local", fullName: "X Uno", roles: ["super_admin"] })).rejects.toThrow(/Super Admin/);
    await expect(inviteUser(db, admin, { email: "x2@test.local", fullName: "X Dos", roles: ["direccion"] })).rejects.toThrow(/permisos que vos no tenés/);
    const ok = await inviteUser(db, admin, { email: "x3@test.local", fullName: "X Tres", roles: ["agente", "marketing"] });
    await setUserRoles(db, admin, ok.userId, ["agente", "alquileres"]);
    expect((await db.selectFrom("user_roles").select("role_key").where("user_id", "=", ok.userId).orderBy("role_key").execute()).map((r) => r.role_key)).toEqual(["agente", "alquileres"]);
    await expect(setUserRoles(db, admin, ok.userId, ["direccion"])).rejects.toThrow(/permisos que vos no tenés/);
    // Un par (mismo conjunto de permisos) sí puede asignarse
    await setUserRoles(db, admin, ok.userId, ["administrador"]);

    const options = await userFormOptions(db, admin);
    expect(options.roles.find((r) => r.key === "agente")?.assignable).toBe(true);
    expect(options.roles.find((r) => r.key === "super_admin")?.assignable).toBe(false);
    expect(options.roles.find((r) => r.key === "direccion")?.assignable).toBe(false);

    const agent = await createStaff(db, ["agente"]);
    await expect(inviteUser(db, agent, { email: "x4@test.local", fullName: "X Cuatro", roles: ["agente"] })).rejects.toThrow(/permiso/);
    await expect(listUsers(db, agent, {})).rejects.toThrow(/permiso/);
    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(getUserDetail(db, readonly, ok.userId)).rejects.toThrow(/permiso/);
  });

  it("super_admin: no se quita el rol a sí mismo, no se desactiva, y siempre queda uno activo", async () => {
    const db = testDb();
    const root = await createStaff(db, ["super_admin"]);
    await expect(setUserRoles(db, root, root.userId, ["administrador"])).rejects.toThrow(/a vos mismo/);
    await expect(setUserActive(db, root, root.userId, false)).rejects.toThrow(/propio usuario/);

    const second = await createStaff(db, ["super_admin"]);
    // Con otro super admin activo se le puede quitar el rol a un tercero
    const third = await createStaff(db, ["direccion", "super_admin"]);
    await setUserRoles(db, root, third.userId, ["direccion"]);
    // Dejar a `second` como único super admin activo
    await sql`update users set is_active = false where id <> ${second.userId} and id in (select user_id from user_roles where role_key = 'super_admin')`.execute(db);
    await expect(setUserActive(db, root, second.userId, false)).rejects.toThrow(/al menos un Super Admin/);
    await expect(setUserRoles(db, root, second.userId, ["direccion"])).rejects.toThrow(/al menos un Super Admin/);
    await expect(setUserRoles(db, second, second.userId, ["direccion"])).rejects.toThrow(/a vos mismo/);
  });

  it("desactivar revoca sesiones y bloquea el acceso; reactivar lo devuelve; perfil y sucursales auditados", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const agent = await createStaff(db, ["agente"]);
    const session = await login(db, { email: agent.email, password: TEST_PASSWORD, area: "staff" });
    if (!session.ok) throw new Error("login");
    const res = await setUserActive(db, admin, agent.userId, false);
    expect(res.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(db, session.token)).toBeNull();
    expect((await login(db, { email: agent.email, password: TEST_PASSWORD, area: "staff" })).ok).toBe(false);
    await setUserActive(db, admin, agent.userId, true);
    expect((await login(db, { email: agent.email, password: TEST_PASSWORD, area: "staff" })).ok).toBe(true);

    // Un administrador no puede desactivar a dirección (roles que no podría asignar)
    const boss = await createStaff(db, ["direccion"]);
    await expect(setUserActive(db, admin, boss.userId, false)).rejects.toThrow(/permisos que vos no tenés/);

    await updateUserProfile(db, admin, agent.userId, { fullName: "Agente Renombrado", phone: "387 4214143", whatsapp: "", publicProfile: true });
    await expect(updateUserProfile(db, admin, agent.userId, { fullName: "A", publicProfile: false })).rejects.toThrow(/Revisá/);
    const branches = await db.selectFrom("branches").select("id").execute();
    await setUserBranches(db, admin, agent.userId, branches.map((b) => b.id));
    const detail = await getUserDetail(db, admin, agent.userId);
    expect(detail.user).toMatchObject({ full_name: "Agente Renombrado", public_profile: true, is_active: true });
    expect(detail.branchIds).toHaveLength(branches.length);
    expect(detail.audit?.map((a) => a.action)).toEqual(expect.arrayContaining(["USER_DEACTIVATED", "USER_REACTIVATED", "USER_UPDATED", "USER_BRANCHES_CHANGED"]));

    const list = await listUsers(db, admin, { q: "renombrado" });
    expect(list.items.map((u) => u.id)).toEqual([agent.userId]);
    // Los propietarios del portal no aparecen como usuarios del equipo
    const owner = await createOwner(db);
    expect((await listUsers(db, admin, { q: owner.email })).items).toHaveLength(0);
  });

  it("el script de primer arranque (actor de sistema) crea el usuario sin encolar email", async () => {
    const db = testDb();
    const actor = systemActor(await db.selectFrom("organizations").select("id").executeTakeFirstOrThrow().then((o) => o.id), "cli:test");
    const r = await inviteUser(db, actor, { email: "primer.admin@test.local", fullName: "Primer Admin", roles: ["super_admin"] }, { sendEmail: false });
    expect(r.emailQueued).toBe(false);
    expect(await db.selectFrom("outbound_messages").select("id").where("entity_id", "=", r.userId).execute()).toHaveLength(0);
    expect(r.inviteUrl).toMatch(/\/crm\/restablecer\?token=/);
  });
});

describe("cuenta y recuperación", () => {
  it("recuperar: misma respuesta para emails inexistentes, solo staff activo, encola password_reset, rate limit por email e IP", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    expect(await requestPasswordReset(db, { email: "nadie@test.local", ip: "10.0.0.1" })).toBe("unknown_email");
    const owner = await createOwner(db);
    expect(await requestPasswordReset(db, { email: owner.email, ip: "10.0.0.1" })).toBe("unknown_email");
    expect(await requestPasswordReset(db, { email: staff.email.toUpperCase(), ip: "10.0.0.1" })).toBe("queued");
    const msg = await db.selectFrom("outbound_messages").select(["template_key", "payload"]).where("entity_id", "=", staff.userId).where("template_key", "=", "password_reset").executeTakeFirstOrThrow();
    const payload = msg.payload as { resetUrl: string; fullName: string };
    expect(payload.fullName).toBe(staff.fullName);
    for (let i = 1; i < RESET_LIMITS.emailPerHour; i++) await requestPasswordReset(db, { email: staff.email, ip: `10.0.1.${i}` });
    expect(await requestPasswordReset(db, { email: staff.email, ip: "10.0.2.1" })).toBe("rate_limited");
    for (let i = 0; i < RESET_LIMITS.ipPer15Min; i++) await requestPasswordReset(db, { email: `otro${i}@test.local`, ip: "10.9.9.9" });
    expect(await requestPasswordReset(db, { email: "otro-mas@test.local", ip: "10.9.9.9" })).toBe("rate_limited");

    // El link restablece, valida confirmación y política
    const token = tokenFrom(payload.resetUrl);
    await expect(resetPasswordWithToken(db, { token, password: "Nueva-clave-2026", confirm: "distinta" })).rejects.toThrow(/Revisá/);
    await expect(resetPasswordWithToken(db, { token, password: "corta", confirm: "corta" })).rejects.toThrow(/al menos 10/);
    expect(await resetPasswordWithToken(db, { token, password: "Nueva-clave-2026", confirm: "Nueva-clave-2026" })).toBe(true);
  });

  it("cambiar contraseña propia: exige la actual, conserva la sesión actual y revoca las demás", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["agente"]);
    const other = await login(db, { email: staff.email, password: TEST_PASSWORD, area: "staff" });
    if (!other.ok) throw new Error("login");
    await expect(changeOwnPassword(db, staff, { current: "mala", password: "Nueva-clave-2026", confirm: "Nueva-clave-2026" })).rejects.toThrow(/actual/);
    await changeOwnPassword(db, staff, { current: TEST_PASSWORD, password: "Nueva-clave-2026", confirm: "Nueva-clave-2026" });
    expect(await resolveSession(db, other.token)).toBeNull();
    const current = await db.selectFrom("sessions").select("revoked_at").where("id", "=", staff.sessionId!).executeTakeFirstOrThrow();
    expect(current.revoked_at).toBeNull();
    await expect(changeOwnPassword(db, { kind: "anonymous", organizationId: staff.organizationId }, { current: "x", password: "y", confirm: "y" })).rejects.toThrow(/Iniciá sesión/);
  });
});
