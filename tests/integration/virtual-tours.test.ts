import { resolve } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { AppError } from "@/server/errors";
import { setStorageForTests } from "@/server/storage";
import type { StaffActor } from "@/server/auth/actor";
import { publishProperty, unpublishProperty, duplicateProperty } from "@/server/properties/service";
import { getPublicFacets, getPublicPropertyBySlug, getRecentProperties, getShowcaseProperties, listPublishedForSitemap, resetPublicLocationCache, searchPublicProperties } from "@/server/properties/public";
import { listListingCombinations } from "@/server/properties/public-home";
import { parseSearchFilters } from "@/server/properties/public-helpers";
import { searchProperties } from "@/server/crm/lookups";
import { getDashboard } from "@/server/dashboard/queries";
import { captureLead } from "@/server/leads/capture";
import {
  addHotspot,
  addScene,
  createTour,
  deleteScene,
  deleteTour,
  publishTour,
  removeFloorPlan,
  setFloorPlan,
  unpublishTour,
  updateExternalTour,
  updateHotspot,
  updateScene,
  updateTourSettings,
} from "@/server/tours/service";
import { getDemoShowcase, getPublicPropertyMediaExtras, getTourEditor, loadSiteDemoShowcase, loadSitePropertyMediaExtras } from "@/server/tours/queries";
import { seedDemoTour } from "@/server/tours/demo-seed";
import { DEMO_PROPERTY_SLUG } from "@/server/tours/demo-constants";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { publishedProperty, setFlag, useMemoryStorage } from "../helpers/integrations";

/**
 * Tours virtuales contra Postgres real: servicios (permisos, validaciones, auditoría, eventos), consultas públicas,
 * constraints de la base, flag y propiedad demo aislada de todo lo comercial y público.
 */

const pano = (w = 2048, h = 1024) => sharp({ create: { width: w, height: h, channels: 3, background: "#8a8178" } }).jpeg().toBuffer().then((b) => new Uint8Array(b));
const expectApp = async (p: Promise<unknown>, code: string, msg?: RegExp) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (msg) expect((e as AppError).message).toMatch(msg);
};

let admin: StaffActor;
let agent: StaffActor;
let reader: StaffActor;
const prevBase = process.env.STORAGE_PUBLIC_BASE_URL;

beforeAll(async () => {
  const db = testDb();
  process.env.STORAGE_PUBLIC_BASE_URL = "https://cdn.llf-pruebas.com.ar";
  useMemoryStorage();
  admin = await createStaff(db, ["administrador"]);
  agent = await createStaff(db, ["agente"]);
  reader = await createStaff(db, ["solo_lectura"]);
});
afterAll(() => {
  setStorageForTests(undefined);
  process.env.STORAGE_PUBLIC_BASE_URL = prevBase;
});

