/**
 * Revisión humana de la migración desde el sitio anterior. Lee lo que deja el importador
 * (migration_runs / migration_records / migration_warnings) y registra decisiones auditadas.
 * Funciona con tablas vacías: nada se infiere ni se completa.
 */
import { z } from "zod";
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, notFound } from "../errors";
import { pageWindow, toPage, type Page } from "../pagination";
import { parseInput } from "../validate";

export const MIGRATION_STAGES = ["discovered", "extracted", "normalized", "validated", "imported", "media_verified", "review_required", "verified", "published", "failed", "skipped_protected"] as const;

export async function migrationSummary(db: Database, actor: Actor) {
  requirePermission(actor, "migration.read");
  const [runs, stages, warnings] = await Promise.all([
    db.selectFrom("migration_runs").select(["id", "source", "status", "stats", "triggered_by", "error", "started_at", "finished_at"]).orderBy("started_at", "desc").limit(10).execute(),
    sql<{ source: string; stage: string; n: number }>`select source, stage, count(*)::int as n from migration_records group by source, stage order by source, stage`.execute(db),
    sql<{ severity: string; status: string; n: number }>`select severity, status, count(*)::int as n from migration_warnings group by severity, status`.execute(db),
  ]);
  return { runs, stages: stages.rows, warnings: warnings.rows };
}

export const warningFiltersSchema = z.object({
  severity: z.enum(["info", "warning", "error"]).optional().catch(undefined),
  status: z.enum(["open", "resolved", "dismissed"]).optional().catch(undefined),
  code: z.string().regex(/^[a-z_]{3,60}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});

export type WarningRow = {
  id: string;
  source: string;
  external_id: string;
  property_id: string | null;
  property_code: number | null;
  property_title: string | null;
  property_verified_at: Date | null;
  record_stage: string | null;
  code: string;
  field: string;
  value_a: string | null;
  value_b: string | null;
  message: string;
  severity: string;
  status: string;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  created_at: Date;
};

export async function listMigrationWarnings(db: Database, actor: Actor, raw: unknown): Promise<Page<WarningRow>> {
  requirePermission(actor, "migration.read");
  const f = parseInput(warningFiltersSchema, raw ?? {});
  const win = pageWindow(f.page, 50);
  let q = db
    .selectFrom("migration_warnings as w")
    .leftJoin("properties as p", "p.id", "w.property_id")
    .leftJoin("users as u", "u.id", "w.reviewed_by")
    .leftJoin("migration_records as r", (j) => j.onRef("r.source", "=", "w.source").onRef("r.external_id", "=", "w.external_id"));
  q = q.where("w.status", "=", f.status ?? "open");
  if (f.severity) q = q.where("w.severity", "=", f.severity);
  if (f.code) q = q.where("w.code", "=", f.code);
  const total = (await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst())?.n ?? 0;
  const items = await q
    .select([
      "w.id", "w.source", "w.external_id", "w.property_id", "p.code as property_code", "p.title as property_title", "p.manually_verified_at as property_verified_at",
      "r.stage as record_stage", "w.code", "w.field", "w.value_a", "w.value_b", "w.message", "w.severity", "w.status", "u.full_name as reviewed_by_name", "w.reviewed_at", "w.created_at",
    ])
    .orderBy(sql`array_position(array['error','warning','info'], w.severity)`)
    .orderBy("w.created_at", "desc")
    .orderBy("w.id")
    .limit(win.limit)
    .offset(win.offset)
    .execute();
  return toPage(items as WarningRow[], total, win);
}

export async function warningCodes(db: Database, actor: Actor): Promise<string[]> {
  requirePermission(actor, "migration.read");
  const r = await sql<{ code: string }>`select distinct code from migration_warnings order by code limit 300`.execute(db);
  return r.rows.map((x) => x.code);
}

export async function reviewMigrationWarning(db: Database, actor: Actor, id: string, decision: "resolved" | "dismissed"): Promise<void> {
  requirePermission(actor, "migration.review");
  if (!z.uuid().safeParse(id).success) throw notFound("Advertencia");
  if (decision !== "resolved" && decision !== "dismissed") throw conflict("Decisión inválida");
  await db.transaction().execute(async (trx) => {
    const w = await trx.selectFrom("migration_warnings").select(["id", "status", "code", "field", "source", "external_id", "property_id"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!w) throw notFound("Advertencia");
    if (w.status === decision) return;
    await trx.updateTable("migration_warnings").set({ status: decision, reviewed_by: actorUserId(actor), reviewed_at: new Date() }).where("id", "=", id).execute();
    await audit(trx, actor, {
      action: decision === "resolved" ? "MIGRATION_WARNING_RESOLVED" : "MIGRATION_WARNING_DISMISSED",
      entityType: "migration_warning",
      entityId: id,
      before: { status: w.status },
      after: { status: decision },
      metadata: { code: w.code, field: w.field, source: w.source, externalId: w.external_id, propertyId: w.property_id },
    });
  });
}

/** Marca una propiedad migrada como verificada por una persona y deja su registro de migración en `verified`. */
export async function markPropertyVerified(db: Database, actor: Actor, propertyId: string): Promise<{ records: number }> {
  requirePermission(actor, "migration.review");
  if (!z.uuid().safeParse(propertyId).success) throw notFound("Propiedad");
  return db.transaction().execute(async (trx) => {
    const p = await trx.selectFrom("properties").select(["id", "code", "manually_verified_at", "source"]).where("id", "=", propertyId).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
    if (!p) throw notFound("Propiedad");
    const now = new Date();
    await trx.updateTable("properties").set({ manually_verified_at: now, manually_verified_by: actorUserId(actor) }).where("id", "=", propertyId).execute();
    const r = await trx
      .updateTable("migration_records")
      .set({ stage: "verified" })
      .where("property_id", "=", propertyId)
      .where("stage", "not in", ["verified", "published"])
      .executeTakeFirst();
    const records = Number(r.numUpdatedRows);
    await audit(trx, actor, { action: "PROPERTY_VERIFIED", entityType: "property", entityId: propertyId, before: { manually_verified_at: p.manually_verified_at }, after: { manually_verified_at: now.toISOString(), recordsVerified: records }, metadata: { code: p.code, source: p.source } });
    await emitEvent(trx, actor, { type: "property.updated", aggregateType: "property", aggregateId: propertyId, payload: { fields: ["manually_verified_at"], link: `/crm/propiedades/${propertyId}` } });
    return { records };
  });
}
