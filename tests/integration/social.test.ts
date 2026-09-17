import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { runJobs } from "@/server/jobs/runner";
import { PermanentJobError } from "@/server/jobs/registry";
import { RetryableError } from "@/server/resilience";
import { approvePost, rejectPost, schedulePost, setPostAssets, unschedulePost, updatePostCaption } from "@/server/marketing/service";
import { dispatchDueSocialPosts, publishSocialPost } from "@/server/marketing/publish";
import { setStorageForTests } from "@/server/storage";
import { utcToZonedLocal } from "@/server/marketing/time";
import type { StaffActor } from "@/server/auth/actor";
import { createStaff, testDb } from "../helpers/db";
import { json, loadIntegrationReferenceData, mockHttp, publishedProperty, setFlag, useMemoryStorage } from "../helpers/integrations";

const META_ENV = { META_PAGE_ID: "1122334455", META_PAGE_ACCESS_TOKEN: "EAAG-page-token", META_IG_USER_ID: "17841400000000000", APP_URL: "https://www.luciolopezfleming.com.ar" };
const saved: Record<string, string | undefined> = {};
let jpeg: Buffer;
const soon = () => utcToZonedLocal(new Date(Date.now() + 30 * 86_400_000));

async function drain() {
  const db = testDb();
  for (let i = 0; i < 2; i++) {
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 300_000 });
  }
}

/** Simula un proceso que murió hace rato: el trigger de updated_at se desactiva solo dentro de esta transacción. */
async function staleUpdate(q: ReturnType<typeof sql>) {
  await testDb()
    .transaction()
    .execute(async (trx) => {
      await sql`alter table social_posts disable trigger trg_social_posts_updated`.execute(trx);
      await q.execute(trx);
      await sql`alter table social_posts enable trigger trg_social_posts_updated`.execute(trx);
    });
}

async function postsFor(propertyId: string) {
  return testDb().selectFrom("social_posts").selectAll().where("property_id", "=", propertyId).orderBy("channel").execute();
}