describe("servicio de tours propios", () => {
  let propertyId: string;
  let code: number;
  let tourId: string;
  let living: string;
  let cocina: string;

  it("crear: permiso de multimedia; uno por propiedad", async () => {
    const db = testDb();
    const p = await publishedProperty(db, admin);
    propertyId = p.id;
    code = (await db.selectFrom("properties").select("code").where("id", "=", p.id).executeTakeFirstOrThrow()).code;
    await expectApp(createTour(db, reader, propertyId, { kind: "internal" }), "forbidden");
    tourId = (await createTour(db, agent, propertyId, { kind: "internal" })).id;
    await expectApp(createTour(db, admin, propertyId, { kind: "internal" }), "conflict", /ya tiene/);
    const audit = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", tourId).execute();
    expect(audit.map((a) => a.action)).toContain("VIRTUAL_TOUR_CREATED");
  });

  it("escenas: valida 2:1 y resolución, procesa panorámica + preview + miniatura en el storage existente", async () => {
    const db = testDb();
    const storage = useMemoryStorage();
    await expectApp(addScene(db, agent, tourId, await pano(2048, 1536), { name: "Living" }), "validation", /2:1/);
    await expectApp(addScene(db, agent, tourId, await pano(1024, 512), { name: "Living" }), "validation", /muy chica/);
    await expectApp(addScene(db, agent, tourId, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { name: "Living" }), "validation", /Formato/);
    expect(storage.objects.size).toBe(0);
    const s1 = await addScene(db, agent, tourId, await pano(), { name: "Living" });
    living = s1.sceneId;
    cocina = (await addScene(db, agent, tourId, await pano(), { name: "Cocina" })).sceneId;
    expect(storage.objects.size).toBe(6);
    const scene = await db.selectFrom("virtual_tour_scenes").selectAll().where("id", "=", living).executeTakeFirstOrThrow();
    expect([scene.slug, scene.width, scene.height]).toEqual(["living", 2048, 1024]);
    const files = await db.selectFrom("files").select(["width", "height", "visibility"]).where("id", "in", [scene.panorama_file_id!, scene.preview_file_id!, scene.thumbnail_file_id!]).execute();
    expect(files.map((f) => `${f.width}x${f.height}:${f.visibility}`).sort()).toEqual(["2048x1024:public", "512x256:public", "640x400:public"]);
    const tour = await db.selectFrom("virtual_tours").select("start_scene_id").where("id", "=", tourId).executeTakeFirstOrThrow();
    expect(tour.start_scene_id).toBe(living); // la primera escena queda como inicial
  });

  it("sin storage configurado: error claro y nada a medias", async () => {
    const db = testDb();
    setStorageForTests(undefined);
    const prevVercel = process.env.VERCEL;
    const prevDriver = process.env.STORAGE_DRIVER;
    process.env.VERCEL = "1";
    process.env.STORAGE_DRIVER = "local";
    try {
      const before = await db.selectFrom("virtual_tour_scenes").select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow();
      await expectApp(addScene(db, agent, tourId, await pano(), { name: "Baño" }), "unavailable", /almacenamiento/);
      await expectApp(setFloorPlan(db, agent, tourId, await pano()), "unavailable");
      const after = await db.selectFrom("virtual_tour_scenes").select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow();
      expect(after.n).toBe(before.n);
      const editor = await getTourEditor(db, agent, propertyId);
      expect(editor.storage.configured).toBe(false);
    } finally {
      process.env.VERCEL = prevVercel;
      process.env.STORAGE_DRIVER = prevDriver;
      useMemoryStorage();
    }
  });

  it("puntos: destino del mismo tour (servicio y trigger), ángulos normalizados", async () => {
    const db = testDb();
    await expectApp(addHotspot(db, agent, living, { kind: "scene", label: "Ir", yaw: 0, pitch: 0 }), "validation");
    await expectApp(addHotspot(db, agent, living, { kind: "scene", targetSceneId: living, label: "Ir", yaw: 0, pitch: 0 }), "validation", /misma escena/);
    const h = await addHotspot(db, agent, living, { kind: "scene", targetSceneId: cocina, label: "Ir a la cocina", yaw: 2 * Math.PI + 1, pitch: 3 });
    const row = await db.selectFrom("virtual_tour_hotspots").select(["yaw", "pitch"]).where("id", "=", h.id).executeTakeFirstOrThrow();
    expect(row.yaw).toBeCloseTo(1);
    expect(row.pitch).toBeCloseTo(Math.PI / 2);
    await updateHotspot(db, agent, h.id, { kind: "scene", targetSceneId: cocina, label: "Ir a la cocina", yaw: 1.2, pitch: -0.1 });
    await addHotspot(db, agent, cocina, { kind: "scene", targetSceneId: living, label: "Volver al living", yaw: -1.9, pitch: -0.1 });
    await addHotspot(db, agent, living, { kind: "info", label: "Hogar", content: "Hogar a leña", yaw: -0.5, pitch: 0 });

    // Otro tour: su escena no puede ser destino (el trigger lo frena aunque se saltee el servicio).
    const other = await publishedProperty(db, admin);
    const otherTour = await createTour(db, admin, other.id, { kind: "internal" });
    const foreign = await addScene(db, admin, otherTour.id, await pano(), { name: "Ajena" });
    await expectApp(addHotspot(db, agent, living, { kind: "scene", targetSceneId: foreign.sceneId, label: "X", yaw: 0, pitch: 0 }), "validation", /este tour/);
    await expect(
      db.insertInto("virtual_tour_hotspots").values({ scene_id: living, kind: "scene", target_scene_id: foreign.sceneId, label: "X", yaw: 0, pitch: 0 }).execute(),
    ).rejects.toThrow(/mismo tour/);
    await expect(sql`update virtual_tour_scenes set initial_yaw = 4 where id = ${living}`.execute(db)).rejects.toThrow(/check/);
    await expect(sql`update virtual_tour_scenes set width = 3000, height = 2048 where id = ${living}`.execute(db)).rejects.toThrow(/check/);
    await expect(sql`update virtual_tours set cover_url = 'javascript:alert(1)' where id = ${tourId}`.execute(db)).rejects.toThrow(/check/);
  });

  it("publicar: permiso de publicación, validaciones, auditoría y evento", async () => {
    const db = testDb();
    await expectApp(publishTour(db, agent, tourId), "forbidden");
    await updateScene(db, agent, cocina, { isPublished: false });
    await updateTourSettings(db, agent, tourId, { guidedSceneIds: [living, cocina] });
    await expectApp(publishTour(db, admin, tourId), "validation", /lleva a «Cocina», que está oculta/);
    await updateScene(db, agent, cocina, { isPublished: true });
    const r = await publishTour(db, admin, tourId);
    expect(r.propertyPublished).toBe(true);
    const t = await db.selectFrom("virtual_tours").select(["status", "published_at"]).where("id", "=", tourId).executeTakeFirstOrThrow();
    expect(t.status).toBe("published");
    expect(t.published_at).not.toBeNull();
    const ev = await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", tourId).execute();
    expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining(["virtual_tour.updated", "virtual_tour.published"]));
    const audit = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", tourId).execute();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["VIRTUAL_TOUR_SCENE_ADDED", "VIRTUAL_TOUR_HOTSPOT_ADDED", "VIRTUAL_TOUR_PUBLISHED"]));
    const automations = await db.selectFrom("automation_definitions").select("trigger_event").where("key", "like", "site_revalidate_tour_%").execute();
    expect(automations.map((a) => a.trigger_event).sort()).toEqual(["virtual_tour.published", "virtual_tour.unpublished", "virtual_tour.updated"]);
  });

  it("un tour publicado no queda incompleto por una edición", async () => {
    const db = testDb();
    await expectApp(updateScene(db, agent, living, { isPublished: false }), "conflict", /publicado/);
    await expectApp(updateTourSettings(db, agent, tourId, { startSceneId: null }), "conflict");
    // Vista inicial y posición en el plano sí se editan.
    await updateScene(db, agent, living, { initialYaw: -7, initialPitch: -0.2, plan: { x: 0.4, y: 0.6 } });
    const s = await db.selectFrom("virtual_tour_scenes").select(["initial_yaw", "plan_x"]).where("id", "=", living).executeTakeFirstOrThrow();
    expect(s.initial_yaw).toBeCloseTo(-7 + 2 * Math.PI);
    expect(s.plan_x).toBe(0.4);
  });

  it("consulta pública: solo publicado, escenas visibles y puntos con destino visible; flag apagado = sin tour", async () => {
    const db = testDb();
    const extras = await getPublicPropertyMediaExtras(db, code);
    expect(extras.tour?.kind).toBe("internal");
    if (extras.tour?.kind !== "internal") return;
    expect(extras.tour.scenes.map((s) => s.slug)).toEqual(["living", "cocina"]);
    expect(extras.tour.scenes[0]!.panoramaUrl).toMatch(/^https:\/\/cdn\.llf-pruebas\.com\.ar\/tours\//);
    expect(extras.tour.scenes[0]!.hotspots.map((h) => h.kind).sort()).toEqual(["info", "scene"]);
    expect(extras.tour.startSceneId).toBe(living);
    expect(JSON.stringify(extras)).not.toMatch(/storage_key|file_id|created_by/);

    // Una tercera escena oculta (tour en borrador) no sale, ni los puntos que llevan a ella.
    await unpublishTour(db, admin, tourId);
    const hidden = await addScene(db, agent, tourId, await pano(), { name: "Altillo" });
    await addHotspot(db, agent, living, { kind: "scene", targetSceneId: hidden.sceneId, label: "Al altillo", yaw: 2.5, pitch: 0 });
    await updateScene(db, agent, hidden.sceneId, { isPublished: false });
    expect((await getPublicPropertyMediaExtras(db, code)).tour).toBeNull(); // borrador
    const editor = await getTourEditor(db, agent, propertyId);
    expect(editor.tour?.blockers.join(" ")).toMatch(/Altillo/);
    await deleteScene(db, agent, hidden.sceneId); // borra también el punto que llevaba a ella
    await publishTour(db, admin, tourId);
    const again = await getPublicPropertyMediaExtras(db, code);
    expect(again.tour?.kind === "internal" && again.tour.scenes.every((s) => s.hotspots.every((h) => h.label !== "Al altillo"))).toBe(true);

    await setFlag(db, "virtual_tours", false);
    expect((await loadSitePropertyMediaExtras(db, code)).tour).toBeNull();
    expect((await loadSitePropertyMediaExtras(db, code)).flagEnabled).toBe(false);
    await setFlag(db, "virtual_tours", true);
    expect((await loadSitePropertyMediaExtras(db, code)).tour).not.toBeNull();

    // Propiedad despublicada: el tour no se ve aunque siga publicado.
    await unpublishProperty(db, admin, propertyId);
    expect((await getPublicPropertyMediaExtras(db, code)).tour).toBeNull();
    await publishProperty(db, admin, propertyId);
    expect((await getPublicPropertyMediaExtras(db, code)).tour).not.toBeNull();
  });

  it("plano raster: se guarda, reemplaza y borra", async () => {
    const db = testDb();
    await expectApp(setFloorPlan(db, reader, tourId, await pano()), "forbidden");
    const plan = await setFloorPlan(db, agent, tourId, await pano(1200, 800));
    expect(plan).toEqual({ width: 1200, height: 800 });
    await setFloorPlan(db, agent, tourId, await pano(1000, 700));
    const ex = await getPublicPropertyMediaExtras(db, code);
    expect(ex.tour?.kind === "internal" && ex.tour.floorPlan?.width).toBe(1000);
    await removeFloorPlan(db, agent, tourId);
    const deleted = await db.selectFrom("files").select(sql<number>`count(*)::int`.as("n")).where("storage_key", "like", `tours/${tourId}/plans/%`).where("deleted_at", "is not", null).executeTakeFirstOrThrow();
    expect(deleted.n).toBe(2);
  });

  it("borrar un tour publicado requiere permiso de publicación y deja los archivos dados de baja", async () => {
    const db = testDb();
    await expectApp(deleteTour(db, agent, tourId), "forbidden");
    await deleteTour(db, admin, tourId);
    expect(await db.selectFrom("virtual_tours").select("id").where("id", "=", tourId).executeTakeFirst()).toBeUndefined();
    const alive = await db.selectFrom("files").select(sql<number>`count(*)::int`.as("n")).where("storage_key", "like", `tours/${tourId}/%`).where("deleted_at", "is", null).executeTakeFirstOrThrow();
    expect(alive.n).toBe(0);
  });
});

