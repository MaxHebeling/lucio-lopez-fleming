/** Consulta del registro de auditoría (solo lectura, `audit.read`). */
import { z } from "zod";
import { sql, type Database } from "../db";
import { requirePermission, type Actor } from "../auth/actor";
import { pageWindow, toPage, type Page } from "../pagination";
import { parseInput } from "../validate";

const TZ = "America/Argentina/Salta";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const auditFiltersSchema = z.object({
  entityType: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  entityId: z.string().trim().min(1).max(100).optional().catch(undefined),
  actorId: z.uuid().optional().catch(undefined),
  action: z.string().regex(/^[A-Z_]{3,60}$/).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

export type AuditRow = {
  id: string;
  occurred_at: Date;
  actor_kind: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ip: string | null;
  request_id: string | null;
};

export async function listAuditLogs(db: Database, actor: Actor, raw: unknown): Promise<Page<AuditRow>> {
  requirePermission(actor, "audit.read");
  const f = parseInput(auditFiltersSchema, raw ?? {});
  const win = pageWindow(f.page, 50);
  let q = db.selectFrom("audit_logs as a").leftJoin("users as u", "u.id", "a.actor_user_id");
  if (f.entityType) q = q.where("a.entity_type", "=", f.entityType);
  if (f.entityId) q = q.where("a.entity_id", "=", f.entityId);
  if (f.actorId) q = q.where("a.actor_user_id", "=", f.actorId);
  if (f.action) q = q.where("a.action", "=", f.action);
  if (f.from) q = q.where("a.occurred_at", ">=", sql<Date>`(${f.from}::date)::timestamp at time zone ${TZ}`);
  if (f.to) q = q.where("a.occurred_at", "<", sql<Date>`((${f.to}::date) + 1)::timestamp at time zone ${TZ}`);
  const total = (await q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst())?.n ?? 0;
  const items = await q
    .select(["a.id", "a.occurred_at", "a.actor_kind", "a.actor_user_id", "u.full_name as actor_name", "a.action", "a.entity_type", "a.entity_id", "a.before", "a.after", "a.metadata", sql<string | null>`host(a.ip)`.as("ip"), "a.request_id"])
    .orderBy("a.occurred_at", "desc")
    .orderBy("a.id", "desc")
    .limit(win.limit)
    .offset(win.offset)
    .execute();
  return toPage(items as AuditRow[], total, win);
}

/** Opciones de filtro: tipos de entidad y acciones presentes, y usuarios que aparecen como actores. */
export async function auditFilterOptions(db: Database, actor: Actor) {
  requirePermission(actor, "audit.read");
  const [entityTypes, actions, actors] = await Promise.all([
    sql<{ entity_type: string }>`select distinct entity_type from audit_logs order by entity_type limit 200`.execute(db),
    sql<{ action: string }>`select distinct action from audit_logs order by action limit 500`.execute(db),
    db.selectFrom("users").select(["id", "full_name", "kind"]).where("deleted_at", "is", null).where("kind", "=", "staff").orderBy("full_name").limit(500).execute(),
  ]);
  return { entityTypes: entityTypes.rows.map((r) => r.entity_type), actions: actions.rows.map((r) => r.action), actors };
}
