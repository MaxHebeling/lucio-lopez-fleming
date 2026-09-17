/**
 * Multimedia de propiedades (fotos y planos). Cada subida:
 * firma real del archivo (no el content-type del navegador) → tamaño máximo → sharp (rotación EXIF, sin metadatos
 * EXIF/GPS) → original saneado (privado) + versión optimizada webp ≤ 2400 px (pública) en storage →
 * filas `files` + `property_media` con auditoría y evento `property.updated` en la misma transacción.
 * Si la transacción falla, los objetos subidos se borran (best effort, con log).
 */
import { registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import sharp from "sharp";
import { protectImportedFields } from "./service";
import { z } from "zod";
import { parseInput } from "../validate";
import { sql, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid, notFound } from "../errors";
import { errorFields, log } from "../log";
import { ALLOWED_UPLOADS, newStorageKey, sha256, sniffContentType, storage } from "../storage";

export const MAX_IMAGE_EDGE = 2400;
export const MAX_MEDIA_PER_PROPERTY = 200;
const MAX_INPUT_PIXELS = 120_000_000; // ~ 12000 x 10000: fotos de cámara sobradas, frena "bombas" de descompresión

export const IMAGE_CONTENT_TYPES = Object.entries(ALLOWED_UPLOADS)
  .filter(([, v]) => v.kind === "image")
  .map(([k]) => k);
export const MAX_IMAGE_BYTES = Math.max(...IMAGE_CONTENT_TYPES.map((t) => ALLOWED_UPLOADS[t]!.maxBytes));

export type ProcessedImage = {
  original: { bytes: Uint8Array; contentType: string; ext: string; width: number; height: number };
  optimized: { bytes: Uint8Array; contentType: "image/webp"; ext: "webp"; width: number; height: number };
};

/** Valida y procesa una imagen. Lanza AppError de validación con mensajes para el usuario. */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  if (!bytes.byteLength) throw invalid("El archivo está vacío", { file: ["El archivo está vacío"] });
  const type = sniffContentType(bytes);
  const allowed = type ? ALLOWED_UPLOADS[type] : undefined;
  if (!type || !allowed || allowed.kind !== "image") {
    throw invalid("Formato no admitido: subí fotos JPG, PNG, WebP o AVIF", { file: ["Formato no admitido"] });
  }
  if (bytes.byteLength > allowed.maxBytes) {
    const mb = Math.round(allowed.maxBytes / 1024 / 1024);
    throw invalid(`La foto supera el máximo de ${mb} MB`, { file: [`Máximo ${mb} MB`] });
  }
  try {
    const input = Buffer.from(bytes);
    const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const };
    // sharp descarta los metadatos (EXIF, GPS, XMP) salvo que se pidan explícitamente; rotate() aplica la orientación EXIF.
    const base = sharp(input, opts).rotate();
    const originalPipeline =
      type === "image/png" ? base.png({ compressionLevel: 9 }) : type === "image/webp" ? base.webp({ quality: 92 }) : type === "image/avif" ? base.avif({ quality: 70 }) : base.jpeg({ quality: 92, mozjpeg: true });
    const original = await originalPipeline.toBuffer({ resolveWithObject: true });
    const optimized = await sharp(input, opts)
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      original: { bytes: new Uint8Array(original.data), contentType: type, ext: allowed.ext, width: original.info.width, height: original.info.height },
      optimized: { bytes: new Uint8Array(optimized.data), contentType: "image/webp", ext: "webp", width: optimized.info.width, height: optimized.info.height },
    };
  } catch (e) {
    log.warn("media.process_failed", errorFields(e));
    throw invalid("No pudimos leer la imagen: puede estar dañada", { file: ["Imagen dañada o ilegible"] });
  }
}

async function lockProperty(trx: Tx, propertyId: string) {
  const p = await trx.selectFrom("properties").select(["id", "code"]).where("id", "=", propertyId).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
  if (!p) throw notFound("Propiedad");
  return p;
}

async function touchProperty(trx: Tx, actor: Actor, propertyId: string) {
  await trx.updateTable("properties").set({ updated_by: actorUserId(actor) }).where("id", "=", propertyId).execute();
  await emitEvent(trx, actor, { type: "property.updated", aggregateType: "property", aggregateId: propertyId, payload: { fields: ["media"], link: `/crm/propiedades/${propertyId}` } });
}

