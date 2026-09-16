/** Estado de integraciones, logs recientes y feature flags (editables con `integrations.manage`). */
import { z } from "zod";
import { type Database } from "../db";
import { audit } from "../audit";
import { requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { resetFlagCache } from "../flags";

export async function listIntegrations(db: Database, actor: Actor) {
  requirePermission(actor, "integrations.read");
  // `config` nunca contiene secretos, pero no se muestra: no aporta a la operación.
  return db
    .selectFrom("integrations")
    .select(["key", "name", "category", "status", "consecutive_failures", "circuit_open_until", "last_ok_at", "last_error_at", "last_error", "updated_at"])
    .orderBy("category")
    .orderBy("name")
    .execute();
}

export async function listIntegrationLogs(db: Database, actor: Actor, opts: { integrationKey?: string; status?: string; limit?: number } = {}) {
  requirePermission(actor, "integrations.read");
  let q = db
    .selectFrom("integration_logs")
    .select(["id", "integration_key", "operation", "entity_type", "entity_id", "status", "http_status", "duration_ms", "error", "request_id", "created_at"]);
  if (opts.integrationKey && /^[a-z0-9_]{2,40}$/.test(opts.integrationKey)) q = q.where("integration_key", "=", opts.integrationKey);
  if (opts.status && ["ok", "error", "skipped", "retry"].includes(opts.status)) q = q.where("status", "=", opts.status);
  return q.orderBy("created_at", "desc").orderBy("id", "desc").limit(Math.min(200, opts.limit ?? 50)).execute();
}

export async function listFeatureFlags(db: Database, actor: Actor) {
  requirePermission(actor, "integrations.read");
  return db
    .selectFrom("feature_flags as f")
    .leftJoin("users as u", "u.id", "f.updated_by")
    .select(["f.key", "f.enabled", "f.description", "f.updated_at", "u.full_name as updated_by_name"])
    .orderBy("f.key")
    .execute();
}

const flagKey = z.string().regex(/^[a-z0-9_.]{2,80}$/);

export async function setFeatureFlag(db: Database, actor: Actor, key: string, enabled: boolean): Promise<void> {
  requirePermission(actor, "integrations.manage");
  if (!flagKey.safeParse(key).success) throw notFound("Feature flag");
  await db.transaction().execute(async (trx) => {
    const flag = await trx.selectFrom("feature_flags").select(["key", "enabled"]).where("key", "=", key).forUpdate().executeTakeFirst();
    if (!flag) throw notFound("Feature flag");
    if (flag.enabled === enabled) return;
    await trx
      .updateTable("feature_flags")
      .set({ enabled, updated_at: new Date(), updated_by: actor.kind === "staff" ? actor.userId : null })
      .where("key", "=", key)
      .execute();
    await audit(trx, actor, { action: "FEATURE_FLAG_CHANGED", entityType: "feature_flag", entityId: key, before: { enabled: flag.enabled }, after: { enabled } });
  });
  // Esta instancia lo ve al instante; las demás al vencer su cache (15 s).
  resetFlagCache();
}
