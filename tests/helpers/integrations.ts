import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, type Database } from "../../src/server/db";
import { resetFlagCache } from "../../src/server/flags";
import { setFetchForTests } from "../../src/server/integrations/http";
import { setStorageForTests, type StorageDriver } from "../../src/server/storage";
import { changeStatus, createProperty, publishProperty } from "../../src/server/properties/service";
import type { StaffActor } from "../../src/server/auth/actor";

/** resetBusinessData recarga solo 0008: los datos de referencia de integraciones se recargan acá. */
export async function loadIntegrationReferenceData(db: Database): Promise<void> {
  await sql.raw(readFileSync(resolve(import.meta.dirname, "../../db/migrations/0351_integrations_reference_data.sql"), "utf8")).execute(db);
}

export async function setFlag(db: Database, key: string, enabled: boolean): Promise<void> {
  await db.updateTable("feature_flags").set({ enabled }).where("key", "=", key).execute();
  resetFlagCache();
}

/** Storage en memoria con URL pública https (como un bucket público real). */
export function memoryStorage(opts: { publicBase?: string | null } = {}): StorageDriver & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const base = opts.publicBase === undefined ? "https://cdn.llf-pruebas.com.ar" : opts.publicBase;
  return {
    name: "s3",
    objects,
    bucketFor: (v) => (v === "public" ? "pub" : "priv"),
    put: async (bucket, key, body, contentType) => {
      objects.set(`${bucket}/${key}`, { body, contentType });
    },
    get: async (bucket, key) => {
      const o = objects.get(`${bucket}/${key}`);
      if (!o) throw new Error("Archivo inexistente en storage");
      return o.body;
    },
    remove: async (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
    },
    url: async (_bucket, key, _v, fileId) => (base ? `${base}/${key}` : `/api/files/${fileId}`),
    presignPut: async () => null,
    directUploadOrigin: () => null,
  };
}

export function useMemoryStorage(opts?: { publicBase?: string | null }) {
  const s = memoryStorage(opts);
  setStorageForTests(s);
  return s;
}

export type RecordedCall = { method: string; url: string; headers: Record<string, string>; body: string };
type Route = (call: RecordedCall) => Response | Promise<Response | undefined> | undefined;

/** HTTP mockeado: registra cada llamada y responde según rutas. Una llamada sin ruta falla el test. */
export function mockHttp(routes: Route[]) {
  const calls: RecordedCall[] = [];
  setFetchForTests(async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: RecordedCall = { method: init?.method ?? "GET", url: String(input), headers, body: typeof init?.body === "string" ? init.body : "" };
    calls.push(call);
    for (const r of routes) {
      const res = await r(call);
      if (res) return res;
    }
    throw new Error(`HTTP no mockeado: ${call.method} ${call.url}`);
  });
  return { calls, restore: () => setFetchForTests(undefined) };
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

let seq = 0;
export async function publishedProperty(db: Database, admin: StaffActor, opts: { priceHidden?: boolean; media?: Array<{ url: string; status?: string; cover?: boolean }> } = {}) {
  seq++;
  const loc = await db
    .insertInto("locations")
    .values({ kind: "locality", name: "Salta", slug: `salta-int-${seq}-${Date.now()}` })
    .returning("id")
    .executeTakeFirstOrThrow();
  const p = await createProperty(db, admin, {
    title: `Casa en Tres Cerritos ${seq}`,
    typeKey: "casa",
    description: "Casa de tres dormitorios con jardín.",
    locationId: loc.id,
    bedrooms: 3,
    bathrooms: 2,
    rooms: 5,
    garages: 1,
    coveredAreaM2: 180,
    landAreaM2: 450,
    hideExactAddress: true,
    addressStreet: "Los Ceibos",
    addressNumber: "123",
    operations: [{ operation: "sale", currency: "USD", amount: 230000, priceHidden: opts.priceHidden ?? false }],
  });
  const media = opts.media ?? [
    { url: `https://static1.adinco.net/test/${seq}-a.jpg`, status: "verified", cover: true },
    { url: `https://static1.adinco.net/test/${seq}-b.jpg`, status: "verified" },
  ];
  for (const [i, m] of media.entries()) {
    await db.insertInto("property_media").values({ property_id: p.id, kind: "image", source_url: m.url, status: m.status ?? "verified", is_cover: Boolean(m.cover), sort_order: i }).execute();
  }
  await changeStatus(db, admin, p.id, "available");
  await publishProperty(db, admin, p.id);
  return { ...p, locationId: loc.id };
}
