import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { changePrice, changeStatus, createProperty, duplicateProperty, publishProperty, setOwners, updateProperty } from "@/server/properties/service";
import { getPropertyDetail, listLocationChildren, listProperties, locationChain, searchOwnerCandidates } from "@/server/properties/queries";
import { createLocation } from "@/server/properties/locations";
import { addPropertyImage, deletePropertyMedia, reorderPropertyMedia, setPropertyCover, updateMediaAltText, MAX_IMAGE_EDGE, MAX_IMAGE_BYTES } from "@/server/properties/media";
import { consumeDirectUpload, createUploadIntent, verifyUploadToken } from "@/server/storage/direct-upload";
import { authorizeFileAccess } from "@/server/files/access";
import { setStorageForTests } from "@/server/storage";
import { AppError } from "@/server/errors";
import { createOwner, createStaff, testDb } from "../helpers/db";
import { MemoryStorage } from "../helpers/storage";

const store = new MemoryStorage();
beforeAll(() => setStorageForTests(store));
afterAll(() => setStorageForTests(undefined));

async function salta() {
  const db = testDb();
  const admin = await createStaff(db, ["administrador"]);
  const province = await createLocation(db, admin, { parentId: null, kind: "province", name: "Salta" });
  const locality = await createLocation(db, admin, { parentId: province.id, kind: "locality", name: "Salta Capital" });
  const hood = await createLocation(db, admin, { parentId: locality.id, kind: "neighborhood", name: "Tres Cerritos" });
  return { admin, province, locality, hood };
}

const input = (loc: string, over: Record<string, unknown> = {}) => ({
  title: "Casa con jardín en Tres Cerritos",
  typeKey: "casa",
  locationId: loc,
  bedrooms: 3,
  addressStreet: "Los Ceibos",
  addressNumber: "120",
  attributes: { floors: 2, has_pool: true },
  operations: [{ operation: "sale", currency: "USD", amount: 230000, priceHidden: false }],
  ...over,
});

