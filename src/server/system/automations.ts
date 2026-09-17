/** Automatizaciones: definiciones, ejecuciones recientes y errores. Activar/desactivar con `automations.manage`. */
import { z } from "zod";
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";

export async function listAutomations(db: Database, actor: Actor) {
  requirePermission(actor, "automations.read");
  return db
    .selectFrom("automation_definitions as d")
    .select([
      "d.id", "d.key", "d.name", "d.description", "d.trigger_event", "d.conditions", "d.actions", "d.is_enabled", "d.is_system", "d.version", "d.updated_at",
      sql<number>`(select count(*)::int from automation_runs r where r.automation_id = d.id and r.started_at > now() - interval '7 days')`.as("runs_7d"),
      sql<number>`(select count(*)::int from automation_runs r where r.automation_id = d.id and r.status = 'failed' and r.started_at > now() - interval '7 days')`.as("failed_7d"),
      sql<Date | null>`(select max(r.started_at) from automation_runs r where r.automation_id = d.id)`.as("last_run_at"),
    ])
    .orderBy("d.is_enabled", "desc")
    .orderBy("d.name")
    .execute();
}

export async function listAutomationRuns(db: Database, actor: Actor, opts: { status?: string; automationId?: string; limit?: number } = {}) {
  requirePermission(actor, "automations.read");
  let q = db
    .selectFrom("automation_runs as r")
    .innerJoin("automation_definitions as d", "d.id", "r.automation_id")
    .innerJoin("domain_events as e", "e.id", "r.trigger_event_id")
    .select(["r.id", "r.status", "r.attempt", "r.error", "r.started_at", "r.finished_at", "r.automation_version", "d.key as automation_key", "d.name as automation_name", "e.event_type", "e.aggregate_type", "e.aggregate_id"]);
  if (opts.status && ["running", "succeeded", "failed", "skipped"].includes(opts.status)) q = q.where("r.status", "=", opts.status);
  if (opts.automationId && z.uuid().safeParse(opts.automationId).success) q = q.where("r.automation_id", "=", opts.automationId);
  return q.orderBy("r.started_at", "desc").limit(Math.min(200, opts.limit ?? 50)).execute();
}

export async function setAutomationEnabled(db: Database, actor: Actor, id: string, enabled: boolean): Promise<void> {
  requirePermission(actor, "automations.manage");
  if (!z.uuid().safeParse(id).success) throw notFound("Automatización");
  await db.transaction().execute(async (trx) => {
    const d = await trx.selectFrom("automation_definitions").select(["id", "key", "is_enabled"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!d) throw notFound("Automatización");
    if (d.is_enabled === enabled) return;
    await trx.updateTable("automation_definitions").set({ is_enabled: enabled }).where("id", "=", id).execute();
    await audit(trx, actor, { action: enabled ? "AUTOMATION_ENABLED" : "AUTOMATION_DISABLED", entityType: "automation", entityId: id, before: { is_enabled: d.is_enabled }, after: { is_enabled: enabled }, metadata: { key: d.key } });
  });
}
