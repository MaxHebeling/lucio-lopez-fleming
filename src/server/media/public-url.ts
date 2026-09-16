/**
 * URL pública de una foto para servicios externos (portales, Meta). Tienen que poder descargarla desde internet:
 * https, host no local ni de red privada. Prioridad: archivo propio público en storage → URL de origen.
 */
import type { Executor } from "../db";
import { storage } from "../storage";
import { log } from "../log";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

export function isPublicHttpsUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !PRIVATE_HOST.test(u.hostname) && !u.hostname.endsWith(".local") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export type MediaForUrl = {
  source_url: string | null;
  status: string;
  file_id: string | null;
  file_visibility: string | null;
  file_bucket: string | null;
  file_storage_key: string | null;
  file_deleted_at: Date | null;
};

export async function publicMediaUrl(m: MediaForUrl): Promise<string | null> {
  if (m.file_id && m.file_visibility === "public" && m.file_bucket && m.file_storage_key && !m.file_deleted_at) {
    try {
      // Solo URLs absolutas https del storage (el driver local devuelve rutas internas: no sirven afuera).
      const url = await storage().url(m.file_bucket, m.file_storage_key, "public", m.file_id);
      if (isPublicHttpsUrl(url)) return url;
    } catch (e) {
      // Storage sin configurar o caído: se intenta con la URL de origen.
      log.warn("media.public_url_storage_failed", { fileId: m.file_id, error: (e as Error).message });
    }
  }
  if (["source_only", "verified", "stored"].includes(m.status) && isPublicHttpsUrl(m.source_url)) return m.source_url;
  return null;
}

/** Fotos (imágenes) utilizables de una propiedad, con su URL pública si la tienen. */
export async function propertyImages(db: Executor, propertyId: string, opts: { onlyVerified?: boolean } = {}) {
  let q = db
    .selectFrom("property_media as m")
    .leftJoin("files as f", "f.id", "m.file_id")
    .select([
      "m.id",
      "m.is_cover",
      "m.sort_order",
      "m.status",
      "m.source_url",
      "m.file_id",
      "m.alt_text",
      "f.visibility as file_visibility",
      "f.bucket as file_bucket",
      "f.storage_key as file_storage_key",
      "f.deleted_at as file_deleted_at",
      "f.content_type as file_content_type",
    ])
    .where("m.property_id", "=", propertyId)
    .where("m.kind", "=", "image")
    .where("m.deleted_at", "is", null);
  q = opts.onlyVerified ? q.where("m.status", "in", ["verified", "stored"]) : q.where("m.status", "in", ["source_only", "verified", "stored"]);
  const rows = await q.orderBy("m.is_cover", "desc").orderBy("m.sort_order").orderBy("m.created_at").execute();
  return Promise.all(rows.map(async (r) => ({ ...r, publicUrl: await publicMediaUrl(r) })));
}