async function jpeg(width: number, height: number, opts: { orientation?: number; gps?: boolean } = {}) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 180, g: 60, b: 40 } } }).jpeg();
  if (opts.gps) img = img.withExif({ IFD0: { Copyright: "Cámara de prueba" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "24/1 47/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "65/1 24/1 0/1" } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return new Uint8Array(await img.toBuffer());
}

describe("ubicaciones", () => {
  it("jerarquía provincia → localidad → barrio, idempotente y validada por nivel", async () => {
    const db = testDb();
    const { admin, province, locality, hood } = await salta();
    const again = await createLocation(db, admin, { parentId: locality.id, kind: "neighborhood", name: "tres cerritos" });
    expect(again).toMatchObject({ id: hood.id, created: false });
    await expect(createLocation(db, admin, { parentId: province.id, kind: "neighborhood", name: "Barrio suelto" })).rejects.toThrow(/nivel/);
    const chain = await locationChain(db, hood.id);
    expect(chain.map((c) => c.kind)).toEqual(["province", "locality", "neighborhood"]);
    expect((await listLocationChildren(db, admin, locality.id)).map((l) => l.name)).toContain("Tres Cerritos");
    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(createLocation(db, readonly, { parentId: locality.id, kind: "neighborhood", name: "Otro" })).rejects.toThrow(/permiso/);
  });
});

describe("listado y ficha de propiedades", () => {
  it("búsqueda por código, título o dirección, filtros, orden y paginación en el servidor", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const a = await createProperty(db, admin, input(hood.id));
    const b = await createProperty(db, admin, input(hood.id, { title: "Departamento céntrico", typeKey: "departamento", attributes: {}, addressStreet: "Balcarce", operations: [{ operation: "rent", currency: "ARS", amount: 700000, priceHidden: false }] }));
    const c = await createProperty(db, admin, input(hood.id, { title: "Terreno en San Lorenzo", typeKey: "terreno", attributes: {}, operations: [{ operation: "sale", currency: "USD", amount: 50000, priceHidden: false }] }));
    await changeStatus(db, admin, c.id, "archived");

    const byCode = await listProperties(db, admin, { q: String(a.code) });
    expect(byCode.items.map((i) => i.id)).toContain(a.id);
    expect((await listProperties(db, admin, { q: "centrico" })).items.map((i) => i.id)).toEqual([b.id]); // sin tildes
    expect((await listProperties(db, admin, { q: "balcarce" })).items.map((i) => i.id)).toEqual([b.id]);
    // archivadas fuera salvo que se pidan
    expect((await listProperties(db, admin, {})).items.map((i) => i.id)).not.toContain(c.id);
    expect((await listProperties(db, admin, { status: "archived" })).items.map((i) => i.id)).toEqual([c.id]);
    expect((await listProperties(db, admin, { operation: "rent" })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await listProperties(db, admin, { currency: "USD", priceMin: 100000 })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listProperties(db, admin, { agentId: admin.userId, typeKey: "casa" })).items.map((i) => i.id)).toEqual([a.id]);

    const page1 = await listProperties(db, admin, { pageSize: 1, sort: "code_asc" });
    const page2 = await listProperties(db, admin, { pageSize: 1, page: 2, sort: "code_asc" });
    expect(page1.total).toBe(2);
    expect(page1.pageCount).toBe(2);
    expect(page1.items[0]!.code).toBeLessThan(page2.items[0]!.code);
    expect(page1.items[0]!.operations[0]).toMatchObject({ operation: "sale", currency: "USD" });

    const noPerm = { ...admin, roles: [], permissions: new Set<string>() };
    await expect(listProperties(db, noPerm, {})).rejects.toBeInstanceOf(AppError);
  });

  it("la ficha oculta propietarios sin properties.read_private y muestra historial", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const p = await createProperty(db, admin, input(hood.id));
    await changePrice(db, admin, p.id, { operation: "sale", currency: "USD", amount: 220000, priceHidden: false }, "Ajuste de mercado");
    const owner = await createOwner(db, "María Fernández");
    await setOwners(db, admin, p.id, [{ contactId: owner.contactId, sharePct: 100, isPrimary: true }]);

    const full = await getPropertyDetail(db, admin, p.id);
    expect(full.owners?.map((o) => o.display_name)).toEqual(["María Fernández"]);
    expect(full.priceHistory[0]).toMatchObject({ new_amount: "220000.00", reason: "Ajuste de mercado" });
    expect(full.location.map((l) => l.name)).toEqual(["Salta", "Salta Capital", "Tres Cerritos"]);
    expect(full.blockers).toContain("Falta al menos una foto");
    expect(full.audit?.length).toBeGreaterThan(0);

    const agent = await createStaff(db, ["agente"]);
    const limited = await getPropertyDetail(db, agent, p.id);
    expect(limited.owners).toBeNull();
    expect(limited.audit).toBeNull();
    await expect(searchOwnerCandidates(db, agent, "María")).rejects.toThrow(/permiso/);
    expect((await searchOwnerCandidates(db, admin, "maria")).map((c) => c.id)).toContain(owner.contactId);
    await expect(getPropertyDetail(db, admin, "no-es-uuid")).rejects.toThrow(/no encontrad/);
  });

  it("edición parcial no pisa características, atributos, destacada ni ocultar dirección (fix schema núcleo)", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    await db.insertInto("features").values({ key: "gas_natural_test", name: "Gas natural", grp: "service" }).execute();
    const p = await createProperty(db, admin, input(hood.id, { featureKeys: ["gas_natural_test"], featured: true, hideExactAddress: false }));
    await updateProperty(db, admin, p.id, { bedrooms: 4 });
    const row = await db.selectFrom("properties").select(["bedrooms", "featured", "hide_exact_address", "attributes"]).where("id", "=", p.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ bedrooms: 4, featured: true, hide_exact_address: false, attributes: { floors: 2, has_pool: true } });
    expect(await db.selectFrom("property_features").select("feature_id").where("property_id", "=", p.id).execute()).toHaveLength(1);
    const audit = await db.selectFrom("audit_logs").select(["before", "after"]).where("entity_id", "=", p.id).where("action", "=", "PROPERTY_UPDATED").executeTakeFirstOrThrow();
    expect(audit).toEqual({ before: { bedrooms: 3 }, after: { bedrooms: 4 } });
  });

  it("duplicar: borrador con código nuevo, copia datos/operaciones/características, no multimedia ni publicaciones", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const feature = await db.insertInto("features").values({ key: "pileta_test", name: "Pileta", grp: "amenity" }).returning("id").executeTakeFirstOrThrow();
    const p = await createProperty(db, admin, input(hood.id, { featureKeys: ["pileta_test"] }));
    await changeStatus(db, admin, p.id, "available");
    await addPropertyImage(db, admin, p.id, await jpeg(40, 30));
    await publishProperty(db, admin, p.id);

    const agent = await createStaff(db, ["agente"]);
    const copy = await duplicateProperty(db, agent, p.id);
    expect(copy.code).not.toBe(p.code);
    const row = await db.selectFrom("properties").select(["title", "status", "is_published", "bedrooms", "attributes", "location_id", "source"]).where("id", "=", copy.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ title: "Casa con jardín en Tres Cerritos (copia)", status: "draft", is_published: false, bedrooms: 3, location_id: hood.id, source: "crm" });
    expect(row.attributes).toEqual({ floors: 2, has_pool: true });
    const ops = await db.selectFrom("property_operations").select(["operation", "amount"]).where("property_id", "=", copy.id).execute();
    expect(ops).toEqual([{ operation: "sale", amount: "230000.00" }]);
    const feats = await db.selectFrom("property_features").select("feature_id").where("property_id", "=", copy.id).execute();
    expect(feats).toEqual([{ feature_id: feature.id }]);
    expect(await db.selectFrom("property_media").select("id").where("property_id", "=", copy.id).execute()).toHaveLength(0);
    expect(await db.selectFrom("property_publications").select("id").where("property_id", "=", copy.id).execute()).toHaveLength(0);
    const log = await db.selectFrom("audit_logs").select(["action", "metadata"]).where("entity_id", "=", copy.id).execute();
    expect(log[0]).toMatchObject({ action: "PROPERTY_DUPLICATED", metadata: { sourceId: p.id, sourceCode: p.code } });

    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(duplicateProperty(db, readonly, p.id)).rejects.toThrow(/permiso/);
  });
});

