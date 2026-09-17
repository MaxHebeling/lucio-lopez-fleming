/**
 * Consultas de dirección (Executive AI). Todas filtran por la organización del actor, solo leen, no usan datos de
 * ubicación de agentes (appointment_checkins) ni texto libre de clientes, y devuelven cifras crudas: las definiciones
 * y el formato están en las herramientas (domains/executive-management.ts) y en metrics.ts.
 */
import "server-only";
import { sql, type Executor } from "../../db";
import type { Range } from "./metrics";

const both = (cur: Range, prev: Range) => ({ lo: prev.from.getTime() < cur.from.getTime() ? prev.from : cur.from, hi: cur.to.getTime() > prev.to.getTime() ? cur.to : prev.to });

export async function leadsBySource(db: Executor, org: string, cur: Range, prev: Range) {
  const { lo, hi } = both(cur, prev);
  const r = await sql<{ source: string; cur: number; prev: number }>`
    select coalesce(ls.name, l.source_key) as source,
           count(*) filter (where l.created_at >= ${cur.from} and l.created_at < ${cur.to})::int as cur,
           count(*) filter (where l.created_at >= ${prev.from} and l.created_at < ${prev.to})::int as prev
      from leads l left join lead_sources ls on ls.key = l.source_key
     where l.organization_id = ${org} and l.deleted_at is null and l.created_at >= ${lo} and l.created_at < ${hi}
     group by 1 order by 2 desc, 3 desc`.execute(db);
  return r.rows;
}

export async function firstContactHours(db: Executor, org: string, range: Range) {
  const [contacted, pending] = await Promise.all([
    sql<{ hours: number; agent_id: string | null; agent: string | null }>`
      select extract(epoch from (l.first_response_at - l.created_at)) / 3600.0 as hours, l.assigned_user_id as agent_id, u.full_name as agent
        from leads l left join users u on u.id = l.assigned_user_id
       where l.organization_id = ${org} and l.deleted_at is null and l.created_at >= ${range.from} and l.created_at < ${range.to}
         and l.first_response_at is not null and l.first_response_at >= l.created_at`.execute(db),
    sql<{ created: number; uncontacted: number; over24: number }>`
      select count(*)::int as created,
             count(*) filter (where l.first_response_at is null and l.status in ('new', 'contacted', 'qualified'))::int as uncontacted,
             count(*) filter (where l.first_response_at is null and l.status in ('new', 'contacted', 'qualified') and l.created_at < now() - interval '24 hours')::int as over24
        from leads l where l.organization_id = ${org} and l.deleted_at is null and l.created_at >= ${range.from} and l.created_at < ${range.to}`.execute(db),
  ]);
  return { hours: contacted.rows.map((r) => ({ ...r, hours: Number(r.hours) })), ...(pending.rows[0] ?? { created: 0, uncontacted: 0, over24: 0 }) };
}

export async function visitCounts(db: Executor, org: string, range: Range) {
  const r = await sql<{ scheduled: number; completed: number; no_show: number; cancelled: number; without_report: number }>`
    select count(*) filter (where a.status <> 'cancelled')::int as scheduled,
           count(*) filter (where a.status = 'completed')::int as completed,
           count(*) filter (where a.status = 'no_show')::int as no_show,
           count(*) filter (where a.status = 'cancelled')::int as cancelled,
           count(*) filter (where a.status = 'completed' and not exists (select 1 from appointment_reports r where r.appointment_id = a.id and r.status = 'confirmed'))::int as without_report
      from appointments a join users u on u.id = a.assigned_user_id
     where u.organization_id = ${org} and a.kind = 'visit' and a.starts_at >= ${range.from} and a.starts_at < ${range.to}`.execute(db);
  return r.rows[0] ?? { scheduled: 0, completed: 0, no_show: 0, cancelled: 0, without_report: 0 };
}

export async function opportunityCounts(db: Executor, org: string, range: Range) {
  const r = await sql<{ created: number; won: number; lost: number }>`
    select count(*) filter (where o.created_at >= ${range.from} and o.created_at < ${range.to})::int as created,
           count(*) filter (where o.status = 'won' and o.closed_at >= ${range.from} and o.closed_at < ${range.to})::int as won,
           count(*) filter (where o.status = 'lost' and o.closed_at >= ${range.from} and o.closed_at < ${range.to})::int as lost
      from opportunities o where o.organization_id = ${org} and o.deleted_at is null
       and (o.created_at >= ${range.from} or o.closed_at >= ${range.from})`.execute(db);
  return r.rows[0] ?? { created: 0, won: 0, lost: 0 };
}

export async function leadFunnel(db: Executor, org: string, range: Range) {
  const r = await sql<{ leads: number; with_visit: number; with_opportunity: number; visit_and_opportunity: number }>`
    with cohort as (
      select l.id, l.contact_id, l.created_at from leads l
       where l.organization_id = ${org} and l.deleted_at is null and l.created_at >= ${range.from} and l.created_at < ${range.to}
         and coalesce(l.operation_interest, '') not in ('appraisal', 'sell_my_property')
    ), marks as (
      select c.id,
             exists (select 1 from appointments a where a.contact_id = c.contact_id and a.kind = 'visit' and a.status <> 'cancelled' and a.created_at >= c.created_at) as visit,
             exists (select 1 from opportunities o where (o.lead_id = c.id or o.contact_id = c.contact_id) and o.organization_id = ${org} and o.deleted_at is null and o.created_at >= c.created_at - interval '1 minute') as opp
        from cohort c
    )
    select count(*)::int as leads, count(*) filter (where visit)::int as with_visit, count(*) filter (where opp)::int as with_opportunity,
           count(*) filter (where visit and opp)::int as visit_and_opportunity from marks`.execute(db);
  return r.rows[0] ?? { leads: 0, with_visit: 0, with_opportunity: 0, visit_and_opportunity: 0 };
}

