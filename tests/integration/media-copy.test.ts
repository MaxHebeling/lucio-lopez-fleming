import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import "@/server/jobs/handlers";
import { MEDIA_COPY_MAX_ATTEMPTS, runMediaCopy } from "@/server/media/copy";
import { setStorageForTests } from "@/server/storage";
import type { StaffActor } from "@/server/auth/actor";
import { createStaff, testDb } from "../helpers/db";
import { mockHttp, publishedProperty, setFlag, useMemoryStorage } from "../helpers/integrations";

let photo: Buffer;

async function mediaRow(id: string) {
  return testDb().selectFrom("property_media").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("copia de multimedia a storage propio", () => {
  let admin: StaffActor;
  let propertyId: string;

  beforeAll(async () => {
    const db = testDb();
    admin = await createStaff(db, ["administrador"]);
    // JPEG 3000×1500 con orientación EXIF 6 (rotada 90°) y metadatos que deben desaparecer.
    photo = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: 120, g: 110, b: 100 } } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Camara de prueba" } } })
      .toBuffer();
    const p = await publishedProperty(db, admin, { media: [{ url: "https://static1.adinco.net/copy/cover.jpg", status: "verified", cover: true }] });
    propertyId = p.id;
  });
  afterAll(() => setStorageForTests(undefined));

  beforeEach(async () => {
    const db = testDb();
    await sql`delete from jobs`.execute(db);
    await sql`update property_media set last_checked_at = null`.execute(db);
    await setFlag(db, "media_copy", true);
  });

  it("flag media_copy apagado → no toca nada", async () => {
    const db = testDb();
    await setFlag(db, "media_copy", false);
    const http = mockHttp([]);
    try {
      expect(await runMediaCopy(db)).toMatchObject({ skippedFlag: true, claimed: 0 });
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it("descarga, rota según EXIF, quita metadatos, WebP ≤ 2400 px, crea files y marca stored; segunda corrida no repite", async () => {
    const db = testDb();
    const store = useMemoryStorage();
    const http = mockHttp([(c) => (c.url === "https://static1.adinco.net/copy/cover.jpg" ? new Response(new Uint8Array(photo), { status: 200, headers: { "content-type": "image/jpeg" } }) : undefined)]);
    try {
      const media = await db.selectFrom("property_media").select("id").where("property_id", "=", propertyId).executeTakeFirstOrThrow();
      const stats = await runMediaCopy(db);
      expect(stats).toMatchObject({ stored: 1, invalid: 0 });
      const row = await mediaRow(media.id);
      expect(row.status).toBe("stored");
      expect(row.file_id).not.toBeNull();
      expect(row.source_url).toBe("https://static1.adinco.net/copy/cover.jpg"); // no se borra el origen
      const file = await db.selectFrom("files").selectAll().where("id", "=", row.file_id!).executeTakeFirstOrThrow();
      expect(file).toMatchObject({ content_type: "image/webp", visibility: "public", width: 1200, height: 2400 });
      const obj = store.objects.get(`${file.bucket}/${file.storage_key}`)!;
      const meta = await sharp(obj.body).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(file.checksum_sha256).toHaveLength(64);

      await sql`update property_media set last_checked_at = null`.execute(db);
      expect((await runMediaCopy(db)).claimed).toBe(0);
      expect(http.calls).toHaveLength(1);
      expect(store.objects.size).toBe(1);
    } finally {
      http.restore();
    }
  });

  it("archivo inválido (HTML con extensión .jpg) → failed sin reintentos ni archivos huérfanos", async () => {
    const db = testDb();
    const store = useMemoryStorage();
    const bad = await db.insertInto("property_media").values({ property_id: propertyId, kind: "image", source_url: "https://static1.adinco.net/copy/falsa.jpg", status: "source_only", sort_order: 5 }).returning("id").executeTakeFirstOrThrow();
    const http = mockHttp([(c) => (c.url.endsWith("falsa.jpg") ? new Response("<html>no encontrado</html>", { status: 200, headers: { "content-type": "image/jpeg" } }) : undefined)]);
    try {
      const stats = await runMediaCopy(db);
      expect(stats.invalid).toBe(1);
      const row = await mediaRow(bad.id);
      expect(row.status).toBe("failed");
      expect(row.file_id).toBeNull();
      expect(row.last_error).toMatch(/no es una imagen/);
      expect(store.objects.size).toBe(0);
      await sql`update property_media set last_checked_at = null`.execute(db);
      expect((await runMediaCopy(db)).claimed).toBe(0);
    } finally {
      http.restore();
    }
  });

  it("origen caído → reintenta hasta el máximo y recién ahí marca failed; archivo demasiado grande → failed", async () => {
    const db = testDb();
    useMemoryStorage();
    const flaky = await db.insertInto("property_media").values({ property_id: propertyId, kind: "image", source_url: "https://static1.adinco.net/copy/caida.jpg", status: "verified", sort_order: 6 }).returning("id").executeTakeFirstOrThrow();
    const huge = await db.insertInto("property_media").values({ property_id: propertyId, kind: "image", source_url: "https://static1.adinco.net/copy/enorme.jpg", status: "verified", sort_order: 7 }).returning("id").executeTakeFirstOrThrow();
    const http = mockHttp([
      (c) => (c.url.endsWith("caida.jpg") ? new Response("error", { status: 503 }) : undefined),
      (c) => (c.url.endsWith("enorme.jpg") ? new Response("x", { status: 200, headers: { "content-length": String(200 * 1024 * 1024) } }) : undefined),
    ]);
    try {
      for (let i = 0; i < MEDIA_COPY_MAX_ATTEMPTS; i++) {
        await runMediaCopy(db);
        await sql`update property_media set last_checked_at = null`.execute(db);
        if (i < MEDIA_COPY_MAX_ATTEMPTS - 1) expect((await mediaRow(flaky.id)).status).toBe("verified");
      }
      const row = await mediaRow(flaky.id);
      expect(row).toMatchObject({ status: "failed", copy_attempts: MEDIA_COPY_MAX_ATTEMPTS, file_id: null });
      const big = await mediaRow(huge.id);
      expect(big.status).toBe("failed");
      expect(big.last_error).toMatch(/demasiado grande/);
    } finally {
      http.restore();
    }
  });
});