describe("multimedia", () => {
  it("rota según EXIF, quita EXIF/GPS, guarda original privado + webp ≤ 2400 px público y audita", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const p = await createProperty(db, admin, input(hood.id));
    const raw = await jpeg(300, 100, { orientation: 6, gps: true });
    const before = await sharp(Buffer.from(raw)).metadata();
    expect(before.exif).toBeDefined();

    const r = await addPropertyImage(db, admin, p.id, raw, { altText: "Frente" });
    expect(r).toMatchObject({ width: 100, height: 300, isCover: true });
    const media = await db.selectFrom("property_media").select(["file_id", "original_file_id", "status", "alt_text", "is_cover"]).where("id", "=", r.mediaId).executeTakeFirstOrThrow();
    expect(media).toMatchObject({ status: "stored", alt_text: "Frente", is_cover: true });
    const files = await db.selectFrom("files").select(["id", "visibility", "content_type", "bucket", "storage_key", "width", "height"]).where("id", "in", [media.file_id!, media.original_file_id!]).execute();
    const optimized = files.find((f) => f.id === media.file_id)!;
    const original = files.find((f) => f.id === media.original_file_id)!;
    expect(optimized).toMatchObject({ visibility: "public", content_type: "image/webp", width: 100, height: 300 });
    expect(original).toMatchObject({ visibility: "private", content_type: "image/jpeg", width: 100, height: 300 });
    for (const f of [optimized, original]) {
      const meta = await sharp(Buffer.from(store.objects.get(`${f.bucket}/${f.storage_key}`)!.body)).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect([meta.width, meta.height]).toEqual([100, 300]);
    }

    const big = await addPropertyImage(db, admin, p.id, await jpeg(3000, 2000));
    expect([big.width, big.height]).toEqual([MAX_IMAGE_EDGE, 1600]);
    expect(big.isCover).toBe(false);

    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", p.id).execute()).map((a) => a.action);
    expect(actions.filter((a) => a === "PROPERTY_MEDIA_ADDED")).toHaveLength(2);
    const events = await db.selectFrom("domain_events").select("payload").where("aggregate_id", "=", p.id).where("event_type", "=", "property.updated").execute();
    expect(events.some((e) => (e.payload as { fields: string[] }).fields.includes("media"))).toBe(true);
  });

  it("rechaza archivos por firma real, tamaño y permisos; limpia storage si falla la base", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const p = await createProperty(db, admin, input(hood.id));
    const fakeJpg = new TextEncoder().encode("<html>no soy una foto</html>");
    await expect(addPropertyImage(db, admin, p.id, fakeJpg)).rejects.toThrow(/Formato no admitido/);
    const pdf = new TextEncoder().encode("%PDF-1.7 documento");
    await expect(addPropertyImage(db, admin, p.id, pdf)).rejects.toThrow(/Formato no admitido/);
    const huge = new Uint8Array(15 * 1024 * 1024 + 10);
    huge.set([0xff, 0xd8, 0xff, 0xe0]);
    await expect(addPropertyImage(db, admin, p.id, huge)).rejects.toThrow(/máximo/);
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(addPropertyImage(db, admin, p.id, broken)).rejects.toThrow(/dañada/);

    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(addPropertyImage(db, readonly, p.id, await jpeg(10, 10))).rejects.toThrow(/permiso/);

    const objectsBefore = store.objects.size;
    await expect(addPropertyImage(db, admin, "00000000-0000-0000-0000-000000000000", await jpeg(10, 10))).rejects.toThrow(/no encontrad/);
    // Falla en la segunda escritura: la primera se borra
    const original = store.put.bind(store);
    let calls = 0;
    store.put = async (...args) => {
      calls++;
      if (calls === 2) throw new Error("storage caído (simulado)");
      return original(...args);
    };
    await expect(addPropertyImage(db, admin, p.id, await jpeg(10, 10))).rejects.toThrow(/caído/);
    store.put = original;
    expect(store.objects.size).toBe(objectsBefore);
    expect(await db.selectFrom("property_media").select("id").where("property_id", "=", p.id).execute()).toHaveLength(0);
  });

  it("reordenar, portada, alt text y baja lógica con reasignación de portada", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const p = await createProperty(db, admin, input(hood.id));
    const m1 = await addPropertyImage(db, admin, p.id, await jpeg(20, 20));
    const m2 = await addPropertyImage(db, admin, p.id, await jpeg(20, 20));
    const m3 = await addPropertyImage(db, admin, p.id, await jpeg(20, 20));

    await reorderPropertyMedia(db, admin, p.id, [m3.mediaId, m1.mediaId, m2.mediaId]);
    const order = await db.selectFrom("property_media").select("id").where("property_id", "=", p.id).where("deleted_at", "is", null).orderBy("sort_order").execute();
    expect(order.map((o) => o.id)).toEqual([m3.mediaId, m1.mediaId, m2.mediaId]);
    await expect(reorderPropertyMedia(db, admin, p.id, [m3.mediaId, m1.mediaId])).rejects.toThrow(/cambió/);

    await setPropertyCover(db, admin, p.id, m2.mediaId);
    const covers = await db.selectFrom("property_media").select("id").where("property_id", "=", p.id).where("is_cover", "=", true).execute();
    expect(covers.map((c) => c.id)).toEqual([m2.mediaId]);

    await updateMediaAltText(db, admin, p.id, m2.mediaId, "Living con ventanal");
    await expect(updateMediaAltText(db, admin, p.id, m2.mediaId, "x".repeat(300))).rejects.toThrow(/inválido/);

    const del = await deletePropertyMedia(db, admin, p.id, m2.mediaId);
    expect(del.newCoverId).toBe(m3.mediaId);
    const deletedFile = await db.selectFrom("property_media as m").innerJoin("files as f", "f.id", "m.file_id").select(["m.deleted_at", "f.deleted_at as file_deleted"]).where("m.id", "=", m2.mediaId).executeTakeFirstOrThrow();
    expect(deletedFile.deleted_at).not.toBeNull();
    expect(deletedFile.file_deleted).not.toBeNull();
    // Otra propiedad no puede tocar multimedia ajena
    const other = await createProperty(db, admin, input(hood.id));
    await expect(setPropertyCover(db, admin, other.id, m1.mediaId)).rejects.toThrow(/no encontrad/);

    const agentMarketing = await createStaff(db, ["marketing"]);
    await setPropertyCover(db, agentMarketing, p.id, m1.mediaId);
    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(deletePropertyMedia(db, readonly, p.id, m1.mediaId)).rejects.toThrow(/permiso/);
    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", p.id).execute()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["PROPERTY_MEDIA_REORDERED", "PROPERTY_MEDIA_COVER_SET", "PROPERTY_MEDIA_UPDATED", "PROPERTY_MEDIA_DELETED"]));
  });

  it("acceso a archivos: públicos sin sesión, originales con properties.read, documentos con read_private, borrados nunca", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const p = await createProperty(db, admin, input(hood.id));
    const m = await addPropertyImage(db, admin, p.id, await jpeg(20, 20));
    const media = await db.selectFrom("property_media").select(["file_id", "original_file_id"]).where("id", "=", m.mediaId).executeTakeFirstOrThrow();
    const anon = { kind: "anonymous" as const, organizationId: admin.organizationId };
    expect((await authorizeFileAccess(db, anon, media.file_id!)).ok).toBe(true);
    expect(await authorizeFileAccess(db, anon, media.original_file_id!)).toEqual({ ok: false, reason: "unauthenticated" });
    const readonly = await createStaff(db, ["solo_lectura"]);
    expect((await authorizeFileAccess(db, readonly, media.original_file_id!)).ok).toBe(true);

    const doc = await db
      .insertInto("files")
      .values({ storage_driver: "local", bucket: "private", storage_key: "docs/escritura.pdf", content_type: "application/pdf", size_bytes: 10, visibility: "private" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.insertInto("property_documents").values({ property_id: p.id, file_id: doc.id, kind: "deed", title: "Escritura", visible_to_owner: true }).execute();
    expect(await authorizeFileAccess(db, readonly, doc.id)).toEqual({ ok: false, reason: "forbidden" });
    const rentals = await createStaff(db, ["alquileres"]);
    expect((await authorizeFileAccess(db, rentals, doc.id)).ok).toBe(true);
    const owner = await createOwner(db);
    expect(await authorizeFileAccess(db, owner, doc.id)).toEqual({ ok: false, reason: "forbidden" });
    await db.insertInto("property_owners").values({ property_id: p.id, contact_id: owner.contactId }).execute();
    expect((await authorizeFileAccess(db, owner, doc.id)).ok).toBe(true);

    const orphan = await db.insertInto("files").values({ storage_driver: "local", bucket: "private", storage_key: "x/huerfano.pdf", content_type: "application/pdf", size_bytes: 1, visibility: "private" }).returning("id").executeTakeFirstOrThrow();
    const superAdmin = await createStaff(db, ["super_admin"]);
    expect((await authorizeFileAccess(db, superAdmin, orphan.id)).ok).toBe(false);

    await deletePropertyMedia(db, admin, p.id, m.mediaId);
    expect(await authorizeFileAccess(db, anon, media.file_id!)).toEqual({ ok: false, reason: "not_found" });
    expect(await authorizeFileAccess(db, anon, "../../etc/passwd")).toEqual({ ok: false, reason: "not_found" });
  });

  it("subida directa: intent firmado → objeto temporal → complete procesa la foto y borra el temporal (también si es inválida)", async () => {
    const db = testDb();
    const { admin, hood } = await salta();
    const p = await createProperty(db, admin, input(hood.id));
    process.env.UPLOAD_SIGNING_SECRET = "secreto-de-prueba-de-al-menos-32-caracteres-ok";
    store.direct = true;
    try {
      const bytes = await jpeg(64, 48);
      const intent = await createUploadIntent({ userId: admin.userId, entity: p.id, purpose: "property-media", contentType: "image/jpeg", size: bytes.byteLength });
      if (intent.mode !== "direct") throw new Error("se esperaba subida directa");
      expect(intent.uploadUrl).toMatch(/^https:\/\/storage\.test\/private\/uploads\/tmp\//);
      const key = verifyUploadToken(intent.token, { userId: admin.userId, entity: p.id, purpose: "property-media" }).k;
      await store.put("private", key, bytes, "image/jpeg"); // lo que haría el navegador con el PUT firmado
      const r = await consumeDirectUpload(key, MAX_IMAGE_BYTES, (b) => addPropertyImage(db, admin, p.id, b, { kind: "image" }));
      expect(r.width).toBe(64);
      expect(store.objects.has(`private/${key}`)).toBe(false);

      const bad = await createUploadIntent({ userId: admin.userId, entity: p.id, purpose: "property-media", contentType: "image/png", size: 10 });
      if (bad.mode !== "direct") throw new Error("se esperaba subida directa");
      const badKey = verifyUploadToken(bad.token, { userId: admin.userId, entity: p.id, purpose: "property-media" }).k;
      await store.put("private", badKey, new TextEncoder().encode("<script>no es una imagen</script>"), "image/png");
      await expect(consumeDirectUpload(badKey, MAX_IMAGE_BYTES, (b) => addPropertyImage(db, admin, p.id, b, { kind: "image" }))).rejects.toThrow();
      expect(store.objects.has(`private/${badKey}`)).toBe(false);
      await expect(createUploadIntent({ userId: admin.userId, entity: p.id, purpose: "property-media", contentType: "application/x-msdownload", size: 10 })).rejects.toThrow(/Formato/);
    } finally {
      store.direct = false;
    }
  });
});
