/**
 * Archivos de tours: panorámicas equirectangulares y planos. Reutiliza el storage existente (tabla `files` + driver
 * local/s3): nada de almacenamiento nuevo.
 *
 * Panorámica: firma real (JPG/PNG/WebP/AVIF) → tamaño máximo (el mismo de las fotos) → sharp (orientación EXIF, sin
 * metadatos EXIF/GPS) → 2:1 ±1 % → como máximo 8192×4096 → JPEG progresivo público + preview 512×256 + miniatura 640×400.
 * No se guarda el original (la versión publicada ya es el máster de 8192 px; el original queda en manos del fotógrafo).
 */
import "server-only";
import sharp, { type Metadata } from "sharp";
import { sql, type Database, type Executor } from "../db";
import { invalid, AppError } from "../errors";
import { errorFields, log } from "../log";
import { ALLOWED_UPLOADS, newStorageKey, sha256, sniffContentType, storage } from "../storage";
import { isEquirectangular } from "./model";

export const PANORAMA_MAX_WIDTH = 8192;
export const PANORAMA_MAX_HEIGHT = 4096;
export const PANORAMA_MIN_WIDTH = 2048;
export const PREVIEW_SIZE = { width: 512, height: 256 } as const;
export const THUMB_SIZE = { width: 640, height: 400 } as const;
export const TOUR_MAX_BYTES = ALLOWED_UPLOADS["image/jpeg"]!.maxBytes;
/** 16384 × 8192: una panorámica de cámara de gama alta; más que eso se rechaza antes de decodificar. */
const MAX_INPUT_PIXELS = 16384 * 8192;

export type ProcessedPanorama = {
  panorama: { bytes: Uint8Array; width: number; height: number };
  preview: { bytes: Uint8Array; width: number; height: number };
  thumbnail: { bytes: Uint8Array; width: number; height: number };
  sourceWidth: number;
  sourceHeight: number;
};

function assertImage(bytes: Uint8Array, what: string) {
  if (!bytes.byteLength) throw invalid("El archivo está vacío", { file: ["El archivo está vacío"] });
  const type = sniffContentType(bytes);
  const allowed = type ? ALLOWED_UPLOADS[type] : undefined;
  if (!type || !allowed || allowed.kind !== "image") throw invalid(`Formato no admitido: subí ${what} en JPG, PNG, WebP o AVIF`, { file: ["Formato no admitido"] });
  if (bytes.byteLength > allowed.maxBytes) {
    const mb = Math.round(allowed.maxBytes / 1024 / 1024);
    throw invalid(`El archivo supera el máximo de ${mb} MB`, { file: [`Máximo ${mb} MB`] });
  }
}

export async function processPanorama(bytes: Uint8Array): Promise<ProcessedPanorama> {
  assertImage(bytes, "la panorámica");
  const input = Buffer.from(bytes);
  const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const };
  let meta: Metadata;
  try {
    meta = await sharp(input, opts).metadata();
  } catch (e) {
    log.warn("tours.panorama_unreadable", errorFields(e));
    throw invalid("No pudimos leer la imagen: puede estar dañada o superar 16384 × 8192 px", { file: ["Imagen ilegible"] });
  }
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (!isEquirectangular(width, height)) {
    throw invalid(`La imagen mide ${width} × ${height} px: una panorámica 360° equirectangular tiene que ser 2:1 (por ejemplo 8192 × 4096)`, { file: ["No es 2:1"] });
  }
  if (width < PANORAMA_MIN_WIDTH) throw invalid(`La panorámica es muy chica (${width} px de ancho). Mínimo ${PANORAMA_MIN_WIDTH} px; ideal 6000–8192 px.`, { file: ["Resolución insuficiente"] });
  try {
    const outW = Math.min(PANORAMA_MAX_WIDTH, width);
    const outH = Math.round(outW / 2);
    const panorama = await sharp(input, opts).rotate().resize({ width: outW, height: outH, fit: "fill" }).jpeg({ quality: 85, progressive: true }).toBuffer({ resolveWithObject: true });
    const preview = await sharp(panorama.data).resize(PREVIEW_SIZE.width, PREVIEW_SIZE.height, { fit: "fill" }).jpeg({ quality: 70 }).toBuffer({ resolveWithObject: true });
    // Miniatura: franja central de la panorámica (la vista de frente), a 640 × 400.
    const mid = await sharp(panorama.data).resize(1280, 640, { fit: "fill" }).toBuffer();
    const thumbnail = await sharp(mid).extract({ left: 320, top: 120, width: 640, height: 400 }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
    return {
      panorama: { bytes: new Uint8Array(panorama.data), width: panorama.info.width, height: panorama.info.height },
      preview: { bytes: new Uint8Array(preview.data), width: preview.info.width, height: preview.info.height },
      thumbnail: { bytes: new Uint8Array(thumbnail.data), width: thumbnail.info.width, height: thumbnail.info.height },
      sourceWidth: width,
      sourceHeight: height,
    };
  } catch (e) {
    log.warn("tours.panorama_process_failed", errorFields(e));
    throw invalid("No pudimos procesar la panorámica: puede estar dañada", { file: ["Imagen dañada o ilegible"] });
  }
}

