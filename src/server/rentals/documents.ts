/**
 * Documentos privados de contratos. Los bytes van a storage privado (nunca a SQL ni a un bucket público);
 * la descarga pasa siempre por una ruta que autoriza (equipo con rentals.read o propietario del contrato).
 */
import "server-only";
import type { Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { conflict, invalid, notFound } from "../errors";
import { errorFields, log } from "../log";
import { ALLOWED_UPLOADS, newStorageKey, sha256, sniffContentType, storage } from "../storage";
import { DOCUMENT_KINDS } from "./schema";
import { z } from "zod";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const uploadSchema = z.object({
  title: z.string().trim().min(2, "Poné un título").max(200),
  kind: z.enum(DOCUMENT_KINDS),
  visibleToOwner: z.boolean(),
});

export async function uploadContractDocument(
  db: Database,
  actor: Actor,
  contractId: string,
  raw: { title: unknown; kind: unknown; visibleToOwner: unknown; bytes: Uint8Array; originalName: string },
): Promise<{ id: string }> {
  requirePermission(actor, "rentals.manage");
  const input = uploadSchema.parse({ title: raw.title, kind: raw.kind, visibleToOwner: raw.visibleToOwner === true || raw.visibleToOwner === "on" });
  if (!raw.bytes.length) throw invalid("Elegí un archivo");
  if (raw.bytes.length > MAX_BYTES) throw invalid("El archivo supera los 25 MB");
  const contentType = sniffContentType(raw.bytes);
  if (!contentType || !ALLOWED.has(contentType)) throw invalid("Formato no permitido: subí PDF, JPG, PNG o WebP");
  const contract = await db.selectFrom("rental_contracts").select(["id"]).where("id", "=", contractId).executeTakeFirst();
  if (!contract) throw notFound("Contrato");

  const driver = storage();
  const bucket = driver.bucketFor("private");
  const key = newStorageKey(`contracts/${contractId}`, ALLOWED_UPLOADS[contentType]!.ext);
  await driver.put(bucket, key, raw.bytes, contentType);
  try {
    return await db.transaction().execute(async (trx) => {
      const file = await trx
        .insertInto("files")
        .values({
          storage_driver: driver.name,
          bucket,
          storage_key: key,
          content_type: contentType,
          size_bytes: raw.bytes.length,
          checksum_sha256: sha256(raw.bytes),
          visibility: "private",
          original_name: raw.originalName.slice(0, 200),
          uploaded_by: actorUserId(actor),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const doc = await trx
        .insertInto("rental_contract_documents")
        .values({ contract_id: contractId, file_id: file.id, kind: input.kind, title: input.title, visible_to_owner: input.visibleToOwner, uploaded_by: actorUserId(actor) })
        .returning("id")
        .executeTakeFirstOrThrow();
      await audit(trx, actor, {
        action: "RENTAL_DOCUMENT_UPLOADED",
        entityType: "rental_contract",
        entityId: contractId,
        after: { documentId: doc.id, title: input.title, kind: input.kind, visibleToOwner: input.visibleToOwner, contentType, size: raw.bytes.length },
      });
      return { id: doc.id };
    });
  } catch (e) {
    await driver.remove(bucket, key).catch((err) => log.error("rentals.document_orphan_cleanup_failed", { key, ...errorFields(err) }));
    throw e;
  }
}

export async function setDocumentVisibility(db: Database, actor: Actor, documentId: string, visible: boolean): Promise<void> {
  requirePermission(actor, "rentals.manage");
  await db.transaction().execute(async (trx) => {
    const d = await trx.selectFrom("rental_contract_documents").select(["id", "contract_id", "visible_to_owner", "deleted_at"]).where("id", "=", documentId).forUpdate().executeTakeFirst();
    if (!d || d.deleted_at) throw notFound("Documento");
    if (d.visible_to_owner === visible) return;
    await trx.updateTable("rental_contract_documents").set({ visible_to_owner: visible }).where("id", "=", documentId).execute();
    await audit(trx, actor, { action: "RENTAL_DOCUMENT_VISIBILITY", entityType: "rental_contract", entityId: d.contract_id, before: { documentId, visibleToOwner: d.visible_to_owner }, after: { documentId, visibleToOwner: visible } });
  });
}

export async function deleteContractDocument(db: Database, actor: Actor, documentId: string): Promise<void> {
  requirePermission(actor, "rentals.manage");
  await db.transaction().execute(async (trx) => {
    const d = await trx.selectFrom("rental_contract_documents").select(["id", "contract_id", "title", "deleted_at"]).where("id", "=", documentId).forUpdate().executeTakeFirst();
    if (!d) throw notFound("Documento");
    if (d.deleted_at) throw conflict("El documento ya fue eliminado");
    await trx.updateTable("rental_contract_documents").set({ deleted_at: new Date() }).where("id", "=", documentId).execute();
    await audit(trx, actor, { action: "RENTAL_DOCUMENT_DELETED", entityType: "rental_contract", entityId: d.contract_id, before: { documentId, title: d.title } });
  });
}

export type FileRef = { storage_driver: string; bucket: string; storage_key: string; content_type: string; original_name: string | null; id: string };

/** Respuesta de descarga: redirección a URL firmada (S3, 5 minutos) o bytes servidos por la app (local). */
export async function fileDownloadResponse(file: FileRef, filename: string): Promise<Response> {
  const driver = storage();
  const safeName = filename.replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, "_").slice(0, 120) || "documento";
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  };
  if (driver.name === "s3") {
    const url = await driver.url(file.bucket, file.storage_key, "private", file.id, 300);
    return new Response(null, { status: 302, headers: { ...headers, location: url } });
  }
  const bytes = await driver.get(file.bucket, file.storage_key);
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { ...headers, "content-type": file.content_type } });
}

/** Documento de contrato para el equipo (rentals.read). */
export async function staffContractDocument(db: Database, actor: Actor, documentId: string) {
  requirePermission(actor, "rentals.read");
  const row = await db
    .selectFrom("rental_contract_documents as d")
    .innerJoin("files as f", "f.id", "d.file_id")
    .select(["f.id", "f.storage_driver", "f.bucket", "f.storage_key", "f.content_type", "f.original_name", "d.title"])
    .where("d.id", "=", documentId)
    .where("d.deleted_at", "is", null)
    .where("f.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) throw notFound("Documento");
  return row;
}
