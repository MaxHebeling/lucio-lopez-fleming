/**
 * Tablero: indicadores reales desde la base, cada bloque condicionado a los permisos del actor
 * (null = el actor no puede verlo; la UI no muestra el bloque). Nada se estima ni se completa.
 */
import { z } from "zod";
import { sql, type Database } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { parseInput } from "../validate";

const TZ = "America/Argentina/Salta";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dashboardFiltersSchema = z.object({
  branchId: z.uuid().optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

function todayInSalta(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function getDashboard(db: Database, actor: Actor, raw: unknown) {
  requirePermission(actor, "dashboard.read");
  const f = parseInput(dashboardFiltersSchema, raw ?? {});
  let from = f.from ?? todayInSalta(-29);
  let to = f.to ?? todayInSalta(0);
  if (from > to) [from, to] = [to, from];
  const fromTs = sql<Date>`(${from}::date)::timestamp at time zone ${TZ}`;
  const toTs = sql<Date>`((${to}::date) + 1)::timestamp at time zone ${TZ}`;
  const branch = f.branchId ?? null;
  const userId = actor.kind === "staff" ? actor.userId : null;

  const properties = can(actor, "properties.read")
    ? (async () => {
        const rows = await sql<{ status: string; n: number; published: number }>`
          select status, count(*)::int as n, count(*) filter (where is_published)::int as published
            from properties where deleted_at is null ${branch ? sql`and branch_id = ${branch}` : sql``}
           group by status`.execute(db);
        const created = await sql<{ n: number }>`select count(*)::int as n from properties
          where deleted_at is null and created_at >= ${fromTs} and created_at < ${toTs} ${branch ? sql`and branch_id = ${branch}` : sql``}`.execute(db);
        return {
          byStatus: rows.rows.map((r) => ({ status: r.status, n: r.n })),
          published: rows.rows.reduce((s, r) => s + r.published, 0),
          total: rows.rows.reduce((s, r) => s + r.n, 0),
          createdInRange: created.rows[0]?.n ?? 0,
        };
      })()
    : null;

  const leadsScope = can(actor, "leads.read_all") ? "all" : can(actor, "leads.read_own") ? "own" : null;
  const leads = leadsScope
    ? (async () => {
        const slaRow = await db.selectFrom("settings").select("value").where("key", "=", "leads.first_response_sla_minutes").executeTakeFirst();
        const sla = Number(slaRow?.value);
        const slaMinutes = Number.isInteger(sla) && sla > 0 ? sla : 120;
        const scope = sql`deleted_at is null ${branch ? sql`and branch_id = ${branch}` : sql``} ${leadsScope === "own" ? sql`and assigned_user_id = ${userId}` : sql``}`;
        const r = await sql<{ new_in_range: number; unanswered: number; over_sla: number; unassigned: number }>`
          select
            count(*) filter (where created_at >= ${fromTs} and created_at < ${toTs})::int as new_in_range,
            count(*) filter (where first_response_at is null and status in ('new', 'contacted', 'qualified'))::int as unanswered,
            count(*) filter (where first_response_at is null and status in ('new', 'contacted', 'qualified')
                             and created_at < now() - make_interval(mins => ${slaMinutes}))::int as over_sla,
            count(*) filter (where assigned_user_id is null and status = 'new')::int as unassigned
          from leads where ${scope}`.execute(db);
        const row = r.rows[0] ?? { new_in_range: 0, unanswered: 0, over_sla: 0, unassigned: 0 };
        return { scope: leadsScope, slaMinutes, newInRange: row.new_in_range, unanswered: row.unanswered, overSla: row.over_sla, unassigned: leadsScope === "all" ? row.unassigned : null };
      })()
    : null;

  const visitsScope = can(actor, "agenda.read_all") ? "all" : can(actor, "agenda.manage") ? "own" : null;
  const visits = visitsScope
    ? (async () => {
        let q = db
          .selectFrom("appointments as a")
          .innerJoin("users as u", "u.id", "a.assigned_user_id")
          .leftJoin("properties as p", "p.id", "a.property_id")
          .where("a.kind", "=", "visit")
          .where("a.status", "in", ["scheduled", "confirmed"])
          .where("a.starts_at", ">=", sql<Date>`now()`)
          .where("a.starts_at", "<", sql<Date>`now() + interval '7 days'`);
        if (branch) q = q.where("p.branch_id", "=", branch);
        if (visitsScope === "own" && userId) q = q.where("a.assigned_user_id", "=", userId);
        const [count, items] = await Promise.all([
          q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst(),
          q.select(["a.id", "a.title", "a.starts_at", "a.status", "u.full_name as assigned_name", "p.id as property_id", "p.code as property_code", "p.title as property_title"]).orderBy("a.starts_at").limit(6).execute(),
        ]);
        return { scope: visitsScope, count: count?.n ?? 0, items };
      })()
    : null;

  const tasks = can(actor, "tasks.manage") && userId
    ? (async () => {
        const r = await sql<{ mine: number; team: number }>`
          select count(*) filter (where assigned_user_id = ${userId})::int as mine, count(*)::int as team
            from tasks where status = 'open' and due_at < now()`.execute(db);
        const items = await db
          .selectFrom("tasks")
          .select(["id", "title", "due_at", "priority", "entity_type", "entity_id"])
          .where("status", "=", "open")
          .where("due_at", "<", sql<Date>`now()`)
          .where("assigned_user_id", "=", userId)
          .orderBy("due_at")
          .limit(5)
          .execute();
        return { mine: r.rows[0]?.mine ?? 0, team: can(actor, "agenda.read_all") ? (r.rows[0]?.team ?? 0) : null, items };
      })()
    : null;

  const contracts = can(actor, "rentals.read")
    ? (async () => {
        const days = await db.selectFrom("settings").select("value").where("key", "=", "rentals.expiring_notice_days").executeTakeFirst();
        const n = Number(days?.value);
        const noticeDays = Number.isInteger(n) && n > 0 ? n : 60;
        let q = db
          .selectFrom("rental_contracts as c")
          .innerJoin("properties as p", "p.id", "c.property_id")
          .where("c.status", "=", "active")
          .where("c.end_date", ">=", sql<string>`current_date`)
          .where("c.end_date", "<=", sql<string>`current_date + ${noticeDays}::int`);
        if (branch) q = q.where("p.branch_id", "=", branch);
        const [count, items] = await Promise.all([
          q.select(sql<number>`count(*)::int`.as("n")).executeTakeFirst(),
          q.select(["c.id", "c.code", "c.end_date", "p.code as property_code", "p.title as property_title"]).orderBy("c.end_date").limit(5).execute(),
        ]);
        return { noticeDays, count: count?.n ?? 0, items };
      })()
    : null;

  const jobs = can(actor, "automations.read")
    ? sql<{ dead: number; failed: number; queued_late: number }>`
        select count(*) filter (where status = 'dead')::int as dead,
               count(*) filter (where status = 'failed')::int as failed,
               count(*) filter (where status = 'queued' and run_at < now() - interval '10 minutes')::int as queued_late
          from jobs where status in ('dead', 'failed', 'queued')`.execute(db).then((r) => r.rows[0] ?? { dead: 0, failed: 0, queued_late: 0 })
    : null;

  const integrations = can(actor, "integrations.read")
    ? db
        .selectFrom("integrations")
        .select(["key", "name", "status", "last_error_at", "last_error", "circuit_open_until"])
        .where((eb) => eb.or([eb("status", "in", ["error", "degraded"]), eb("circuit_open_until", ">", sql<Date>`now()`)]))
        .orderBy("last_error_at", "desc")
        .execute()
    : null;

  const migration = can(actor, "migration.read")
    ? sql<{ open: number; errors: number }>`select count(*)::int as open, count(*) filter (where severity = 'error')::int as errors
        from migration_warnings where status = 'open'`.execute(db).then((r) => r.rows[0] ?? { open: 0, errors: 0 })
    : null;

  const [p, l, v, t, c, j, i, m] = await Promise.all([properties, leads, visits, tasks, contracts, jobs, integrations, migration]);
  return { range: { from, to }, branchId: branch, properties: p, leads: l, visits: v, tasks: t, contracts: c, jobs: j, integrations: i, migration: m };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