/** Plano raster (JPG/PNG/WebP/AVIF → WebP ≤ 2400 px). SVG no se acepta: no se sirve SVG subido por usuarios. */
export async function processFloorPlan(bytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  assertImage(bytes, "el plano");
  try {
    const out = await sharp(Buffer.from(bytes), { limitInputPixels: 120_000_000, failOn: "error" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(out.data), width: out.info.width, height: out.info.height };
  } catch (e) {
    log.warn("tours.floor_plan_process_failed", errorFields(e));
    throw invalid("No pudimos leer el plano: puede estar dañado", { file: ["Imagen dañada o ilegible"] });
  }
}

/**
 * ¿Hay dónde guardar archivos? En Vercel sin S3 el driver local no persiste (storage() lanza). Se consulta antes de
 * procesar para no dejar nada a medias y para mostrar el aviso en el editor.
 */
export function tourStorageStatus(): { configured: true } | { configured: false; message: string } {
  try {
    const d = storage();
    if (d.name === "s3" && !process.env.STORAGE_PUBLIC_BASE_URL) {
      return { configured: false, message: "El almacenamiento está configurado sin URL pública (STORAGE_PUBLIC_BASE_URL): las panorámicas no se podrían mostrar en el sitio." };
    }
    return { configured: true };
  } catch (e) {
    log.warn("tours.storage_unconfigured", errorFields(e));
    return { configured: false, message: "El almacenamiento de archivos no está configurado (faltan las credenciales S3). Todavía no se pueden subir panorámicas ni planos." };
  }
}

export function assertTourStorage(): void {
  const s = tourStorageStatus();
  if (!s.configured) throw new AppError("unavailable", s.message);
}

type StoredFile = { fileId: string; bucket: string; key: string };

/** Sube un objeto público y crea su fila en `files` (en la transacción recibida). */
export async function putPublicObject(prefix: string, bytes: Uint8Array, contentType: string, ext: string): Promise<{ bucket: string; key: string }> {
  const driver = storage();
  const bucket = driver.bucketFor("public");
  const key = newStorageKey(prefix, ext);
  await driver.put(bucket, key, bytes, contentType);
  return { bucket, key };
}

export async function insertPublicFile(
  trx: Executor,
  obj: { bucket: string; key: string },
  meta: { bytes: Uint8Array; contentType: string; width: number; height: number; name: string | null; uploadedBy: string | null },
): Promise<StoredFile> {
  const row = await trx
    .insertInto("files")
    .values({
      storage_driver: storage().name,
      bucket: obj.bucket,
      storage_key: obj.key,
      content_type: meta.contentType,
      size_bytes: meta.bytes.byteLength,
      checksum_sha256: sha256(meta.bytes),
      visibility: "public",
      original_name: meta.name,
      width: meta.width,
      height: meta.height,
      uploaded_by: meta.uploadedBy,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { fileId: row.id, ...obj };
}

/** Borra objetos ya subidos cuando la transacción no se confirmó (best effort, con log). */
export async function discardObjects(objs: Array<{ bucket: string; key: string }>): Promise<void> {
  const driver = storage();
  for (const o of objs) await driver.remove(o.bucket, o.key).catch((err) => log.error("tours.cleanup_failed", { bucket: o.bucket, key: o.key, ...errorFields(err) }));
}

/**
 * Tras dar de baja escenas/planos (files.deleted_at ya marcado en la transacción): borra los objetos del bucket público y
 * marca storage_removed_at. Si el storage falla queda pendiente y se reintenta en la tarea horaria.
 */
export async function removeDeletedTourFiles(db: Database, fileIds?: string[], limit = 50): Promise<{ removed: number; failed: number }> {
  let q = db
    .selectFrom("files as f")
    .select(["f.id", "f.bucket", "f.storage_key", "f.storage_driver"])
    .where("f.deleted_at", "is not", null)
    .where("f.storage_removed_at", "is", null)
    .where("f.visibility", "=", "public")
    .where(sql<boolean>`f.storage_key like 'tours/%'`);
  if (fileIds) {
    if (!fileIds.length) return { removed: 0, failed: 0 };
    q = q.where("f.id", "in", fileIds);
  }
  const pending = await q.limit(limit).execute();
  if (!pending.length) return { removed: 0, failed: 0 };
  const driver = storage();
  let removed = 0;
  let failed = 0;
  for (const f of pending) {
    if (f.storage_driver !== driver.name) continue;
    try {
      await driver.remove(f.bucket, f.storage_key);
      await db.updateTable("files").set({ storage_removed_at: new Date() }).where("id", "=", f.id).execute();
      removed++;
    } catch (e) {
      failed++;
      log.error("tours.public_remove_failed", { fileId: f.id, ...errorFields(e) });
    }
  }
  return { removed, failed };
}

/** URL pública de un archivo del storage (s3 con URL pública → directa; local → ruta /api/files). null si no se puede servir. */
export function publicFileUrl(f: { id: string | null; storage_driver: string | null; storage_key: string | null; visibility: string | null } | null | undefined): string | null {
  if (!f?.id || f.visibility !== "public" || !f.storage_key) return null;
  if (f.storage_driver === "s3") {
    const base = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
    return base ? `${base}/${f.storage_key}` : null;
  }
  return f.storage_driver === "local" ? `/api/files/${f.id}` : null;
}
