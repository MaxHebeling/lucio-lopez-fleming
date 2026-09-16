import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { authorizeFileAccess } from "@/server/files/access";
import { storage } from "@/server/storage";
import { errorFields, log } from "@/server/log";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: { code: "not_found", message: "Archivo no encontrado" } }, { status: 404, headers: { "cache-control": "no-store" } });

/**
 * Sirve archivos. Públicos: sin sesión (driver local → bytes; s3 → redirección a la URL pública).
 * Privados: solo con permiso sobre la entidad (driver local → bytes sin caché; s3 → URL firmada de 5 minutos).
 * Sin permiso se responde 404 (no se revela si el archivo existe).
 */
export const GET = apiRoute("files.get", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = getDb();
  // Un archivo público no necesita resolver la sesión.
  const pub = await authorizeFileAccess(db, { kind: "anonymous", organizationId: "" }, id);
  const access = pub.ok || pub.reason !== "unauthenticated" ? pub : await authorizeFileAccess(db, await getActor(), id);
  if (!access.ok) return notFound();
  const file = access.file;
  const driver = storage();
  if (driver.name !== file.storage_driver) {
    log.error("files.driver_mismatch", { fileId: file.id, expected: file.storage_driver, current: driver.name });
    return notFound();
  }
  const isPublic = file.visibility === "public";
  const cacheControl = isPublic ? "public, max-age=31536000, immutable" : "private, no-store";

  if (driver.name === "s3") {
    const url = await driver.url(file.bucket, file.storage_key, file.visibility, file.id, 300);
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": isPublic ? "public, max-age=3600" : "private, no-store" } });
  }

  const etag = file.checksum_sha256 ? `"${file.checksum_sha256}"` : null;
  if (etag && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { etag, "cache-control": cacheControl } });
  }
  let bytes: Uint8Array;
  try {
    bytes = await driver.get(file.bucket, file.storage_key);
  } catch (e) {
    log.error("files.read_failed", { fileId: file.id, ...errorFields(e) });
    return notFound();
  }
  const safeName = (file.original_name ?? "archivo").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": file.content_type,
      "content-length": String(bytes.byteLength),
      "cache-control": cacheControl,
      "content-disposition": `inline; filename="${safeName}"`,
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
      ...(etag ? { etag } : {}),
    },
  });
});
