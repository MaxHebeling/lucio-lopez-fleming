import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, getDb, type Database } from "../../src/server/db";
import { resetOrganizationCache, organizationId } from "../../src/server/org";
import { resetFlagCache } from "../../src/server/flags";
import { seedOrganization } from "../../src/server/seed";
import { hashPassword } from "../../src/server/auth/password";
import { resolveSession, login } from "../../src/server/auth/session";
import type { OwnerActor, StaffActor, SystemActor } from "../../src/server/auth/actor";

export function testDb(): Database {
  return getDb();
}

/** Vacía todas las tablas (salvo schema_migrations) y recarga los datos de referencia. */
export async function resetBusinessData(db: Database): Promise<void> {
  const tables = await sql<{ tablename: string }>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`.execute(db);
  await sql.raw(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`).execute(db);
  // Datos de referencia idempotentes: 0008 y los de cada bloque (NNNN_*reference_data.sql), en orden.
  const dir = resolve(import.meta.dirname, "../../db/migrations");
  for (const f of readdirSync(dir).filter((n) => /^\d{4}_[a-z0-9_]*reference_data\.sql$/.test(n)).sort()) {
    await sql.raw(readFileSync(resolve(dir, f), "utf8")).execute(db);
  }
  resetOrganizationCache();
  resetFlagCache();
  await seedOrganization(db);
}

let counter = 0;
const PASSWORD = "Prueba-segura-2026";

export async function createStaff(db: Database, roles: string[], opts: { email?: string; branchIds?: string[] } = {}): Promise<StaffActor> {
  const orgId = await organizationId(db);
  const email = opts.email ?? `staff${++counter}-${Date.now()}@test.local`;
  const user = await db
    .insertInto("users")
    .values({ organization_id: orgId, email, full_name: `Usuario ${counter}`, password_hash: await hashPassword(PASSWORD), kind: "staff" })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const role of roles) await db.insertInto("user_roles").values({ user_id: user.id, role_key: role }).execute();
  for (const b of opts.branchIds ?? []) await db.insertInto("user_branches").values({ user_id: user.id, branch_id: b }).execute();
  const res = await login(db, { email, password: PASSWORD, area: "staff" });
  if (!res.ok) throw new Error(`login de prueba falló: ${res.reason}`);
  const actor = await resolveSession(db, res.token);
  if (!actor || actor.kind !== "staff") throw new Error("sesión de prueba inválida");
  return actor;
}

export async function createOwner(db: Database, displayName = "Propietario"): Promise<OwnerActor> {
  const orgId = await organizationId(db);
  const contact = await db
    .insertInto("contacts")
    .values({ organization_id: orgId, display_name: displayName, kind: "person" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.insertInto("contact_roles").values({ contact_id: contact.id, role: "owner" }).execute();
  const email = `owner${++counter}-${Date.now()}@test.local`;
  await db
    .insertInto("users")
    .values({ organization_id: orgId, email, full_name: displayName, password_hash: await hashPassword(PASSWORD), kind: "owner", contact_id: contact.id })
    .execute();
  const res = await login(db, { email, password: PASSWORD, area: "owner" });
  if (!res.ok) throw new Error(`login de propietario falló: ${res.reason}`);
  const actor = await resolveSession(db, res.token);
  if (!actor || actor.kind !== "owner") throw new Error("sesión de propietario inválida");
  return actor;
}

export async function testSystemActor(db: Database): Promise<SystemActor> {
  return { kind: "system", organizationId: await organizationId(db), name: "test" };
}

export const TEST_PASSWORD = PASSWORD;