export async function propertyInterest(db: Executor, org: string, range: Range, limit = 10) {
  const r = await sql<{ id: string; code: number; title: string; inquiries: number; views: number; tours: number }>`
    with inq as (
      select property_id, count(*)::int as n from leads
       where organization_id = ${org} and deleted_at is null and property_id is not null and created_at >= ${range.from} and created_at < ${range.to}
       group by 1
    ), vw as (
      select property_id, count(distinct session_key)::int as n from site_events
       where name = 'property_viewed' and property_id is not null and occurred_at >= ${range.from} and occurred_at < ${range.to} group by 1
    ), tr as (
      select property_id, count(distinct session_key)::int as n from site_events
       where name = 'virtual_tour_opened' and property_id is not null and occurred_at >= ${range.from} and occurred_at < ${range.to} group by 1
    )
    select p.id, p.code, p.title, coalesce(inq.n, 0) as inquiries, coalesce(vw.n, 0) as views, coalesce(tr.n, 0) as tours
      from properties p left join inq on inq.property_id = p.id left join vw on vw.property_id = p.id left join tr on tr.property_id = p.id
     where p.organization_id = ${org} and not p.is_demo and p.deleted_at is null and (inq.n > 0 or vw.n > 0 or tr.n > 0)
     order by inquiries desc, views desc, tours desc, p.code limit ${limit}`.execute(db);
  return r.rows;
}

export async function overdueByAgent(db: Executor, org: string) {
  const [tasks, visits, unassigned] = await Promise.all([
    sql<{ id: string; agent: string; total: number; follow_ups: number; oldest: Date }>`
      select u.id, u.full_name as agent, count(*)::int as total, count(*) filter (where t.kind = 'follow_up')::int as follow_ups, min(t.due_at) as oldest
        from tasks t join users u on u.id = t.assigned_user_id
       where u.organization_id = ${org} and t.status = 'open' and t.due_at < now()
       group by u.id order by total desc, oldest limit 20`.execute(db),
    sql<{ id: string; agent: string; n: number }>`
      select u.id, u.full_name as agent, count(*)::int as n
        from appointments a join users u on u.id = a.assigned_user_id
       where u.organization_id = ${org} and a.kind = 'visit' and a.status = 'completed' and a.follow_up_task_id is null
         and coalesce(a.finished_at, a.ends_at) >= now() - interval '14 days' and coalesce(a.finished_at, a.ends_at) < now() - interval '24 hours'
         and not exists (select 1 from tasks t where t.entity_type = 'appointment' and t.entity_id = a.id)
       group by u.id order by n desc limit 20`.execute(db),
    sql<{ n: number }>`
      select count(*)::int as n from tasks t join users c on c.id = t.created_by
       where c.organization_id = ${org} and t.assigned_user_id is null and t.status = 'open' and t.due_at < now()`.execute(db),
  ]);
  return { tasks: tasks.rows, visits: visits.rows, unassigned: unassigned.rows[0]?.n ?? 0 };
}

export async function bottlenecks(db: Executor, org: string) {
  const [stages, visits, leads, suggestions] = await Promise.all([
    sql<{ stage: string; n: number; avg_days: number; median_days: number; max_days: number }>`
      select s.name as stage, count(*)::int as n,
             avg(extract(epoch from (now() - o.stage_entered_at)) / 86400.0) as avg_days,
             percentile_cont(0.5) within group (order by extract(epoch from (now() - o.stage_entered_at)) / 86400.0) as median_days,
             max(extract(epoch from (now() - o.stage_entered_at)) / 86400.0) as max_days
        from opportunities o join pipeline_stages s on s.id = o.stage_id
       where o.organization_id = ${org} and o.deleted_at is null and o.status = 'open'
       group by s.id, s.name order by median_days desc`.execute(db),
    sql<{ n: number; oldest: Date | null }>`
      select count(*)::int as n, min(coalesce(a.finished_at, a.ends_at)) as oldest
        from appointments a join users u on u.id = a.assigned_user_id
       where u.organization_id = ${org} and a.kind = 'visit' and a.status = 'completed'
         and coalesce(a.finished_at, a.ends_at) >= now() - interval '30 days'
         and not exists (select 1 from appointment_reports r where r.appointment_id = a.id and r.status = 'confirmed')`.execute(db),
    sql<{ n: number }>`
      select count(*)::int as n from leads l where l.organization_id = ${org} and l.deleted_at is null and l.first_response_at is null
         and l.status in ('new', 'contacted', 'qualified') and l.created_at < now() - interval '24 hours'`.execute(db),
    sql<{ n: number }>`
      select count(*)::int as n from sales_recommendations r where r.organization_id = ${org} and r.status = 'open' and r.created_at < now() - interval '3 days'`.execute(db),
  ]);
  return {
    stages: stages.rows.map((r) => ({ ...r, avg_days: Number(r.avg_days), median_days: Number(r.median_days), max_days: Number(r.max_days) })),
    visitsWithoutReport: visits.rows[0] ?? { n: 0, oldest: null },
    leadsUncontacted24h: leads.rows[0]?.n ?? 0,
    staleSuggestions: suggestions.rows[0]?.n ?? 0,
  };
}