describe("motor de contenido y redes", () => {
  let admin: StaffActor;
  let mkt: StaffActor;

  beforeAll(async () => {
    const db = testDb();
    await loadIntegrationReferenceData(db);
    admin = await createStaff(db, ["administrador"]);
    mkt = await createStaff(db, ["marketing"]);
    jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 180, g: 90, b: 60 } } }).jpeg().toBuffer();
  });
  afterAll(() => setStorageForTests(undefined));

  beforeEach(async () => {
    for (const [k, v] of Object.entries(META_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const db = testDb();
    useMemoryStorage();
    await sql`delete from jobs`.execute(db);
    await sql`update domain_events set dispatched_at = now() where dispatched_at is null`.execute(db);
    await sql`update integrations set circuit_open_until = null, consecutive_failures = 0`.execute(db);
    await setFlag(db, "social_drafts", true);
    await setFlag(db, "social_publishing", false);
    await setFlag(db, "portal_sync", false);
  });
  afterEach(() => {
    for (const k of Object.keys(META_ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("property.published → un borrador por canal con copy real y fotos verificadas; reejecutar no duplica", async () => {
    const db = testDb();
    const p = await publishedProperty(db, admin, {
      media: [
        { url: "https://static1.adinco.net/x/cover.jpg", status: "verified", cover: true },
        { url: "https://static1.adinco.net/x/2.jpg", status: "verified" },
        { url: "https://static1.adinco.net/x/sin-verificar.jpg", status: "source_only" },
      ],
    });
    await drain();
    // Simula reejecución de la automatización para el mismo evento
    const ev = await db.selectFrom("domain_events").select("id").where("aggregate_id", "=", p.id).where("event_type", "=", "property.published").executeTakeFirstOrThrow();
    const auto = await db.selectFrom("automation_definitions").select("id").where("key", "=", "property_social_drafts").executeTakeFirstOrThrow();
    await sql`update automation_runs set status = 'failed' where automation_id = ${auto.id} and trigger_event_id = ${ev.id}`.execute(db);
    await db.insertInto("jobs").values({ type: "automation.run", payload: JSON.stringify({ automationId: auto.id, eventId: ev.id }) }).execute();
    await runJobs(db, { budgetMs: 300_000 });

    const posts = await postsFor(p.id);
    expect(posts.map((x) => x.channel)).toEqual(["facebook", "instagram"]);
    for (const post of posts) {
      expect(post).toMatchObject({ status: "draft", generated_by: "template", approved_by: null, source_event_id: ev.id });
      expect(post.caption).toContain("Casa en venta · Salta");
      expect(post.caption).toContain("3 dormitorios");
      expect(post.caption).toContain("USD 230.000");
      expect(post.caption).toContain("https://www.luciolopezfleming.com.ar/propiedades/");
      expect(post.caption).not.toMatch(/\{\{/);
      const assets = await db.selectFrom("social_assets").select("sort_order").where("social_post_id", "=", post.id).execute();
      expect(assets).toHaveLength(2); // la foto sin verificar no entra
    }
    const note = await db.selectFrom("notifications").select("kind").where("user_id", "=", mkt.userId).where("kind", "=", "social_drafts").execute();
    expect(note).toHaveLength(1);
  });

  it("flag social_drafts apagado → no hay borradores", async () => {
    const db = testDb();
    await setFlag(db, "social_drafts", false);
    const p = await publishedProperty(db, admin);
    await drain();
    expect(await postsFor(p.id)).toHaveLength(0);
  });

  it("CHECK de la base: no se puede aprobar, programar ni publicar sin aprobación humana", async () => {
    const db = testDb();
    const p = await publishedProperty(db, admin);
    const post = await db.insertInto("social_posts").values({ property_id: p.id, channel: "instagram", caption: "Texto de prueba suficiente", generated_by: "human" }).returning("id").executeTakeFirstOrThrow();
    for (const status of ["approved", "scheduled", "publishing", "published"]) {
      await expect(sql`update social_posts set status = ${status} where id = ${post.id}`.execute(db)).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("flujo humano: editar, fotos, aprobar, programar (hora de Salta), rechazar; permisos y auditoría", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const readonly = await createStaff(db, ["solo_lectura"]);
    const p = await publishedProperty(db, admin);
    await drain();
    const [fb] = await postsFor(p.id);
    const media = await db.selectFrom("property_media").select("id").where("property_id", "=", p.id).orderBy("sort_order").execute();

    await expect(approvePost(db, agent, { postId: fb!.id })).rejects.toThrow(/permiso/);
    await expect(updatePostCaption(db, readonly, { postId: fb!.id, caption: "Otro texto largo" })).rejects.toThrow(/permiso/);
    await expect(schedulePost(db, mkt, { postId: fb!.id, localDateTime: soon() })).rejects.toThrow(/aprobar/);

    await updatePostCaption(db, mkt, { postId: fb!.id, caption: "Casa en venta en Tres Cerritos. Código 1. Más info en la web." });
    await setPostAssets(db, mkt, { postId: fb!.id, mediaIds: [media[1]!.id, media[0]!.id] });
    await approvePost(db, mkt, { postId: fb!.id });

    const now = new Date("2026-09-16T12:00:00Z");
    await expect(schedulePost(db, mkt, { postId: fb!.id, localDateTime: "2026-09-16T08:00" }, now)).rejects.toThrow(/futura/);
    const s = await schedulePost(db, mkt, { postId: fb!.id, localDateTime: "2026-09-20T10:30" }, now);
    expect(s.scheduledAt.toISOString()).toBe("2026-09-20T13:30:00.000Z");
    const job = await db.selectFrom("jobs").select(["run_at", "type"]).where("type", "=", "social.publish").executeTakeFirstOrThrow();
    expect(job.run_at.toISOString()).toBe("2026-09-20T13:30:00.000Z");

    // Editar un post programado lo vuelve a borrador (hay que reaprobar)
    await updatePostCaption(db, mkt, { postId: fb!.id, caption: "Casa en venta en Tres Cerritos, con jardín. Código 1." });
    const edited = await db.selectFrom("social_posts").selectAll().where("id", "=", fb!.id).executeTakeFirstOrThrow();
    expect(edited).toMatchObject({ status: "draft", approved_by: null, scheduled_at: null, generated_by: "human" });

    await approvePost(db, mkt, { postId: fb!.id });
    await schedulePost(db, mkt, { postId: fb!.id, localDateTime: "2026-09-21T10:30" }, now);
    await unschedulePost(db, mkt, { postId: fb!.id });
    await rejectPost(db, mkt, { postId: fb!.id, reason: "Esperar fotos nuevas" });
    const rejected = await db.selectFrom("social_posts").selectAll().where("id", "=", fb!.id).executeTakeFirstOrThrow();
    expect(rejected).toMatchObject({ status: "rejected", rejected_reason: "Esperar fotos nuevas", approved_by: null });

    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", fb!.id).orderBy("id").execute()).map((a) => a.action);
    expect(actions).toEqual([
      "SOCIAL_POST_EDITED",
      "SOCIAL_POST_ASSETS_SET",
      "SOCIAL_POST_APPROVED",
      "SOCIAL_POST_SCHEDULED",
      "SOCIAL_POST_EDITED",
      "SOCIAL_POST_APPROVED",
      "SOCIAL_POST_SCHEDULED",
      "SOCIAL_POST_UNSCHEDULED",
      "SOCIAL_POST_REJECTED",
    ]);
  });

  async function approvedAndDue(channel: "facebook" | "instagram") {
    const db = testDb();
    const p = await publishedProperty(db, admin);
    await drain();
    const post = (await postsFor(p.id)).find((x) => x.channel === channel)!;
    await approvePost(db, mkt, { postId: post.id });
    await schedulePost(db, mkt, { postId: post.id, localDateTime: soon() });
    await sql`update social_posts set scheduled_at = now() - interval '1 minute' where id = ${post.id}`.execute(db);
    await sql`delete from jobs where type = 'social.publish'`.execute(db);
    return post.id;
  }

  const imageRoute = (c: { url: string }) => (c.url.startsWith("https://static1.adinco.net/") ? new Response(new Uint8Array(jpeg), { status: 200, headers: { "content-type": "image/jpeg" } }) : undefined);

  it("Facebook multi-foto: publica una vez; con external_post_id no republica", async () => {
    const db = testDb();
    await setFlag(db, "social_publishing", true);
    const postId = await approvedAndDue("facebook");
    let photo = 0;
    const http = mockHttp([
      imageRoute,
      (c) => (c.url === `https://graph.facebook.com/v26.0/${META_ENV.META_PAGE_ID}/photos` ? json({ id: `photo-${++photo}` }) : undefined),
      (c) => (c.url === `https://graph.facebook.com/v26.0/${META_ENV.META_PAGE_ID}/feed` ? json({ id: "1122334455_998877" }) : undefined),
    ]);
    try {
      expect((await dispatchDueSocialPosts(db)).queued).toBe(1);
      await runJobs(db, { budgetMs: 300_000 });
      const post = await db.selectFrom("social_posts").selectAll().where("id", "=", postId).executeTakeFirstOrThrow();
      expect(post).toMatchObject({ status: "published", external_post_id: "1122334455_998877" });
      const photos = http.calls.filter((c) => c.url.endsWith("/photos"));
      expect(photos).toHaveLength(2);
      expect(photos.every((c) => c.body.includes("published=false"))).toBe(true);
      expect(photos[0]!.headers.authorization).toBe("Bearer EAAG-page-token");
      expect(photos.some((c) => c.url.includes("EAAG"))).toBe(false);
      const feed = new URLSearchParams(http.calls.find((c) => c.url.endsWith("/feed"))!.body);
      expect(feed.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "photo-1" }));

      const before = http.calls.length;
      expect((await publishSocialPost(db, postId)).status).toBe("already_published");
      expect(http.calls.length).toBe(before);
    } finally {
      http.restore();
    }
  });

  it("Instagram: sin URL pública de storage y origen no JPEG-compatible → failed con error claro", async () => {
    const db = testDb();
    await setFlag(db, "social_publishing", true);
    useMemoryStorage({ publicBase: null });
    const tall = await sharp({ create: { width: 400, height: 1200, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    const postId = await approvedAndDue("instagram");
    const http = mockHttp([(c) => (c.url.startsWith("https://static1.adinco.net/") ? new Response(new Uint8Array(tall), { status: 200 }) : undefined)]);
    try {
      await expect(publishSocialPost(db, postId)).rejects.toBeInstanceOf(PermanentJobError);
      const post = await db.selectFrom("social_posts").selectAll().where("id", "=", postId).executeTakeFirstOrThrow();
      expect(post.status).toBe("failed");
      expect(post.last_error).toMatch(/URL pública/);
      expect(http.calls.some((c) => c.url.includes("graph.facebook.com"))).toBe(false);
    } finally {
      http.restore();
    }
  });

  it("Instagram carrusel: contenedores → media_publish; derivado JPEG en storage; corte tras el contenedor no duplica", async () => {
    const db = testDb();
    await setFlag(db, "social_publishing", true);
    const storageMem = useMemoryStorage();
    const square = await sharp({ create: { width: 400, height: 1200, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const postId = await approvedAndDue("instagram");
    let child = 0;
    let publishCalls = 0;
    const ig = `https://graph.facebook.com/v26.0/${META_ENV.META_IG_USER_ID}`;
    const http = mockHttp([
      (c) => (c.url.startsWith("https://static1.adinco.net/") ? new Response(new Uint8Array(square), { status: 200 }) : undefined),
      (c) => {
        if (c.url !== `${ig}/media`) return undefined;
        const body = new URLSearchParams(c.body);
        return json({ id: body.get("media_type") === "CAROUSEL" ? "container-carousel" : `container-child-${++child}` });
      },
      (c) => (c.url.includes("fields=status_code") ? json({ status_code: "FINISHED" }) : undefined),
      (c) => {
        if (c.url !== `${ig}/media_publish`) return undefined;
        publishCalls++;
        return json({ id: "17900000000000001" });
      },
    ]);
    try {
      const r = await publishSocialPost(db, postId, { sleep: async () => {} });
      expect(r).toMatchObject({ status: "published", externalPostId: "17900000000000001" });
      const children = http.calls.filter((c) => c.url === `${ig}/media` && c.body.includes("is_carousel_item=true"));
      expect(children).toHaveLength(2);
      const imageUrl = new URLSearchParams(children[0]!.body).get("image_url")!;
      expect(imageUrl).toMatch(/^https:\/\/cdn\.llf-pruebas\.com\.ar\/social\/.+\.jpg$/);
      // PNG vertical 1:3 → JPEG con márgenes dentro de 4:5
      const stored = [...storageMem.objects.values()].find((o) => o.contentType === "image/jpeg")!;
      const meta = await sharp(stored.body).metadata();
      expect(meta.format).toBe("jpeg");
      expect(meta.width! / meta.height!).toBeGreaterThanOrEqual(0.8);
      expect((await db.selectFrom("social_posts").select("external_container_id").where("id", "=", postId).executeTakeFirstOrThrow()).external_container_id).toBe("container-carousel");

      // Simula corte: quedó "publishing" sin external_post_id pero con contenedor ya publicado en Instagram
      await staleUpdate(sql`update social_posts set status = 'publishing', external_post_id = null, updated_at = now() - interval '1 hour' where id = ${postId}`);
      const recover = mockHttp([(c) => (c.url.includes("container-carousel?fields=status_code") ? json({ status_code: "PUBLISHED" }) : undefined)]);
      try {
        const again = await publishSocialPost(db, postId);
        expect(again.status).toBe("published");
        expect(recover.calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
      } finally {
        recover.restore();
      }
      expect(publishCalls).toBe(1);
    } finally {
      http.restore();
    }
  });

  it("Facebook interrumpido a mitad → failed pidiendo verificación (no republica a ciegas); sin credenciales sigue programado", async () => {
    const db = testDb();
    await setFlag(db, "social_publishing", true);
    const postId = await approvedAndDue("facebook");
    await staleUpdate(sql`update social_posts set status = 'publishing', updated_at = now() - interval '1 hour' where id = ${postId}`);
    const http = mockHttp([]);
    try {
      expect((await publishSocialPost(db, postId)).status).toBe("failed");
      expect((await db.selectFrom("social_posts").select("last_error").where("id", "=", postId).executeTakeFirstOrThrow()).last_error).toMatch(/verificá en Facebook/);

      const other = await approvedAndDue("facebook");
      delete process.env.META_PAGE_ACCESS_TOKEN;
      expect((await publishSocialPost(db, other)).status).toBe("awaiting_credentials");
      const row = await db.selectFrom("social_posts").select(["status", "last_error"]).where("id", "=", other).executeTakeFirstOrThrow();
      expect(row.status).toBe("scheduled");
      expect(row.last_error).toMatch(/META_PAGE_ACCESS_TOKEN/);
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  describe("resultados inciertos y contenedores (sin publicar dos veces)", () => {
    it("Facebook: 5xx/timeout en el POST que publica → una sola llamada, failed 'verificá en Facebook', sin reintento", async () => {
      const db = testDb();
      await setFlag(db, "social_publishing", true);
      const postId = await approvedAndDue("facebook");
      let photo = 0;
      const http = mockHttp([
        imageRoute,
        (c) => (c.url === `https://graph.facebook.com/v26.0/${META_ENV.META_PAGE_ID}/photos` ? json({ id: `photo-${++photo}` }) : undefined),
        (c) => (c.url === `https://graph.facebook.com/v26.0/${META_ENV.META_PAGE_ID}/feed` ? json({ error: { message: "An unknown error occurred", code: 1 } }, 500) : undefined),
      ]);
      try {
        const r = await publishSocialPost(db, postId);
        expect(r.status).toBe("failed");
        expect(http.calls.filter((c) => c.url.endsWith("/feed"))).toHaveLength(1);
        const post = await db.selectFrom("social_posts").select(["status", "last_error", "external_post_id"]).where("id", "=", postId).executeTakeFirstOrThrow();
        expect(post).toMatchObject({ status: "failed", external_post_id: null });
        expect(post.last_error).toMatch(/Resultado incierto.*Verificá en Facebook/);
        // Ni el sweep horario ni un reintento del job lo vuelven a publicar
        await dispatchDueSocialPosts(db);
        expect(await db.selectFrom("jobs").select("id").where("type", "=", "social.publish").where(sql<string>`payload->>'postId'`, "=", postId).execute()).toHaveLength(0);
        expect((await publishSocialPost(db, postId)).status).toBe("skipped");
        expect(http.calls.filter((c) => c.url.endsWith("/feed"))).toHaveLength(1);
      } finally {
        http.restore();
      }
    });

    it("Instagram: falla transitoria después de crear el contenedor → se guarda y el reintento lo consulta en vez de crear otro", async () => {
      const db = testDb();
      await setFlag(db, "social_publishing", true);
      const postId = await approvedAndDue("instagram");
      const ig = `https://graph.facebook.com/v26.0/${META_ENV.META_IG_USER_ID}`;
      let statusCalls = 0;
      let mediaPosts = 0;
      let published = 0;
      const state = { statusDown: true, containerStatus: "FINISHED" };
      const http = mockHttp([
        imageRoute,
        (c) => {
          if (c.url !== `${ig}/media`) return undefined;
          mediaPosts++;
          const body = new URLSearchParams(c.body);
          return json({ id: body.get("media_type") === "CAROUSEL" ? "cont-carousel" : `cont-child-${mediaPosts}` });
        },
        (c) => {
          if (!c.url.includes("fields=status_code")) return undefined;
          statusCalls++;
          if (c.url.includes("cont-carousel") && state.statusDown) return json({ error: { message: "Service temporarily unavailable", code: 2 } }, 503);
          return json({ status_code: c.url.includes("cont-carousel") ? state.containerStatus : "FINISHED" });
        },
        (c) => {
          if (c.url !== `${ig}/media_publish`) return undefined;
          published++;
          return json({ id: "17900000000000077" });
        },
      ]);
      try {
        await expect(publishSocialPost(db, postId, { sleep: async () => {} })).rejects.toBeInstanceOf(RetryableError);
        let post = await db.selectFrom("social_posts").select(["status", "external_container_id"]).where("id", "=", postId).executeTakeFirstOrThrow();
        expect(post).toEqual({ status: "scheduled", external_container_id: "cont-carousel" });
        const createdBefore = mediaPosts;

        // Meta vuelve y el contenedor ya figura publicado (p. ej. lo publicó un proceso anterior): no se republica
        state.statusDown = false;
        state.containerStatus = "PUBLISHED";
        const again = await publishSocialPost(db, postId, { sleep: async () => {} });
        expect(again.status).toBe("published");
        expect(mediaPosts).toBe(createdBefore);
        expect(published).toBe(0);
        post = await db.selectFrom("social_posts").select(["status", "external_container_id"]).where("id", "=", postId).executeTakeFirstOrThrow();
        expect(post.status).toBe("published");
        expect(statusCalls).toBeGreaterThan(0);
      } finally {
        http.restore();
      }
    });

    it("Instagram: timeout/5xx en media_publish → una sola llamada; si el contenedor no figura publicado, failed 'verificá en Instagram'", async () => {
      const db = testDb();
      await setFlag(db, "social_publishing", true);
      await sql`update integrations set circuit_open_until = null, consecutive_failures = 0`.execute(db);
      const postId = await approvedAndDue("instagram");
      const ig = `https://graph.facebook.com/v26.0/${META_ENV.META_IG_USER_ID}`;
      let published = 0;
      const http = mockHttp([
        imageRoute,
        (c) => (c.url === `${ig}/media` ? json({ id: new URLSearchParams(c.body).get("media_type") === "CAROUSEL" ? "cont-c2" : `cont-x-${Math.random()}` }) : undefined),
        (c) => (c.url.includes("fields=status_code") ? json({ status_code: "FINISHED" }) : undefined),
        (c) => {
          if (c.url !== `${ig}/media_publish`) return undefined;
          published++;
          return json({ error: { message: "Please retry your request later", code: 2 } }, 500);
        },
      ]);
      try {
        const r = await publishSocialPost(db, postId, { sleep: async () => {} });
        expect(r.status).toBe("failed");
        expect(published).toBe(1);
        const post = await db.selectFrom("social_posts").select(["status", "last_error", "external_container_id"]).where("id", "=", postId).executeTakeFirstOrThrow();
        expect(post.status).toBe("failed");
        expect(post.external_container_id).toBe("cont-c2");
        expect(post.last_error).toMatch(/Verificá en Instagram/);
      } finally {
        http.restore();
      }
    });
  });
});
