/** Datos de prueba para alquileres. Todo lo creado acá es ficticio y vive solo en la base de tests. */
import type { Database } from "../../src/server/db";
import { organizationId } from "../../src/server/org";
import { addMonths, firstOfMonth, todayInSalta } from "../../src/server/rentals/dates";

let seq = 0;

export async function createTestProperty(db: Database, opts: { status?: string; ownerContactIds?: Array<{ id: string; share?: string }>; published?: boolean } = {}) {
  const orgId = await organizationId(db);
  const code = 90000 + ++seq + Math.floor(Math.random() * 1000) * 10;
  const p = await db
    .insertInto("properties")
    .values({
      organization_id: orgId,
      code,
      slug: `propiedad-test-${code}`,
      title: `Propiedad de prueba ${code}`,
      type_key: "departamento",
      status: opts.status ?? "available",
      is_published: opts.published ?? false,
      published_at: opts.published ? new Date() : null,
    })
    .returning(["id", "code", "slug"])
    .executeTakeFirstOrThrow();
  for (const [i, o] of (opts.ownerContactIds ?? []).entries()) {
    await db.insertInto("property_owners").values({ property_id: p.id, contact_id: o.id, share_pct: o.share ?? null, is_primary: i === 0 }).execute();
  }
  return p;
}

export async function createTestContact(db: Database, name: string, email?: string) {
  const orgId = await organizationId(db);
  const c = await db.insertInto("contacts").values({ organization_id: orgId, display_name: name, kind: "person" }).returning("id").executeTakeFirstOrThrow();
  if (email) await db.insertInto("contact_emails").values({ contact_id: c.id, email, email_normalized: email.toLowerCase(), is_primary: true }).execute();
  return c.id;
}

/** Inicio de contrato relativo a hoy (día 1), para que los tests no dependan de la fecha en que corren. */
export function monthStart(offsetMonths: number): string {
  return addMonths(firstOfMonth(todayInSalta()), offsetMonths);
}

export function contractInput(propertyId: string, owners: Array<{ contactId: string; sharePct?: string }>, tenants: Array<{ contactId: string } | { name: string; email?: string }>, overrides: Record<string, unknown> = {}) {
  return {
    propertyId,
    startDate: monthStart(-2),
    endDate: monthStart(22),
    currency: "ARS",
    initialRent: "450000",
    paymentDueDay: 10,
    managementFeePct: "8",
    owners,
    tenants,
    guarantors: [],
    ...overrides,
  };
}

export function idemKey(): string {
  return `test-${crypto.randomUUID()}`;
}