const uuid = z.uuid();
function assertUuid(v: string, what: string) {
  if (!uuid.safeParse(v).success) throw notFound(what);
}

export const uploadMediaSchema = z.object({
  kind: z.enum(["image", "floor_plan"]).default("image"),
  altText: z.string().trim().max(250).nullable().optional(),
  originalName: z.string().max(255).nullable().optional(),
});

export async function addPropertyImage(
  db: Database,
  actor: Actor,
  propertyId: string,
  bytes: Uint8Array,
  raw: z.input<typeof uploadMediaSchema> = {},
): Promise<{ mediaId: string; fileId: string; width: number; height: number; isCover: boolean }> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(propertyId, "Propiedad");
  const meta = parseInput(uploadMediaSchema, raw);
  const exists = await db.selectFrom("properties").select("id").where("id", "=", propertyId).where("deleted_at", "is", null).executeTakeFirst();
  if (!exists) throw notFound("Propiedad");

  const img = await processImage(bytes);
  const driver = storage();
  const originalKey = newStorageKey(`properties/${propertyId}/originals`, img.original.ext);
  const optimizedKey = newStorageKey(`properties/${propertyId}`, img.optimized.ext);
  const privateBucket = driver.bucketFor("private");
  const publicBucket = driver.bucketFor("public");
  const stored: Array<[string, string]> = [];
  try {
    await driver.put(privateBucket, originalKey, img.original.bytes, img.original.contentType);
    stored.push([privateBucket, originalKey]);
    await driver.put(publicBucket, optimizedKey, img.optimized.bytes, img.optimized.contentType);
    stored.push([publicBucket, optimizedKey]);

    const name = meta.originalName ? meta.originalName.replace(/[\p{Cc}\\/]/gu, "_").slice(0, 200) : null;
    return await db.transaction().execute(async (trx) => {
      await lockProperty(trx, propertyId);
      const counts = await trx
        .selectFrom("property_media")
        .select([sql<number>`count(*)::int`.as("n"), sql<number>`coalesce(max(sort_order), 0)::int`.as("max_order"), sql<boolean>`bool_or(is_cover)`.as("has_cover")])
        .where("property_id", "=", propertyId)
        .where("deleted_at", "is", null)
        .executeTakeFirstOrThrow();
      if (counts.n >= MAX_MEDIA_PER_PROPERTY) throw conflict(`La propiedad ya tiene ${MAX_MEDIA_PER_PROPERTY} archivos multimedia`);
      const uploader = actorUserId(actor);
      const originalFile = await trx
        .insertInto("files")
        .values({ storage_driver: driver.name, bucket: privateBucket, storage_key: originalKey, content_type: img.original.contentType, size_bytes: img.original.bytes.byteLength, checksum_sha256: sha256(img.original.bytes), visibility: "private", original_name: name, width: img.original.width, height: img.original.height, uploaded_by: uploader })
        .returning("id")
        .executeTakeFirstOrThrow();
      const optimizedFile = await trx
        .insertInto("files")
        .values({ storage_driver: driver.name, bucket: publicBucket, storage_key: optimizedKey, content_type: img.optimized.contentType, size_bytes: img.optimized.bytes.byteLength, checksum_sha256: sha256(img.optimized.bytes), visibility: "public", original_name: name, width: img.optimized.width, height: img.optimized.height, uploaded_by: uploader })
        .returning("id")
        .executeTakeFirstOrThrow();
      const isCover = meta.kind === "image" && !counts.has_cover;
      const media = await trx
        .insertInto("property_media")
        .values({
          property_id: propertyId,
          kind: meta.kind,
          file_id: optimizedFile.id,
          original_file_id: originalFile.id,
          sort_order: counts.max_order + 10,
          is_cover: isCover,
          alt_text: meta.altText || null,
          width: img.optimized.width,
          height: img.optimized.height,
          status: "stored",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await audit(trx, actor, {
        action: "PROPERTY_MEDIA_ADDED",
        entityType: "property",
        entityId: propertyId,
        after: { mediaId: media.id, kind: meta.kind, fileId: optimizedFile.id, originalFileId: originalFile.id, width: img.optimized.width, height: img.optimized.height, isCover },
      });
      await touchProperty(trx, actor, propertyId);
      return { mediaId: media.id, fileId: optimizedFile.id, width: img.optimized.width, height: img.optimized.height, isCover };
    });
  } catch (e) {
    for (const [bucket, key] of stored) {
      await driver.remove(bucket, key).catch((err) => log.error("media.cleanup_failed", { bucket, key, ...errorFields(err) }));
    }
    throw e;
  }
}

export const reorderSchema = z.array(z.uuid()).min(1).max(MAX_MEDIA_PER_PROPERTY);

export async function reorderPropertyMedia(db: Database, actor: Actor, propertyId: string, rawIds: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(propertyId, "Propiedad");
  const ids = parseInput(reorderSchema, rawIds);
  if (new Set(ids).size !== ids.length) throw invalid("Orden inválido: hay elementos repetidos");
  await db.transaction().execute(async (trx) => {
    await lockProperty(trx, propertyId);
    const current = await trx.selectFrom("property_media").select(["id"]).where("property_id", "=", propertyId).where("deleted_at", "is", null).orderBy("sort_order").orderBy("created_at").execute();
    const currentIds = current.map((m) => m.id);
    if (currentIds.length !== ids.length || !ids.every((i) => currentIds.includes(i))) throw conflict("La multimedia cambió mientras ordenabas: recargá la página");
    if (currentIds.every((v, i) => v === ids[i])) return;
    await sql`update property_media m set sort_order = o.ord * 10
      from unnest(${ids}::uuid[]) with ordinality as o(id, ord)
      where m.id = o.id and m.property_id = ${propertyId}`.execute(trx);
    await audit(trx, actor, { action: "PROPERTY_MEDIA_REORDERED", entityType: "property", entityId: propertyId, before: { order: currentIds }, after: { order: ids } });
    await protectImportedFields(trx, actor, propertyId, ["media"]);
    await touchProperty(trx, actor, propertyId);
  });
}

async function loadMedia(trx: Tx, propertyId: string, mediaId: string) {
  const m = await trx
    .selectFrom("property_media")
    .select(["id", "kind", "is_cover", "alt_text", "file_id", "original_file_id"])
    .where("id", "=", mediaId)
    .where("property_id", "=", propertyId)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (!m) throw notFound("Archivo multimedia");
  return m;
}

export async function setPropertyCover(db: Database, actor: Actor, propertyId: string, mediaId: string): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(propertyId, "Propiedad");
  assertUuid(mediaId, "Archivo multimedia");
  await db.transaction().execute(async (trx) => {
    await lockProperty(trx, propertyId);
    const m = await loadMedia(trx, propertyId, mediaId);
    if (m.kind !== "image") throw invalid("Solo una foto puede ser portada");
    if (m.is_cover) return;
    const prev = await trx.selectFrom("property_media").select("id").where("property_id", "=", propertyId).where("is_cover", "=", true).where("deleted_at", "is", null).executeTakeFirst();
    await trx.updateTable("property_media").set({ is_cover: false }).where("property_id", "=", propertyId).where("is_cover", "=", true).execute();
    await trx.updateTable("property_media").set({ is_cover: true }).where("id", "=", mediaId).execute();
    await audit(trx, actor, { action: "PROPERTY_MEDIA_COVER_SET", entityType: "property", entityId: propertyId, before: { coverMediaId: prev?.id ?? null }, after: { coverMediaId: mediaId } });
    await protectImportedFields(trx, actor, propertyId, ["media"]);
    await touchProperty(trx, actor, propertyId);
  });
}

