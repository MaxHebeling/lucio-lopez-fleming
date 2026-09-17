/**
 * Autorización para servir archivos por /api/files/[id].
 * Públicos: sin sesión. Privados: según la entidad que referencia el archivo.
 * Un archivo privado que no pertenece a ninguna entidad conocida no se sirve a nadie (deny by default).
 */
import { z } from "zod";
import { sql, type Executor } from "../db";
import { can, type Actor } from "../auth/actor";
import { isReportVisibleToOwner } from "../owners/visibility";

export type ServableFile = {
  id: string;
  storage_driver: string;
  bucket: string;
  storage_key: string;
  content_type: string;
  size_bytes: string;
  checksum_sha256: string | null;
  visibility: "public" | "private";
  original_name: string | null;
};

export type FileAccess = { ok: true; file: ServableFile } | { ok: false; reason: "not_found" | "unauthenticated" | "forbidden" };

export async function authorizeFileAccess(db: Executor, actor: Actor, fileId: string): Promise<FileAccess> {
  if (!z.uuid().safeParse(fileId).success) return { ok: false, reason: "not_found" };
  const file = await db
    .selectFrom("files")
    .select(["id", "storage_driver", "bucket", "storage_key", "content_type", "size_bytes", "checksum_sha256", "visibility", "original_name"])
    .where("id", "=", fileId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!file) return { ok: false, reason: "not_found" };
  const servable = file as ServableFile;
  if (file.visibility === "public") return { ok: true, file: servable };
  if (actor.kind === "anonymous") return { ok: false, reason: "unauthenticated" };

  const refs = await sql<{ entity: string; property_id: string | null; owner_contact_id: string | null; visible_to_owner: boolean | null; report_status: string | null }>`
    select 'property_document' as entity, d.property_id, null::uuid as owner_contact_id, d.visible_to_owner, null::text as report_status
      from property_documents d where d.file_id = ${fileId} and d.deleted_at is null
    union all
    select 'property_media', m.property_id, null, null, null
      from property_media m where (m.file_id = ${fileId} or m.original_file_id = ${fileId}) and m.deleted_at is null
    union all
    select 'owner_report', r.property_id, r.owner_contact_id, null, r.status from owner_reports r where r.file_id = ${fileId}
    union all
    select 'social_asset', null, null, null, null from social_assets s where s.file_id = ${fileId}`.execute(db);

  for (const ref of refs.rows) {
    if (actor.kind === "staff" || actor.kind === "system") {
      const needed = { property_document: "properties.read_private", property_media: "properties.read", owner_report: "reports.read", social_asset: "marketing.read" }[ref.entity];
      if (needed && can(actor, needed)) return { ok: true, file: servable };
    } else if (actor.kind === "owner") {
      // Mismo criterio que el portal: el PDF de un informe no enviado (generado, en cola, fallido) no se descarga.
      if (ref.entity === "owner_report" && ref.owner_contact_id === actor.contactId && ref.report_status && isReportVisibleToOwner(ref.report_status)) return { ok: true, file: servable };
      if (ref.entity === "property_document" && ref.visible_to_owner && ref.property_id) {
        const owns = await db.selectFrom("property_owners").select("property_id").where("property_id", "=", ref.property_id).where("contact_id", "=", actor.contactId).executeTakeFirst();
        if (owns) return { ok: true, file: servable };
      }
    }
  }
  return { ok: false, reason: "forbidden" };
}
