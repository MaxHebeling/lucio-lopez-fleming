/**
 * Job `media.copy` (tarea horaria + feature flag `media_copy`): copia fotos que hoy se sirven desde su URL de origen
 * a storage propio. Por foto: descarga (timeout + límite) → firma real → sharp (rotación EXIF, sin metadatos,
 * WebP máx. 2400 px) → storage público → fila en `files` → property_media.file_id + status `stored`.
 * - Idempotente: solo toma filas sin file_id; la asignación final es condicional (`file_id is null`).
 * - Concurrencia: lease por `last_checked_at` con FOR UPDATE SKIP LOCKED.
 * - Lotes chicos; si el lote se llena, se encola la continuación.
 * - Archivo inválido → `failed` sin reintentos. Fallas transitorias → copy_attempts++ (máx. 5 → failed).
 * - La URL de origen NO se borra.
 */
import sharp from "sharp";
import { sql, type Database } from "../db";
import { isEnabled } from "../flags";
import { errorFields, log } from "../log";
import { enqueue } from "../jobs/queue";
import { registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { newStorageKey, sha256, storage } from "../storage";
import { InvalidMediaError, downloadImage } from "./download";

export const MEDIA_COPY_BATCH = 8;
export const MEDIA_COPY_MAX_ATTEMPTS = 5;
const MAX_DIMENSION = 2400;

export type NormalizedImage = { bytes: Uint8Array; width: number; height: number; contentType: "image/webp" };

/** Rotación según EXIF, sin metadatos (sharp no los copia salvo withMetadata), WebP con lado mayor ≤ 2400 px. */
export async function normalizeImage(input: Uint8Array): Promise<NormalizedImage> {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 120_000_000, failOn: "error" })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height, contentType: "image/webp" };
  } catch (e) {
    throw new InvalidMediaError(`La imagen no se pudo procesar: ${(e as Error).message}`);
  }
}

type Claimed = { id: string; property_id: string; source_url: string; copy_attempts: number };

async function claimBatch(db: Database, limit: number): Promise<Claimed[]> {
  const r = await sql<Claimed>`
    with c as (
      select id from property_media
       where status in ('source_only', 'verified') and file_id is null and deleted_at is null and kind = 'image'
         and source_url is not null and copy_attempts < ${MEDIA_COPY_MAX_ATTEMPTS}
         and (last_checked_at is null or last_checked_at < now() - interval '10 minutes')
       order by last_checked_at nulls first, created_at
       limit ${limit}
       for update skip locked
    )
    update property_media m set last_checked_at = now()
      from c where m.id = c.id
    returning m.id, m.property_id, m.source_url, m.copy_attempts`.execute(db);
  return r.rows;
}

export type CopyItemResult = "stored" | "invalid" | "retry" | "skipped";

export async function copyOneMedia(db: Database, m: Claimed): Promise<CopyItemResult> {
  let uploaded: { bucket: string; key: string } | null = null;
  try {
    const { bytes } = await downloadImage(m.source_url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 20_000 });
    const img = await normalizeImage(bytes);
    const st = storage();
    const bucket = st.bucketFor("public");
    const key = newStorageKey(`properties/${m.property_id}`, "webp");
    await st.put(bucket, key, img.bytes, img.contentType);
    uploaded = { bucket, key };
    const originalName = decodeURIComponent(new URL(m.source_url).pathname.split("/").pop() ?? "").slice(0, 200) || null;
    const assigned = await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("property_media").select(["file_id", "deleted_at"]).where("id", "=", m.id).forUpdate().executeTakeFirst();
      if (!current || current.file_id || current.deleted_at) return false;
      const file = await trx
        .insertInto("files")
        .values({
          storage_driver: st.name,
          bucket,
          storage_key: key,
          content_type: img.contentType,
          size_bytes: img.bytes.byteLength,
          checksum_sha256: sha256(img.bytes),
          visibility: "public",
          original_name: originalName,
          width: img.width,
          height: img.height,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("property_media")
        .set({ file_id: file.id, status: "stored", width: img.width, height: img.height, last_error: null, last_checked_at: new Date() })
        .where("id", "=", m.id)
        .execute();
      return true;
    });
    if (!assigned) {
      await st.remove(bucket, key).catch((e: unknown) => log.warn("media.copy_orphan_cleanup_failed", { mediaId: m.id, ...errorFields(e) }));
      return "skipped";
    }
    return "stored";
  } catch (e) {
    const message = ((e as Error).message ?? String(e)).slice(0, 1000);
    if (uploaded) {
      const u = uploaded;
      await storage()
        .remove(u.bucket, u.key)
        .catch((err: unknown) => log.warn("media.copy_orphan_cleanup_failed", { mediaId: m.id, ...errorFields(err) }));
    }
    if (e instanceof InvalidMediaError) {
      await db.updateTable("property_media").set({ status: "failed", last_error: message, copy_attempts: m.copy_attempts + 1 }).where("id", "=", m.id).where("file_id", "is", null).execute();
      log.warn("media.copy_invalid", { mediaId: m.id, error: message });
      return "invalid";
    }
    const attempts = m.copy_attempts + 1;
    await db
      .updateTable("property_media")
      .set({ last_error: message, copy_attempts: attempts, ...(attempts >= MEDIA_COPY_MAX_ATTEMPTS ? { status: "failed" } : {}) })
      .where("id", "=", m.id)
      .where("file_id", "is", null)
      .execute();
    log.warn("media.copy_retry", { mediaId: m.id, attempts, error: message });
    return "retry";
  }
}

export async function runMediaCopy(db: Database, opts: { batch?: number } = {}): Promise<Record<CopyItemResult, number> & { claimed: number; continued: boolean; skippedFlag?: boolean }> {
  const stats = { stored: 0, invalid: 0, retry: 0, skipped: 0, claimed: 0, continued: false };
  if (!(await isEnabled(db, "media_copy"))) return { ...stats, skippedFlag: true };
  const batch = opts.batch ?? MEDIA_COPY_BATCH;
  const items = await claimBatch(db, batch);
  stats.claimed = items.length;
  for (const m of items) stats[await copyOneMedia(db, m)]++;
  if (items.length === batch) {
    stats.continued = Boolean(await enqueue(db, { type: "media.copy", dedupeKey: "media.copy:continue", runAt: new Date(Date.now() + 60_000), timeoutMs: 240_000, maxAttempts: 3 }));
  }
  return stats;
}

registerJobHandler("media.copy", async (_p, ctx) => runMediaCopy(ctx.db));
addScheduledTask({ type: "media.copy", every: "hourly", timeoutMs: 240_000 });
