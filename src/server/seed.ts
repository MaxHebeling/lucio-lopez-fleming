/**
 * Datos base de la organización (reales, tomados del sitio actual): razón comercial, año de fundación y sucursales.
 * Idempotente. El usuario administrador inicial se crea solo si se pasan email y contraseña (nunca hardcodeados).
 */
import type { Database } from "./db";
import { hashPassword } from "./auth/password";
import { ORG_SLUG, resetOrganizationCache } from "./org";

export async function seedOrganization(db: Database): Promise<string> {
  const org = await db
    .insertInto("organizations")
    .values({ name: "Lucio López Fleming Inmobiliaria", slug: ORG_SLUG, founded_year: 1974 })
    .onConflict((oc) => oc.column("slug").doUpdateSet({ founded_year: 1974 }))
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("branches")
    .values([
      {
        organization_id: org.id,
        name: "Casa Central",
        slug: "casa-central",
        address_street: "Av. Entre Ríos",
        address_number: "639",
        city: "Salta",
        province: "Salta",
        phone: "+54 387 421-4143",
        email: "ignaciolopezfleming@hotmail.com",
        schedule: "Lunes a viernes de 9:00 a 13:00 · Sábados de 10:30 a 12:30",
        latitude: "-24.781313",
        longitude: "-65.410767",
        is_main: true,
      },
      {
        organization_id: org.id,
        name: "Oficina San Lorenzo Chico",
        slug: "san-lorenzo-chico",
        address_street: "Circunvalación Oeste",
        city: "San Lorenzo Chico",
        province: "Salta",
        phone: "+54 387 444-0744",
        email: "ignaciolopezfleming@hotmail.com",
        schedule: "16 a 19",
        is_main: false,
      },
    ])
    .onConflict((oc) => oc.columns(["organization_id", "slug"]).doNothing())
    .execute();
  resetOrganizationCache();
  return org.id;
}

export async function seedAdmin(
  db: Database,
  input: { email: string; password: string; fullName: string; role?: string },
): Promise<string> {
  const orgId = await seedOrganization(db);
  const email = input.email.trim().toLowerCase();
  const existing = await db.selectFrom("users").select("id").where("email", "=", email).where("deleted_at", "is", null).executeTakeFirst();
  const userId =
    existing?.id ??
    (
      await db
        .insertInto("users")
        .values({
          organization_id: orgId,
          email,
          full_name: input.fullName,
          password_hash: await hashPassword(input.password),
          kind: "staff",
          must_change_password: false,
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
  await db
    .insertInto("user_roles")
    .values({ user_id: userId, role_key: input.role ?? "super_admin" })
    .onConflict((oc) => oc.columns(["user_id", "role_key"]).doNothing())
    .execute();
  return userId;
}
