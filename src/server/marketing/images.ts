/**
 * Imágenes de un post para Meta: URLs públicas https en JPEG (Instagram solo acepta JPEG, ≤ 8 MB,
 * relación 4:5 a 1.91:1). Si la foto original ya cumple y tiene URL pública, se usa tal cual; si no, se genera
 * un derivado JPEG (rotación EXIF, sin metadatos, ≤ 1440 px, márgenes blancos si la proporción no entra) en storage
 * público y se guarda en social_assets.file_id (idempotente: se reutiliza en reintentos).
 */
import sharp from "sharp";
import type { Database } from "../db";
import { newStorageKey, sha256, storage } from "../storage";
import { PermanentIntegrationError } from "../integrations/http";
import { downloadImage, InvalidMediaError } from "../media/download";
import { isPublicHttpsUrl, publicMediaUrl } from "../media/public-url";

const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;
const MAX_WIDTH = 1440;
const MAX_BYTES = 8 * 1024 * 1024;

export class NoPublicUrlError extends PermanentIntegrationError {
  constructor(detail: string) {
    super(`No hay URL pública válida para las imágenes: ${detail}. Configurá STORAGE_DRIVER=s3 con STORAGE_PUBLIC_BASE_URL (https).`);
    this.name = "NoPublicUrlError";
  }
}

/** Dimensiones del lienzo para que la proporción quede dentro de [4:5, 1.91:1] sin recortar la foto. */
export function paddedCanvas(width: number, height: number): { width: number; height: number } {
  const ratio = width / height;
  if (ratio < MIN_RATIO) return { width: Math.ceil(height * MIN_RATIO), height };
  if (ratio > MAX_RATIO) return { width, height: Math.ceil(width / MAX_RATIO) };
  return { width, height };
}

export async function toSocialJpeg(input: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  try {
    const resized = await sharp(input, { limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: MAX_WIDTH, height: MAX_WIDTH * 2, fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const canvas = paddedCanvas(resized.info.width, resized.info.height);
    const padX = canvas.width - resized.info.width;
    const padY = canvas.height - resized.info.height;
    let pipeline = sharp(resized.data);
    if (padX > 0 || padY > 0) {
      pipeline = pipeline.extend({
        left: Math.floor(padX / 2),
        right: Math.ceil(padX / 2),
        top: Math.floor(padY / 2),
        bottom: Math.ceil(padY / 2),
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      });
    }
    const out = await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (out.data.byteLength > MAX_BYTES) throw new InvalidMediaError("La imagen supera 8 MB aun comprimida");
    return { bytes: new Uint8Array(out.data), width: out.info.width, height: out.info.height };
  } catch (e) {
    if (e instanceof InvalidMediaError) throw e;
    throw new InvalidMediaError(`La imagen no se pudo convertir a JPEG: ${(e as Error).message}`);
  }
}

async function fileUrl(f: { id: string; bucket: string; storage_key: string }): Promise<string | null> {
  const url = await storage().url(f.bucket, f.storage_key, "public", f.id);
  return isPublicHttpsUrl(url) ? url : null;
}

export async function socialImageUrls(db: Database, postId: string): Promise<string[]> {
  const assets = await db
    .selectFrom("social_assets as a")
    .leftJoin("property_media as m", "m.id", "a.property_media_id")
    .leftJoin("files as mf", "mf.id", "m.file_id")
    .leftJoin("files as af", "af.id", "a.file_id")
    .select([
      "a.id",
      "a.file_id",
      "af.bucket as asset_bucket",
      "af.storage_key as asset_key",
      "af.content_type as asset_type",
      "af.deleted_at as asset_deleted_at",
      "m.id as media_id",
      "m.source_url",
      "m.status",
      "m.file_id as media_file_id",
      "m.deleted_at as media_deleted_at",
      "mf.visibility as file_visibility",
      "mf.bucket as file_bucket",
      "mf.storage_key as file_storage_key",
      "mf.deleted_at as file_deleted_at",
    ])
    .where("a.social_post_id", "=", postId)
    .orderBy("a.sort_order")
    .limit(10)
    .execute();
  if (!assets.length) throw new PermanentIntegrationError("El post no tiene fotos seleccionadas");

  const urls: string[] = [];
  for (const a of assets) {
    // Derivado ya generado en un intento anterior.
    if (a.file_id && a.asset_bucket && a.asset_key && a.asset_type === "image/jpeg" && !a.asset_deleted_at) {
      const u = await fileUrl({ id: a.file_id, bucket: a.asset_bucket, storage_key: a.asset_key });
      if (!u) throw new NoPublicUrlError("el storage no expone URLs públicas https");
      urls.push(u);
      continue;
    }
    if (!a.media_id || a.media_deleted_at) throw new PermanentIntegrationError("Una de las fotos del post fue eliminada: revisá la selección");

    const original = await publicMediaUrl({
      source_url: a.source_url,
      status: a.status ?? "pending",
      file_id: a.media_file_id,
      file_visibility: a.file_visibility,
      file_bucket: a.file_bucket,
      file_storage_key: a.file_storage_key,
      file_deleted_at: a.file_deleted_at,
    });
    let bytes: Uint8Array;
    let contentType: string;
    if (a.media_file_id && a.file_bucket && a.file_storage_key && !a.file_deleted_at) {
      bytes = await storage().get(a.file_bucket, a.file_storage_key);
      contentType = "image/webp";
    } else if (a.source_url) {
      const d = await downloadImage(a.source_url, { maxBytes: 25 * 1024 * 1024 });
      bytes = d.bytes;
      contentType = d.contentType;
    } else {
      throw new NoPublicUrlError("la foto no tiene archivo ni URL de origen");
    }

    if (original && contentType === "image/jpeg" && bytes.byteLength <= MAX_BYTES) {
      const meta = await sharp(bytes).metadata();
      const w = meta.autoOrient?.width ?? meta.width ?? 0;
      const h = meta.autoOrient?.height ?? meta.height ?? 0;
      if (w && h && w / h >= MIN_RATIO && w / h <= MAX_RATIO) {
        urls.push(original);
        continue;
      }
    }

    const st = storage();
    const bucket = st.bucketFor("public");
    const key = newStorageKey(`social/${postId}`, "jpg");
    // Antes de generar y subir: si el storage no da URLs públicas https, el derivado no le sirve a Meta.
    if (!isPublicHttpsUrl(await st.url(bucket, key, "public", "00000000-0000-0000-0000-000000000000"))) {
      throw new NoPublicUrlError("el storage no expone URLs públicas https y la foto original no es un JPEG apto");
    }
    const jpeg = await toSocialJpeg(bytes);
    await st.put(bucket, key, jpeg.bytes, "image/jpeg");
    const file = await db
      .insertInto("files")
      .values({ storage_driver: st.name, bucket, storage_key: key, content_type: "image/jpeg", size_bytes: jpeg.bytes.byteLength, checksum_sha256: sha256(jpeg.bytes), visibility: "public", width: jpeg.width, height: jpeg.height })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.updateTable("social_assets").set({ file_id: file.id }).where("id", "=", a.id).execute();
    const u = await fileUrl({ id: file.id, bucket, storage_key: key });
    if (!u) throw new NoPublicUrlError("el storage no expone URLs públicas https");
    urls.push(u);
  }
  return urls;
}