export const altTextSchema = z.string().trim().max(250, "Máximo 250 caracteres");

export async function updateMediaAltText(db: Database, actor: Actor, propertyId: string, mediaId: string, rawAlt: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(propertyId, "Propiedad");
  assertUuid(mediaId, "Archivo multimedia");
  const parsed = altTextSchema.safeParse(rawAlt ?? "");
  if (!parsed.success) throw invalid("Texto alternativo inválido", { altText: parsed.error.issues.map((i) => i.message) });
  const alt = parsed.data || null;
  await db.transaction().execute(async (trx) => {
    await lockProperty(trx, propertyId);
    const m = await loadMedia(trx, propertyId, mediaId);
    if ((m.alt_text ?? null) === alt) return;
    await trx.updateTable("property_media").set({ alt_text: alt }).where("id", "=", mediaId).execute();
    await audit(trx, actor, { action: "PROPERTY_MEDIA_UPDATED", entityType: "property", entityId: propertyId, before: { mediaId, altText: m.alt_text }, after: { mediaId, altText: alt } });
    await touchProperty(trx, actor, propertyId);
  });
}

/**
 * Baja lógica. Si era la portada, pasa a serlo la siguiente foto. Los archivos dejan de servirse por /api/files y,
 * confirmada la transacción, se borra el objeto del bucket PÚBLICO (con s3 + STORAGE_PUBLIC_BASE_URL la URL directa
 * seguiría funcionando). El original saneado queda en el bucket privado. Si el storage falla, la baja no se revierte:
 * queda pendiente (files.storage_removed_at null) y se reintenta en la próxima baja o con removeDeletedPublicMedia.
 */