describe("tours externos", () => {
  it("valida https y solo embebe hosts permitidos; URLs maliciosas rechazadas", async () => {
    const db = testDb();
    const p = await publishedProperty(db, admin);
    await expectApp(createTour(db, agent, p.id, { kind: "external", provider: "kuula", externalUrl: "javascript:alert(1)" }), "validation");
    await expectApp(createTour(db, agent, p.id, { kind: "external", provider: "kuula", externalUrl: "http://kuula.co/share/x" }), "validation");
    await expectApp(createTour(db, agent, p.id, { kind: "external", provider: "kuula", externalUrl: "https://kuula.co/share/x", embedUrl: "data:text/html,hola" }), "validation");
    const t = await createTour(db, agent, p.id, { kind: "external", provider: "kuula", externalUrl: "https://kuula.co.evil.com/share/x" });
    await publishTour(db, admin, t.id);
    const code = (await db.selectFrom("properties").select("code").where("id", "=", p.id).executeTakeFirstOrThrow()).code;
    let tour = (await getPublicPropertyMediaExtras(db, code)).tour;
    expect(tour?.kind === "external" && tour.display).toEqual({ mode: "link", href: "https://kuula.co.evil.com/share/x" });
    await updateExternalTour(db, agent, t.id, { provider: "kuula", externalUrl: "https://kuula.co/share/abc", embedUrl: "https://kuula.co/share/abc?fs=1" });
    tour = (await getPublicPropertyMediaExtras(db, code)).tour;
    expect(tour?.kind === "external" && tour.display).toEqual({ mode: "embed", src: "https://kuula.co/share/abc?fs=1", href: "https://kuula.co/share/abc" });
    await expect(sql`update virtual_tours set external_url = 'javascript:alert(1)' where id = ${t.id}`.execute(db)).rejects.toThrow(/check/);
    await expect(sql`update virtual_tours set kind = 'internal' where id = ${t.id}`.execute(db)).rejects.toThrow(/check/);
  });
});

