/**
 * Captación de propietarios: fotos opcionales. Solo con storage S3 configurado (en producción el driver local no
 * persiste) y el flag `owner_capture_photos`. Si no, el paso de fotos NO aparece (sin botones muertos).
 *
 * Seguridad: subida anónima con rate limit por IP, tamaño máximo, firma real del archivo, sharp (sin EXIF/GPS, webp
 * ≤ 1600 px) y almacenamiento PRIVADO. El navegador recibe un token aleatorio (en la base solo su SHA-256) que se
 * canjea al enviar el formulario: la foto queda vinculada al lead (`lead_attachments`). Las no canjeadas vencen a las
 * 24 h y se purgan (objeto + fila).
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { sql, type Database } from "../db";
import { AppError, invalid } from "../errors";
import { isEnabled } from "../flags";
import { registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { errorFields, log } from "../log";
import { rateLimit } from "../rate-limit";
import { ALLOWED_UPLOADS, newStorageKey, sha256, sniffContentType, storage } from "../storage";

export const OWNER_PHOTOS_FLAG = "owner_capture_photos";
export const OWNER_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const OWNER_PHOTO_EDGE = 1600;
export const OWNER_UPLOAD_TTL_HOURS = 24;
export const OWNER_UPLOAD_RATE = { perIp: 12, windowSeconds: 600 } as const;

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Storage de producción listo: driver S3 con todas sus variables. El driver local no cuenta (no persiste en Vercel). */
export function storageConfiguredForUploads(env: Record<string, string | undefined> = process.env): boolean {
  return env.STORAGE_DRIVER === "s3" && ["STORAGE_ENDPOINT", "STORAGE_BUCKET_PUBLIC", "STORAGE_BUCKET_PRIVATE", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"].every((k) => Boolean(env[k]?.trim()));
}

export async function ownerPhotosAvailable(db: Database, opts: { storageConfigured?: boolean } = {}): Promise<boolean> {
  const configured = opts.storageConfigured ?? storageConfiguredForUploads();
  return configured && (await isEnabled(db, OWNER_PHOTOS_FLAG));
}

export async function uploadOwnerPhoto(db: Database, bytes: Uint8Array, ctx: { ip: string | null; storageConfigured?: boolean }): Promise<{ token: string }> {
  if (!(await ownerPhotosAvailable(db, { storageConfigured: ctx.storageConfigured }))) throw new AppError("unavailable", "Las fotos no están habilitadas");
  const ipKey = ctx.ip ? createHash("sha256").update(`owner-photos:${ctx.ip}`).digest("hex").slice(0, 32) : "unknown";
  const rl = await rateLimit(db, `owner-photos:ip:${ipKey}`, ctx.ip ? OWNER_UPLOAD_RATE.perIp : OWNER_UPLOAD_RATE.perIp * 5, OWNER_UPLOAD_RATE.windowSeconds);
  if (!rl.allowed) throw new AppError("rate_limited", "Subiste muchas fotos seguidas. Esperá unos minutos.");
  if (!bytes.byteLength) throw invalid("El archivo está vacío");
  if (bytes.byteLength > OWNER_PHOTO_MAX_BYTES) throw invalid("La foto supera 4 MB");
  const type = sniffContentType(bytes);
  if (!type || ALLOWED_UPLOADS[type]?.kind !== "image") throw invalid("Subí fotos JPG, PNG, WebP o AVIF");
  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(Buffer.from(bytes), { limitInputPixels: 60_000_000, failOn: "error" })
      .rotate()
      .resize({ width: OWNER_PHOTO_EDGE, height: OWNER_PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    log.warn("site.owner_photo_unreadable", errorFields(e));
    throw invalid("No pudimos leer la foto");
  }
  const driver = storage();
  const bucket = driver.bucketFor("private");
  const key = newStorageKey("owner-capture", "webp");
  const body = new Uint8Array(out.data);
  await driver.put(bucket, key, body, "image/webp");
  const token = randomBytes(32).toString("base64url");
  try {
    await db.transaction().execute(async (trx) => {
      const file = await trx
        .insertInto("files")
        .values({ storage_driver: driver.name, bucket, storage_key: key, content_type: "image/webp", size_bytes: body.byteLength, checksum_sha256: sha256(body), visibility: "private", original_name: null, width: out.info.width, height: out.info.height })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.insertInto("owner_capture_uploads").values({ file_id: file.id, token_hash: tokenHash(token), expires_at: new Date(Date.now() + OWNER_UPLOAD_TTL_HOURS * 3_600_000) }).execute();
    });
  } catch (e) {
    await driver.remove(bucket, key).catch((err) => log.error("site.owner_photo_cleanup_failed", errorFields(err)));
    throw e;
  }
  return { token };
}

/** Vincula al lead las fotos subidas en esta consulta (tokens vigentes y sin canjear). Idempotente. */
export async function claimOwnerPhotos(db: Database, leadId: string, tokens: string[]): Promise<number> {
  const hashes = [...new Set(tokens)].map(tokenHash);
  if (!hashes.length) return 0;
  return db.transaction().execute(async (trx) => {
    const rows = await trx
      .updateTable("owner_capture_uploads")
      .set({ lead_id: leadId, claimed_at: new Date() })
      .where("token_hash", "in", hashes)
      .where("claimed_at", "is", null)
      .where("expires_at", ">", new Date())
      .returning("file_id")
      .execute();
    if (rows.length) await trx.insertInto("lead_attachments").values(rows.map((r) => ({ lead_id: leadId, file_id: r.file_id, kind: "owner_photo" }))).onConflict((oc) => oc.doNothing()).execute();
    return rows.length;
  });
}

/** Purga de subidas vencidas sin canjear: borra el objeto y la fila; el archivo queda dado de baja. */
export async function purgeOwnerUploads(db: Database, limit = 200): Promise<{ purged: number; failed: number }> {
  const rows = await sql<{ id: string; file_id: string; bucket: string; storage_key: string; storage_driver: string }>`
    select u.id, u.file_id, f.bucket, f.storage_key, f.storage_driver from owner_capture_uploads u join files f on f.id = u.file_id
     where u.claimed_at is null and u.expires_at < now() limit ${limit}`.execute(db);
  if (!rows.rows.length) return { purged: 0, failed: 0 };
  const driver = storage();
  let purged = 0;
  let failed = 0;
  for (const r of rows.rows) {
    try {
      if (r.storage_driver === driver.name) await driver.remove(r.bucket, r.storage_key);
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("owner_capture_uploads").where("id", "=", r.id).execute();
        await trx.updateTable("files").set({ deleted_at: new Date(), storage_removed_at: new Date() }).where("id", "=", r.file_id).execute();
      });
      purged++;
    } catch (e) {
      failed++;
      log.error("site.owner_upload_purge_failed", { uploadId: r.id, ...errorFields(e) });
    }
  }
  return { purged, failed };
}

registerJobHandler("site.owner_uploads_purge", async (_p, { db }) => purgeOwnerUploads(db));
addScheduledTask({ type: "site.owner_uploads_purge", every: "hourly", timeoutMs: 60_000 });

/** Fotos del propietario de un lead (para la ficha del lead en el CRM). */
export async function leadOwnerPhotos(db: Database, leadId: string): Promise<Array<{ fileId: string; width: number | null; height: number | null }>> {
  const rows = await db
    .selectFrom("lead_attachments as a")
    .innerJoin("files as f", "f.id", "a.file_id")
    .select(["f.id", "f.width", "f.height"])
    .where("a.lead_id", "=", leadId)
    .where("f.deleted_at", "is", null)
    .orderBy("a.created_at")
    .execute();
  return rows.map((r) => ({ fileId: r.id, width: r.width, height: r.height }));
}