export async function deletePropertyMedia(db: Database, actor: Actor, propertyId: string, mediaId: string): Promise<{ newCoverId: string | null }> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(propertyId, "Propiedad");
  assertUuid(mediaId, "Archivo multimedia");
  const result = await db.transaction().execute(async (trx) => {
    await lockProperty(trx, propertyId);
    const m = await loadMedia(trx, propertyId, mediaId);
    const now = new Date();
    await trx.updateTable("property_media").set({ deleted_at: now, is_cover: false }).where("id", "=", mediaId).execute();
    const fileIds = [m.file_id, m.original_file_id].filter((x): x is string => Boolean(x));
    if (fileIds.length) await trx.updateTable("files").set({ deleted_at: now }).where("id", "in", fileIds).where("deleted_at", "is", null).execute();
    let newCoverId: string | null = null;
    if (m.is_cover) {
      const next = await trx.selectFrom("property_media").select("id").where("property_id", "=", propertyId).where("deleted_at", "is", null).where("kind", "=", "image").where("status", "<>", "failed").orderBy("sort_order").orderBy("created_at").executeTakeFirst();
      if (next) {
        await trx.updateTable("property_media").set({ is_cover: true }).where("id", "=", next.id).execute();
        newCoverId = next.id;
      }
    }
    await audit(trx, actor, { action: "PROPERTY_MEDIA_DELETED", entityType: "property", entityId: propertyId, before: { mediaId, kind: m.kind, wasCover: m.is_cover, fileIds }, after: { newCoverId } });
    await protectImportedFields(trx, actor, propertyId, ["media"]);
    await touchProperty(trx, actor, propertyId);
    return { newCoverId };
  });
  // Fuera de la transacción: nunca se llama al storage con la fila bloqueada.
  await removeDeletedPublicMedia(db).catch((e) => log.error("media.public_remove_failed", { propertyId, mediaId, ...errorFields(e) }));
  return result;
}

export const PUBLIC_MEDIA_REMOVAL_BATCH = 25;

/**
 * Borra del bucket público los objetos de multimedia dada de baja que siguen ahí (idempotente: marca
 * files.storage_removed_at). Solo archivos públicos de property_media sin ninguna otra referencia viva.
 */
export async function removeDeletedPublicMedia(db: Database, limit = PUBLIC_MEDIA_REMOVAL_BATCH): Promise<{ removed: number; failed: number }> {
  const driver = storage();
  const pending = await db
    .selectFrom("files as f")
    .select(["f.id", "f.bucket", "f.storage_key", "f.storage_driver"])
    .where("f.deleted_at", "is not", null)
    .where("f.visibility", "=", "public")
    .where("f.storage_removed_at", "is", null)
    .where("f.storage_driver", "=", driver.name)
    .where(({ exists, selectFrom }) => exists(selectFrom("property_media as m").select("m.id").whereRef("m.file_id", "=", "f.id")))
    .where(({ not, exists, selectFrom }) => not(exists(selectFrom("property_media as m").select("m.id").whereRef("m.file_id", "=", "f.id").where("m.deleted_at", "is", null))))
    .orderBy("f.deleted_at", "desc")
    .limit(limit)
    .execute();
  let removed = 0;
  let failed = 0;
  for (const f of pending) {
    try {
      await driver.remove(f.bucket, f.storage_key);
      await db.updateTable("files").set({ storage_removed_at: new Date() }).where("id", "=", f.id).where("storage_removed_at", "is", null).execute();
      removed++;
    } catch (e) {
      failed++;
      log.error("media.public_remove_failed", { fileId: f.id, ...errorFields(e) });
    }
  }
  return { removed, failed };
}

// Reintento periódico de bajas de objetos públicos que fallaron en el momento del borrado.
registerJobHandler("properties.purge_public_media", async (_p, { db }) => removeDeletedPublicMedia(db));
addScheduledTask({ type: "properties.purge_public_media", every: "hourly", timeoutMs: 60_000 });
