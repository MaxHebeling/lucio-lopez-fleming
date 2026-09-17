import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { purgeSiteEvents, recordSiteEvent, SITE_EVENTS_RATE } from "@/server/site/events";
import { seedDemoTour } from "@/server/tours/demo-seed";
import { createTour } from "@/server/tours/service";
import { createStaff, testDb } from "../helpers/db";
import { publishedProperty, setFlag } from "../helpers/integrations";

/** Analítica first-party: allowlist, validación, rate limit, sin PII, flag y retención. */

let tourId: string;
let propertyId: string;
const session = () => `s${randomUUID().replace(/-/g, "")}`;
const ctx = { ip: "203.0.113.7", privacySignal: false };

beforeAll(async () => {
  const db = testDb();
  const r = await seedDemoTour(db, { dir: resolve(import.meta.dirname, "../../public/tours/demo/residencia"), publicPrefix: "/tours/demo/residencia" });
  tourId = r.tourId;
  propertyId = r.propertyId;
});

describe("site_events", () => {
  it("la tabla no tiene columnas de IP, user agent ni datos personales", async () => {
    const db = testDb();
    const cols = await sql<{ column_name: string }>`select column_name from information_schema.columns where table_name = 'site_events' order by ordinal_position`.execute(db);
    expect(cols.rows.map((c) => c.column_name)).toEqual(["id", "name", "session_key", "property_id", "tour_id", "scene_id", "scene_slug", "hotspot_id", "props", "occurred_at"]);
  });

  it("guarda eventos permitidos de un tour visible, resolviendo escena y propiedad en el servidor", async () => {
    const db = testDb();
    const key = session();
    const hotspot = await db
      .selectFrom("virtual_tour_hotspots as h")
      .innerJoin("virtual_tour_scenes as s", "s.id", "h.scene_id")
      .select(["h.id"])
      .where("s.tour_id", "=", tourId)
      .where("s.slug", "=", "living")
      .executeTakeFirstOrThrow();
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId, props: { entry: "cover", email: "x@y.com" } }, ctx)).toEqual({ status: "stored" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_scene_viewed", sessionKey: key, tourId, sceneSlug: "living", props: { source: "hotspot" } }, ctx)).toEqual({ status: "stored" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_hotspot_clicked", sessionKey: key, tourId, sceneSlug: "living", hotspotId: hotspot.id, props: { kind: "scene" } }, ctx)).toEqual({ status: "stored" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_closed", sessionKey: key, tourId, props: { durationMs: 42_000, scenesViewed: 3 } }, ctx)).toEqual({ status: "stored" });
    const rows = await db.selectFrom("site_events").select(["name", "property_id", "scene_slug", "scene_id", "hotspot_id", "props"]).where("session_key", "=", key).orderBy("id").execute();
    expect(rows.map((r) => r.name)).toEqual(["virtual_tour_opened", "virtual_tour_scene_viewed", "virtual_tour_hotspot_clicked", "virtual_tour_closed"]);
    expect(rows.every((r) => r.property_id === propertyId)).toBe(true);
    expect(rows[0]!.props).toEqual({ entry: "cover" }); // la clave desconocida (email) se descartó
    expect(rows[1]!.scene_id).not.toBeNull();
    expect(rows[2]!.hotspot_id).toBe(hotspot.id);
    expect(rows[3]!.props).toEqual({ durationMs: 42_000, scenesViewed: 3 });
  });

  it("descarta nombres fuera de la allowlist, datos inválidos, tours inexistentes o en borrador y escenas ajenas", async () => {
    const db = testDb();
    const key = session();
    expect(await recordSiteEvent(db, { name: "page_view", sessionKey: key, tourId }, ctx)).toEqual({ status: "ignored", reason: "invalid" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: "corta", tourId }, ctx)).toEqual({ status: "ignored", reason: "invalid" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId: randomUUID() }, ctx)).toEqual({ status: "ignored", reason: "unknown_tour" });
    const admin = await createStaff(db, ["administrador"]);
    const p = await publishedProperty(db, admin);
    const draft = await createTour(db, admin, p.id, { kind: "internal" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId: draft.id }, ctx)).toEqual({ status: "ignored", reason: "unknown_tour" });
    expect(await recordSiteEvent(db, { name: "virtual_tour_closed", sessionKey: key, tourId, sceneSlug: "no-existe", props: { durationMs: -5 } }, ctx)).toEqual({ status: "stored" });
    const last = await db.selectFrom("site_events").select(["scene_slug", "scene_id", "props"]).where("session_key", "=", key).executeTakeFirstOrThrow();
    expect(last).toEqual({ scene_slug: null, scene_id: null, props: {} });
  });

  it("respeta Do Not Track / GPC y el flag", async () => {
    const db = testDb();
    const key = session();
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId }, { ip: ctx.ip, privacySignal: true })).toEqual({ status: "ignored", reason: "dnt" });
    await setFlag(db, "virtual_tours", false);
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId }, ctx)).toEqual({ status: "ignored", reason: "disabled" });
    await setFlag(db, "virtual_tours", true);
    expect(await db.selectFrom("site_events").select("id").where("session_key", "=", key).executeTakeFirst()).toBeUndefined();
  });

  it("rate limit por IP (clave con hash, sin la IP en claro) y por sesión", async () => {
    const db = testDb();
    const ip = "198.51.100.23";
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: session(), tourId }, { ip, privacySignal: false })).toEqual({ status: "stored" });
    const buckets = await db.selectFrom("rate_limit_buckets").select(["key", "count"]).where("key", "like", "site-events:ip:%").execute();
    expect(buckets.some((b) => b.key.includes(ip))).toBe(false);
    await db.updateTable("rate_limit_buckets").set({ count: SITE_EVENTS_RATE.perIp }).where("key", "like", "site-events:ip:%").execute();
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: session(), tourId }, { ip, privacySignal: false })).toEqual({ status: "rate_limited" });
    await db.deleteFrom("rate_limit_buckets").where("key", "like", "site-events:ip:%").execute();

    const key = session();
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId }, ctx)).toEqual({ status: "stored" });
    await db.updateTable("rate_limit_buckets").set({ count: SITE_EVENTS_RATE.perSession }).where("key", "=", `site-events:session:${key}`).execute();
    expect(await recordSiteEvent(db, { name: "virtual_tour_opened", sessionKey: key, tourId }, ctx)).toEqual({ status: "rate_limited" });
  });

  it("retención: borra lo anterior a 13 meses", async () => {
    const db = testDb();
    const key = session();
    await db.insertInto("site_events").values([
      { name: "virtual_tour_opened", session_key: key, tour_id: tourId, occurred_at: sql`now() - interval '14 months'` as never },
      { name: "virtual_tour_opened", session_key: key, tour_id: tourId, occurred_at: sql`now() - interval '12 months'` as never },
    ]).execute();
    const r = await purgeSiteEvents(db);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    const left = await db.selectFrom("site_events").select(sql<number>`count(*)::int`.as("n")).where("session_key", "=", key).executeTakeFirstOrThrow();
    expect(left.n).toBe(1);
  });

  it("las consultas documentadas en docs/VIRTUAL_TOURS.md corren", async () => {
    const db = testDb();
    const q = await sql<{ opened: number; avg_ms: number | null; reached_garden: number; visit_clicks: number }>`
      select
        (select count(distinct session_key)::int from site_events where tour_id = ${tourId} and name = 'virtual_tour_opened') as opened,
        (select avg((props->>'durationMs')::bigint)::float from site_events where tour_id = ${tourId} and name = 'virtual_tour_closed' and props ? 'durationMs') as avg_ms,
        (select count(distinct session_key)::int from site_events where tour_id = ${tourId} and name = 'virtual_tour_scene_viewed' and scene_slug in ('galeria', 'piscina')) as reached_garden,
        (select count(*)::int from site_events where tour_id = ${tourId} and name = 'virtual_tour_cta_clicked' and props->>'cta' = 'visit') as visit_clicks`.execute(db);
    await sql`select percentile_cont(0.5) within group (order by (props->>'durationMs')::bigint) / 1000 as mediana_s, avg((props->>'durationMs')::bigint) / 1000 as promedio_s
      from site_events where tour_id = ${tourId} and name = 'virtual_tour_closed' and props ? 'durationMs'`.execute(db);
    const top = await sql<{ scene_slug: string; sesiones: number }>`select scene_slug, count(distinct session_key)::int as sesiones
      from site_events where tour_id = ${tourId} and name = 'virtual_tour_scene_viewed' group by scene_slug order by sesiones desc`.execute(db);
    expect(top.rows[0]?.scene_slug).toBe("living");
    expect(q.rows[0]!.opened).toBeGreaterThan(0);
  });
});
