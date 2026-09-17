/**
 * Property Quality AI + AI Photo Director contra Postgres real: informe idempotente, recálculo por evento y nocturno,
 * nunca modifica propiedad/medios, `source_only` no se descarga, precio con muestra, RBAC y organización,
 * etiquetado manual, orden sugerido auditado, visión con proveedor falso (sugerencias pendientes), proveedor caído.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { AppError } from "@/server/errors";
import type { StaffActor, SystemActor } from "@/server/auth/actor";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { runJobs } from "@/server/jobs/runner";
import { enqueueScheduled } from "@/server/jobs/scheduled";
import { addPropertyImage } from "@/server/properties/media";
import { changePrice, createProperty, updateProperty } from "@/server/properties/service";
import { setStorageForTests, type StorageDriver } from "@/server/storage";
import { computePropertyQuality, enqueueNightlyQuality, getPropertyQuality, recomputeQualityNow } from "@/server/ai/property/quality";
import { applySuggestedOrder, getPhotoDirector, requestRoomSuggestions, reviewRoomSuggestions, setMediaRoom, suggestRoomsWithVision } from "@/server/ai/property/photo-director";
import { setTaskProviderForTests } from "@/server/ai/run-task";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { FakeProvider, result } from "../helpers/ai";
import { scene } from "../helpers/images";
import { memoryStorage, setFlag } from "../helpers/integrations";

let admin: StaffActor;
let agente: StaffActor;
let lectura: StaffActor;
let system: SystemActor;
let store: ReturnType<typeof memoryStorage>;
let gets: string[];
let locationId: string;
let otherOrgPropertyId: string;

const expectApp = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
};

async function drain() {
  const db = testDb();
  for (let i = 0; i < 4; i++) {
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 300_000 });
  }
}

async function snapshotRows(propertyId: string) {
  const db = testDb();
  const p = await db.selectFrom("properties").selectAll().where("id", "=", propertyId).executeTakeFirstOrThrow();
  const media = await db.selectFrom("property_media").selectAll().where("property_id", "=", propertyId).orderBy("id").execute();
  const ops = await db.selectFrom("property_operations").selectAll().where("property_id", "=", propertyId).orderBy("id").execute();
  return JSON.stringify({ p, media, ops });
}

async function newProperty(title: string, over: Record<string, unknown> = {}) {
  return createProperty(testDb(), admin, { title, typeKey: "casa", locationId, operations: [{ operation: "sale", currency: "USD", amount: 150000, priceHidden: false }], ...over });
}

beforeAll(async () => {
  const db = testDb();
  admin = await createStaff(db, ["super_admin"]);
  agente = await createStaff(db, ["agente"]);
  lectura = await createStaff(db, ["solo_lectura"]);
  system = await testSystemActor(db);
  locationId = (await db.insertInto("locations").values({ kind: "locality", name: "Salta Calidad", slug: `salta-calidad-${Date.now()}` }).returning("id").executeTakeFirstOrThrow()).id;
  const otherOrg = (await db.insertInto("organizations").values({ name: "Otra inmobiliaria", slug: "otra-calidad" }).returning("id").executeTakeFirstOrThrow()).id;
  otherOrgPropertyId = (await db.insertInto("properties").values({ organization_id: otherOrg, code: 990101, slug: "ajena-990101", title: "Propiedad AJENA", type_key: "casa", status: "draft" }).returning("id").executeTakeFirstOrThrow()).id;
  const base = memoryStorage({ publicBase: null });
  gets = [];
  // Mismo contrato que el driver real; registra cada lectura para verificar que nunca se toca una URL externa.
  store = Object.assign(base, {
    name: "local" as const,
    get: async (bucket: string, key: string) => {
      gets.push(`${bucket}/${key}`);
      const o = base.objects.get(`${bucket}/${key}`);
      if (!o) throw new Error("Archivo inexistente en storage");
      return o.body;
    },
  }) as unknown as ReturnType<typeof memoryStorage>;
  setStorageForTests(store as unknown as StorageDriver);
});

afterAll(() => {
  setStorageForTests(undefined);
  setTaskProviderForTests(undefined);
});

beforeEach(() => {
  setTaskProviderForTests(null);
});

describe("informe de calidad", () => {
  it("calcula, es idempotente y nunca modifica la propiedad ni sus fotos", async () => {
    const db = testDb();
    const p = await newProperty("Casa para calidad");
    const before = await snapshotRows(p.id);
    const first = await computePropertyQuality(db, system, p.id);
    expect(first.status).toBe("computed");
    const second = await computePropertyQuality(db, system, p.id);
    expect(second.status).toBe("unchanged");
    expect(await snapshotRows(p.id)).toBe(before);
    const events = await db.selectFrom("domain_events").select("id").where("event_type", "=", "property.quality_computed").where("aggregate_id", "=", p.id).execute();
    expect(events).toHaveLength(1);
    const { report } = await getPropertyQuality(db, agente, p.id);
    expect(report!.findings.find((f) => f.code === "missing_description")!.href).toBe(`/crm/propiedades/${p.id}/editar#description`);
    expect(report!.score).toBeLessThan(60);
    // El payload del evento no lleva datos personales ni texto de la ficha.
    const payload = (await db.selectFrom("domain_events").select("payload").where("id", "=", events[0]!.id).executeTakeFirstOrThrow()).payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["findings", "previousScore", "rulesVersion", "score"]);
  });

  it("se recalcula por evento (edición y precio) con las automatizaciones de sistema, sin loops", async () => {
    const db = testDb();
    const p = await newProperty("Casa por evento");
    await drain();
    const r1 = await getPropertyQuality(db, admin, p.id);
    expect(r1.report).not.toBeNull();
    await updateProperty(db, admin, p.id, { description: "Casa con 3 dormitorios, 2 baños y 180 m2 cubiertos. ".repeat(6), bedrooms: 3, bathrooms: 2, coveredAreaM2: 180, orientation: "Norte" });
    await drain();
    const r2 = await getPropertyQuality(db, admin, p.id);
    expect(r2.report!.score).toBeGreaterThan(r1.report!.score);
    expect(r2.report!.criteria.find((c) => c.key === "description")!.ok).toBe(true);
    const count = async () => Number((await db.selectFrom("domain_events").select(sql<number>`count(*)::int`.as("n")).where("event_type", "=", "property.quality_computed").where("aggregate_id", "=", p.id).executeTakeFirstOrThrow()).n);
    const n = await count();
    await drain();
    expect(await count()).toBe(n);
    await changePrice(db, admin, p.id, { operation: "sale", currency: "USD", amount: 160000, priceHidden: false });
    await drain();
    expect(await db.selectFrom("jobs").select("status").where("type", "=", "ai.property_quality").where("status", "in", ["failed", "dead"]).execute()).toEqual([]);
  });

  it("fotos almacenadas: duplicadas, oscuras y borrosas; las del sitio anterior no se descargan", async () => {
    const db = testDb();
    const p = await newProperty("Casa con fotos");
    const a = await scene(11);
    const imgs = [
      a,
      await sharp(a).resize({ width: 800 }).jpeg({ quality: 60 }).toBuffer(), // repetida
      await sharp(await scene(12)).linear(0.2, 0).jpeg().toBuffer(), // oscura
      await sharp(await sharp(await scene(13)).resize({ width: 512 }).toBuffer()).blur(3).jpeg().toBuffer(), // borrosa
    ];
    for (const b of imgs) await addPropertyImage(db, admin, p.id, new Uint8Array(b));
    await db.insertInto("property_media").values({ property_id: p.id, kind: "image", source_url: "https://static1.adinco.net/test/externa.jpg", status: "source_only", sort_order: 99 }).execute();
    await db.insertInto("property_media").values({ property_id: p.id, kind: "image", source_url: "https://static1.adinco.net/test/verificada.jpg", status: "verified", sort_order: 100 }).execute();
    gets.length = 0;
    const before = await snapshotRows(p.id);
    const r = await computePropertyQuality(db, system, p.id);
    expect(r.status).toBe("computed");
    expect(await snapshotRows(p.id)).toBe(before);
    // Solo se leyeron los 4 archivos propios (webp optimizados del bucket público), nunca una URL externa.
    expect(gets).toHaveLength(4);
    expect(gets.every((k) => k.startsWith("pub/properties/"))).toBe(true);
    const { report } = await getPropertyQuality(db, admin, p.id);
    const codes = report!.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["photo_duplicate", "photo_dark", "photo_blurry", "photo_external_not_analyzed"]));
    expect(report!.mediaSummary).toMatchObject({ images: 6, stored: 4, analyzed: 4, external: 2, duplicates: 1, dark: 1, blurry: 1 });
    // Segunda corrida: no vuelve a descargar (métricas vigentes) ni reescribe.
    gets.length = 0;
    expect((await computePropertyQuality(db, system, p.id)).status).toBe("unchanged");
    expect(gets).toHaveLength(0);
  });

  it("precio fuera de rango solo con muestra suficiente", async () => {
    const db = testDb();
    const loc = (await db.insertInto("locations").values({ kind: "locality", name: "Comparables", slug: `comparables-${Date.now()}` }).returning("id").executeTakeFirstOrThrow()).id;
    const target = await createProperty(db, admin, { title: "Casa barata", typeKey: "casa", locationId: loc, coveredAreaM2: 200, operations: [{ operation: "sale", currency: "USD", amount: 40000, priceHidden: false }] });
    await db.updateTable("properties").set({ status: "available" }).where("id", "=", target.id).execute();
    const addComparables = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const c = await createProperty(db, admin, { title: `Comparable ${i} ${Date.now()}`, typeKey: "casa", locationId: loc, coveredAreaM2: 200, operations: [{ operation: "sale", currency: "USD", amount: 200000 + i * 5000, priceHidden: false }] });
        await db.updateTable("properties").set({ status: "available" }).where("id", "=", c.id).execute();
      }
    };
    await addComparables(3);
    await computePropertyQuality(db, system, target.id);
    let r = (await getPropertyQuality(db, admin, target.id)).report!;
    expect(r.findings.map((f) => f.code)).not.toContain("price_low");
    expect(r.mediaSummary).toMatchObject({ priceCheck: { status: "insufficient_sample", sample: 3 } });
    await addComparables(5);
    await computePropertyQuality(db, system, target.id);
    r = (await getPropertyQuality(db, admin, target.id)).report!;
    const f = r.findings.find((x) => x.code === "price_low")!;
    expect(f.detail).toContain("8 propiedades");
    expect(f.detail).toMatch(/No es una tasación/);
  });

  it("nocturno: la tarea diaria encola el recálculo de las activas (no las demo)", async () => {
    const db = testDb();
    const demo = await newProperty("Demo calidad");
    await db.updateTable("properties").set({ is_demo: true }).where("id", "=", demo.id).execute();
    const r = await enqueueNightlyQuality(db);
    expect(r.enqueued).toBeGreaterThan(0);
    const jobs = await db.selectFrom("jobs").select(sql<string>`payload->>'propertyId'`.as("pid")).where("type", "=", "ai.property_quality").where("dedupe_key", "like", "%nightly%").execute();
    expect(jobs.map((j) => j.pid)).not.toContain(demo.id);
    const saltaMorning = new Date("2026-09-18T12:00:00Z");
    await enqueueScheduled(db, saltaMorning);
    expect(await db.selectFrom("jobs").select("id").where("type", "=", "ai.property_quality_nightly").executeTakeFirst()).toBeTruthy();
  });

  it("flag apagado: no calcula y la ficha no muestra informe", async () => {
    const db = testDb();
    const p = await newProperty("Casa sin flag");
    await setFlag(db, "ai_property_quality", false);
    try {
      expect(await computePropertyQuality(db, system, p.id)).toEqual({ status: "skipped", reason: "flag apagado" });
      expect(await getPropertyQuality(db, admin, p.id)).toEqual({ enabled: false, report: null });
    } finally {
      await setFlag(db, "ai_property_quality", true);
    }
  });

  it("RBAC y organización: otra organización no ve el informe ni puede recalcularlo", async () => {
    const db = testDb();
    await computePropertyQuality(db, system, otherOrgPropertyId);
    expect((await getPropertyQuality(db, admin, otherOrgPropertyId)).report).toBeNull();
    await expectApp(recomputeQualityNow(db, admin, otherOrgPropertyId), "not_found");
    const anon = { kind: "anonymous" as const, organizationId: admin.organizationId };
    await expectApp(getPropertyQuality(db, anon, otherOrgPropertyId), "unauthenticated");
  });
});

describe("director de fotos", () => {
  async function propertyWithPhotos() {
    const db = testDb();
    const p = await newProperty(`Casa fotos ${Date.now()}`);
    const ids: string[] = [];
    for (const seed of [21, 22, 23, 24]) ids.push((await addPropertyImage(db, admin, p.id, new Uint8Array(await scene(seed)))).mediaId);
    return { p, ids };
  }

  it("etiquetado manual auditado; rol sin permiso de multimedia no etiqueta; otra organización 404", async () => {
    const db = testDb();
    const { p, ids } = await propertyWithPhotos();
    expect(await setMediaRoom(db, agente, { propertyId: p.id, mediaId: ids[1]!, room: "fachada" })).toEqual({ changed: true });
    expect(await setMediaRoom(db, agente, { propertyId: p.id, mediaId: ids[1]!, room: "fachada" })).toEqual({ changed: false });
    const log = await db.selectFrom("audit_logs").select(["action", "after"]).where("entity_id", "=", p.id).where("action", "=", "PROPERTY_MEDIA_ROOM_SET").execute();
    expect(log).toHaveLength(1);
    await expectApp(setMediaRoom(db, lectura, { propertyId: p.id, mediaId: ids[0]!, room: "living" }), "forbidden");
    await expectApp(setMediaRoom(db, admin, { propertyId: otherOrgPropertyId, mediaId: ids[0]!, room: "living" }), "not_found");
    // Una foto de otra propiedad no se puede etiquetar bajo esta.
    const other = await propertyWithPhotos();
    await expectApp(setMediaRoom(db, admin, { propertyId: p.id, mediaId: other.ids[0]!, room: "living" }), "not_found");
  });

  it("orden sugerido: explica, se aplica solo confirmado, queda auditado, no borra fotos y detecta cambios", async () => {
    const db = testDb();
    const { p, ids } = await propertyWithPhotos();
    let view = await getPhotoDirector(db, agente, p.id);
    expect(view.suggestion.basis).toBe("none");
    await expectApp(applySuggestedOrder(db, agente, { propertyId: p.id, order: ids, heroId: ids[0]! }), "validation");
    await setMediaRoom(db, agente, { propertyId: p.id, mediaId: ids[0]!, room: "dormitorio" });
    await setMediaRoom(db, agente, { propertyId: p.id, mediaId: ids[2]!, room: "living" });
    await setMediaRoom(db, agente, { propertyId: p.id, mediaId: ids[3]!, room: "fachada" });
    view = await getPhotoDirector(db, agente, p.id);
    expect(view.suggestion).toMatchObject({ basis: "tags", heroId: ids[3], changed: true });
    expect(view.suggestion.order.slice(0, 3)).toEqual([ids[3], ids[2], ids[0]]);
    expect(view.suggestion.reasons[0]!.reason).toMatch(/Portada sugerida: fachada/);
    // Sugerencia vieja (el orden cambió): conflicto, nada se aplica.
    await expectApp(applySuggestedOrder(db, agente, { propertyId: p.id, order: [...view.suggestion.order].reverse(), heroId: view.suggestion.heroId }), "conflict");
    await expectApp(applySuggestedOrder(db, lectura, { propertyId: p.id, order: view.suggestion.order, heroId: view.suggestion.heroId }), "forbidden");
    expect(await applySuggestedOrder(db, agente, { propertyId: p.id, order: view.suggestion.order, heroId: view.suggestion.heroId })).toEqual({ changed: true });
    const media = await db.selectFrom("property_media").select(["id", "is_cover", "deleted_at"]).where("property_id", "=", p.id).orderBy("sort_order").execute();
    expect(media.map((m) => m.id)).toEqual(view.suggestion.order);
    expect(media.find((m) => m.is_cover)!.id).toBe(ids[3]);
    expect(media.every((m) => m.deleted_at === null)).toBe(true);
    const a = await db.selectFrom("audit_logs").select(["before", "after", "metadata"]).where("entity_id", "=", p.id).where("action", "=", "PROPERTY_MEDIA_SUGGESTED_ORDER_APPLIED").executeTakeFirstOrThrow();
    expect((a.metadata as { reasons: string[] }).reasons.length).toBeGreaterThan(0);
    const after = await getPhotoDirector(db, agente, p.id);
    expect(after.suggestion.changed).toBe(false);
  });

  it("visión con proveedor falso: sugerencias pendientes (no etiquetas), aceptar las copia; injection en la imagen no cambia nada", async () => {
    const db = testDb();
    const { p, ids } = await propertyWithPhotos();
    const fake = new FakeProvider([
      result([{ type: "tool_use", id: "t1", name: "emitir_resultado", input: { photos: [{ index: 1, room: "fachada", confidence: 0.91 }, { index: 2, room: "cocina", confidence: 0.8 }, { index: 3, room: "bano", confidence: 0.55 }, { index: 4, room: "living", confidence: 0.7 }] } }], "tool_use"),
    ]);
    setTaskProviderForTests(fake);
    expect((await requestRoomSuggestions(db, agente, p.id)).queued).toBe(true);
    const r = await suggestRoomsWithVision(db, system, p.id);
    expect(r.suggested).toBe(4);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.task).toBe("vision");
    const blocks = fake.calls[0]!.messages[0]!.content as Array<{ type: string }>;
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(4);
    const view = await getPhotoDirector(db, agente, p.id);
    expect(view.pendingSuggestions).toBe(4);
    expect(view.items.every((i) => i.room === null)).toBe(true);
    const usage = await db.selectFrom("ai_interactions").select(["purpose", "feature", "status", "task"]).where("feature", "=", "ai.photo_director.tags").execute();
    expect(usage).toEqual([{ purpose: "photo_tags", feature: "ai.photo_director.tags", status: "ok", task: "vision" }]);
    expect(await db.selectFrom("domain_events").select("id").where("event_type", "=", "media.tags_suggested").where("aggregate_id", "=", p.id).execute()).toHaveLength(1);
    expect(await reviewRoomSuggestions(db, agente, { propertyId: p.id, mediaIds: [ids[0]!, ids[1]!], decision: "accept" })).toEqual({ changed: 2 });
    expect(await reviewRoomSuggestions(db, agente, { propertyId: p.id, mediaIds: [ids[2]!], decision: "dismiss" })).toEqual({ changed: 1 });
    const rooms = await db.selectFrom("property_media_rooms").select(["media_id", "room", "room_source", "suggestion_status"]).where("property_id", "=", p.id).execute();
    const byId = Object.fromEntries(rooms.map((x) => [x.media_id, x]));
    expect(byId[ids[0]!]).toMatchObject({ room: "fachada", room_source: "ai_accepted", suggestion_status: "accepted" });
    expect(byId[ids[2]!]).toMatchObject({ room: null, suggestion_status: "dismissed" });
    // Misma imagen: no se vuelve a pedir visión.
    setTaskProviderForTests(new FakeProvider([]));
    expect((await suggestRoomsWithVision(db, system, p.id)).suggested).toBe(0);
  });

  it("salida inválida o proveedor caído: no escribe nada y queda registrado; sin clave no se puede pedir", async () => {
    const db = testDb();
    const { p } = await propertyWithPhotos();
    setTaskProviderForTests(new FakeProvider([result([{ type: "tool_use", id: "t", name: "emitir_resultado", input: { photos: [{ index: 9, room: "cocina", confidence: 2 }] } }], "tool_use")]));
    expect(await suggestRoomsWithVision(db, system, p.id)).toEqual({ suggested: 0, reason: "invalid_output" });
    setTaskProviderForTests(new FakeProvider([Object.assign(new Error("upstream"), { status: 529 }), Object.assign(new Error("upstream"), { status: 529 })]));
    expect((await suggestRoomsWithVision(db, system, p.id)).suggested).toBe(0);
    expect(await db.selectFrom("property_media_rooms").select("media_id").where("property_id", "=", p.id).execute()).toEqual([]);
    setTaskProviderForTests(null);
    await expectApp(requestRoomSuggestions(db, agente, p.id), "unavailable");
  });
});