describe("propiedad demo", () => {
  let demoId: string;
  let demoCode: number;

  it("el seed es idempotente y deja la demo con su tour publicado", async () => {
    const db = testDb();
    const dir = resolve(import.meta.dirname, "../../public/tours/demo/residencia");
    const first = await seedDemoTour(db, { dir, publicPrefix: "/tours/demo/residencia" });
    const second = await seedDemoTour(db, { dir, publicPrefix: "/tours/demo/residencia" });
    expect(second.propertyId).toBe(first.propertyId);
    expect(second.tourId).toBe(first.tourId);
    expect(second.created).toBe(false);
    expect([second.scenes, second.hotspots]).toEqual([9, 24]);
    demoId = first.propertyId;
    demoCode = first.code;
    const counts = await sql<{ scenes: number; hotspots: number }>`select (select count(*)::int from virtual_tour_scenes where tour_id = ${first.tourId}) as scenes,
      (select count(*)::int from virtual_tour_hotspots h join virtual_tour_scenes s on s.id = h.scene_id where s.tour_id = ${first.tourId}) as hotspots`.execute(db);
    expect(counts.rows[0]).toEqual({ scenes: 9, hotspots: 24 });
    const demo = await getDemoShowcase(db);
    expect(demo?.property.title).toBe("RESIDENCIA DEMO 360°");
    expect(demo?.tour.isDemo).toBe(true);
    expect(demo?.tour.scenes[0]?.panoramaUrl).toMatch(/^\/tours\/demo\/residencia\/entrada-360\.jpg\?v=[a-f0-9]{12}$/);
    expect(demo?.tour.guidedSceneIds).toHaveLength(8);
    await setFlag(db, "virtual_tours", false);
    expect(await loadSiteDemoShowcase(db)).toBeNull();
    await setFlag(db, "virtual_tours", true);
    expect(await loadSiteDemoShowcase(db)).not.toBeNull();
  });

  it("nunca se publica: servicio y constraint de la base", async () => {
    const db = testDb();
    const loc = await db.insertInto("locations").values({ kind: "locality", name: "Demo", slug: `demo-int-${Date.now()}` }).returning("id").executeTakeFirstOrThrow();
    await db.updateTable("properties").set({ status: "available", location_id: loc.id }).where("id", "=", demoId).execute();
    await db.insertInto("property_media").values({ property_id: demoId, kind: "image", source_url: "https://static1.adinco.net/demo/x.jpg", status: "verified", is_cover: true }).execute();
    await db.insertInto("property_operations").values({ property_id: demoId, operation: "sale", currency: "USD", amount: "1", price_hidden: false }).execute();
    await expectApp(publishProperty(db, admin, demoId), "validation", /DEMO/);
    await expect(sql`update properties set is_published = true, published_at = now() where id = ${demoId}`.execute(db)).rejects.toThrow(/properties_demo_never_published/);
    await expectApp(duplicateProperty(db, admin, demoId), "forbidden");
    await expectApp(createTour(db, admin, demoId, { kind: "internal" }), "forbidden");
    const demoTour = await db.selectFrom("virtual_tours").select("id").where("property_id", "=", demoId).executeTakeFirstOrThrow();
    await expectApp(unpublishTour(db, admin, demoTour.id), "forbidden", /manifiesto/);
    await expectApp(addScene(db, admin, demoTour.id, await pano(), { name: "Otra" }), "forbidden");
    const editor = await getTourEditor(db, admin, demoId);
    expect(editor.permissions).toEqual({ canEdit: false, canPublish: false });
  });

  it("no aparece en consultas públicas, conteos, sitemap, búsqueda, portales ni en lo comercial del CRM", async () => {
    const db = testDb();
    resetPublicLocationCache();
    const all = parseSearchFilters({});
    const search = await searchPublicProperties(db, all, 500);
    expect(search.items.some((i) => i.code === demoCode)).toBe(false);
    expect((await searchPublicProperties(db, parseSearchFilters({ q: "demo" }), 50)).items.some((i) => i.code === demoCode)).toBe(false);
    expect((await searchPublicProperties(db, parseSearchFilters({ q: String(demoCode) }), 50)).total).toBe(0);
    const facets = await getPublicFacets(db);
    expect(facets.total).toBe(search.total);
    expect((await listPublishedForSitemap(db)).some((p) => p.slug === DEMO_PROPERTY_SLUG)).toBe(false);
    expect((await getShowcaseProperties(db, 50)).some((p) => p.code === demoCode)).toBe(false);
    expect((await getRecentProperties(db, 50)).some((p) => p.code === demoCode)).toBe(false);
    const casasVenta = (await listListingCombinations(db)).find((c) => c.operation === "venta" && c.typeKey === "casa" && c.zoneSlug === null)?.count ?? 0;
    expect(casasVenta).toBe((await searchPublicProperties(db, parseSearchFilters({ operacion: "venta", tipo: "casa" }), 1)).total);
    expect((await getPublicPropertyBySlug(db, DEMO_PROPERTY_SLUG)).kind).toBe("not_found");
    expect((await getPublicPropertyMediaExtras(db, demoCode)).tour).toBeNull();
    expect(await db.selectFrom("property_publications").select("id").where("property_id", "=", demoId).executeTakeFirst()).toBeUndefined();

    // CRM: vínculos comerciales y tablero.
    expect((await searchProperties(db, admin, String(demoCode))).length).toBe(0);
    expect((await searchProperties(db, admin, "RESIDENCIA DEMO")).length).toBe(0);
    const dash = await getDashboard(db, admin, {});
    const totalReal = await db.selectFrom("properties").select(sql<number>`count(*)::int`.as("n")).where("deleted_at", "is", null).where("is_demo", "=", false).executeTakeFirstOrThrow();
    expect(dash.properties?.total).toBe(totalReal.n);

    // Un lead con el código de la demo (formulario manipulado) no queda vinculado a la propiedad ficticia.
    const lead = await captureLead(db, await testSystemActor(db), { name: "Prueba", email: `demo-${Date.now()}@test.local`, sourceKey: "web_property", propertyCode: demoCode });
    const row = await db.selectFrom("leads").select("property_id").where("id", "=", lead.leadId).executeTakeFirstOrThrow();
    expect(row.property_id).toBeNull();
  });
});
