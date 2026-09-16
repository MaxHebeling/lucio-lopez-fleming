import { randomUUID } from "node:crypto";
import type { Database } from "../../src/server/db";
import { createProperty } from "../../src/server/properties/service";
import type { StaffActor } from "../../src/server/auth/actor";

let seq = 0;

/** Teléfono de prueba único (celular de Salta). */
export function uniquePhone(): string {
  seq++;
  return `387${String(4000000 + ((Date.now() % 1_000_000) * 3 + seq) % 5_999_999).padStart(7, "0")}`;
}

export function uniqueEmail(prefix = "c"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@test.local`;
}

export const key = () => randomUUID();

export async function makeProperty(db: Database, admin: StaffActor, title = "Casa en Tres Cerritos") {
  const loc =
    (await db.insertInto("locations").values({ kind: "locality", name: "Salta", slug: "salta" }).onConflict((oc) => oc.doNothing()).returning("id").executeTakeFirst())?.id ??
    (await db.selectFrom("locations").select("id").where("slug", "=", "salta").executeTakeFirstOrThrow()).id;
  return createProperty(db, admin, { title, typeKey: "casa", locationId: loc, operations: [{ operation: "sale", currency: "USD", amount: 150000, priceHidden: false }] });
}
