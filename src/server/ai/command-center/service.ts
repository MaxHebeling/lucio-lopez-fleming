/**
 * Centro de comando (Fase 5, permiso `ai.executive`, flag `ai_executive`): COMPONE lo que ya existe — Resumen de hoy,
 * Tareas sugeridas, anomalías, visitas del día (centro operativo), coincidencias, seguimientos, calidad de fichas y
 * salud de la IA — con links a cada módulo. No reimplementa tableros ni calcula métricas nuevas.
 */
import "server-only";
import { sql, type Database } from "../../db";
import { can, requirePermission, requireStaff, type Actor } from "../../auth/actor";
import { AppError } from "../../errors";
import { isEnabled } from "../../flags";
import { getOpsBoard } from "../../visits/queries";
import { VISIT_PHASE_LABEL, visitPhase, type VisitPhase } from "../../visits/state";
import { budgetStatus, dailyBudgetUsd } from "../budget";
import { listOpenAnomalies } from "../anomalies/service";
import { getDailyBrief } from "../brief/service";
import { overdueByAgent } from "../executive/queries";
import { getManagementSettings, saltaToday } from "../management-settings";
import { SOURCE_LABEL, type SuggestionSource } from "../task-center/rules";
import { suggestionCounts } from "../task-center/service";
import { EXECUTIVE_FLAG } from "../domains/executive-management";

export async function getCommandCenter(db: Database, rawActor: Actor, now = new Date()) {
  requireStaff(rawActor);
  const actor = rawActor;
  requirePermission(actor, "ai.executive");
  if (!(await isEnabled(db, EXECUTIVE_FLAG))) throw new AppError("unavailable", "El Centro de comando está desactivado");
  const org = actor.organizationId;
  const s = await getManagementSettings(db);
  const visitsOn = (await isEnabled(db, "visits_operations")) && can(actor, "visits.monitor");
  const tasksOn = (await isEnabled(db, "ai_task_center")) && (can(actor, "tasks.manage") || can(actor, "tasks.read_all"));
  const usageOn = can(actor, "ai.read_usage");

  const [brief, suggestions, anomalies, board, matches, followUps, quality, aiHealth] = await Promise.all([
    getDailyBrief(db, actor, { now }),
    tasksOn ? suggestionCounts(db, actor, { team: true }, now) : Promise.resolve(null),
    listOpenAnomalies(db, actor, { limit: 8 }),
    visitsOn ? getOpsBoard(db, actor, { date: saltaToday(now) }) : Promise.resolve(null),
    can(actor, "properties.read") && (can(actor, "leads.read_all") || can(actor, "leads.read_own"))
      ? sql<{ id: string; code: number; title: string; candidates: number; recent: boolean }>`
          select p.id, p.code, p.title, count(m.id)::int as candidates, (p.published_at >= now() - interval '7 days') as recent
            from property_matches m join properties p on p.id = m.property_id join contacts c on c.id = m.contact_id
           where p.organization_id = ${org} and c.organization_id = ${org} and m.status = 'candidate' and p.is_published and not p.is_demo and p.deleted_at is null
             and m.computed_at >= now() - interval '7 days'
           group by p.id order by candidates desc, p.code limit 6`.execute(db).then((r) => r.rows)
      : Promise.resolve(null),
    can(actor, "tasks.read_all") ? overdueByAgent(db, org) : Promise.resolve(null),
    can(actor, "properties.read") && (await isEnabled(db, "ai_property_quality"))
      ? sql<{ low: number; medium: number; high: number; none: number; avg: number | null }>`
          select count(*) filter (where q.score < ${s.lowQualityScore})::int as low,
                 count(*) filter (where q.score >= ${s.lowQualityScore} and q.score < 80)::int as medium,
                 count(*) filter (where q.score >= 80)::int as high,
                 count(*) filter (where q.property_id is null)::int as none,
                 round(avg(q.score))::int as avg
            from properties p left join property_quality_reports q on q.property_id = p.id
           where p.organization_id = ${org} and p.is_published and not p.is_demo and p.deleted_at is null`.execute(db).then((r) => r.rows[0] ?? null)
      : Promise.resolve(null),
    usageOn
      ? Promise.all([
          sql<{ requests: number; model_requests: number; errors: number; fallbacks: number; cost_micros: string }>`
            select count(*)::int as requests,
                   count(*) filter (where coalesce(provider, 'anthropic') <> 'deterministic')::int as model_requests,
                   count(*) filter (where status in ('error', 'timeout', 'invalid_output', 'blocked'))::int as errors,
                   count(*) filter (where fallback_reason is not null or status in ('fallback', 'budget_exceeded', 'unavailable', 'rate_limited'))::int as fallbacks,
                   coalesce(sum(cost_usd_micros), 0)::text as cost_micros
              from ai_interactions where created_at >= now() - interval '24 hours' and (organization_id = ${org} or organization_id is null)`.execute(db),
          sql<{ runs: number; failed: number; skipped: number; loop_guard: number }>`
            select count(*)::int as runs, count(*) filter (where r.status = 'failed')::int as failed, count(*) filter (where r.status = 'skipped')::int as skipped,
                   count(*) filter (where r.result ? 'loopGuard')::int as loop_guard
              from automation_runs r join automation_definitions d on d.id = r.automation_id
             where d.key like 'ai\\_%' and r.started_at >= now() - interval '24 hours'`.execute(db),
          db.selectFrom("integrations").select(["status", "last_ok_at"]).where("key", "=", "anthropic").executeTakeFirst(),
          budgetStatus(db),
          dailyBudgetUsd(db),
        ]).then(([u, a, integration, budget, budgetUsd]) => ({ usage: u.rows[0]!, automations: a.rows[0]!, integration: integration ?? null, budgetExhausted: budget.exhausted, spentTodayUsd: budget.spentMicros / 1e6, dailyBudgetUsd: budgetUsd }))
      : Promise.resolve(null),
  ]);

  const phases = board
    ? (Object.entries(
        board.rows.reduce<Record<string, number>>((acc, r) => {
          const ph = visitPhase(r.status);
          acc[ph] = (acc[ph] ?? 0) + 1;
          return acc;
        }, {}),
      ) as Array<[VisitPhase, number]>).map(([phase, n]) => ({ phase, label: VISIT_PHASE_LABEL[phase], n }))
    : null;

  const bySource = suggestions
    ? Object.values(
        suggestions.rows.reduce<Record<string, { source: SuggestionSource; label: string; total: number; high: number }>>((acc, r) => {
          const cur = (acc[r.source] ??= { source: r.source, label: SOURCE_LABEL[r.source] ?? r.source, total: 0, high: 0 });
          cur.total += r.n;
          if (r.priority === "high") cur.high += r.n;
          return acc;
        }, {}),
      ).sort((a, b) => b.high - a.high || b.total - a.total)
    : null;

  return {
    brief,
    suggestions: bySource,
    anomalies,
    visits: board && phases ? { total: board.rows.length, phases, openAlerts: board.openAlerts.length, critical: board.openAlerts.filter((a) => a.severity === "critical").length } : null,
    matches,
    followUps: followUps ? { agents: followUps.tasks.slice(0, 6), visitsWithoutFollowUp: followUps.visits.reduce((a, v) => a + v.n, 0), unassigned: followUps.unassigned } : null,
    quality: quality ? { ...quality, threshold: s.lowQualityScore } : null,
    aiHealth,
    flags: { visits: visitsOn, tasks: tasksOn },
  };
}
export type CommandCenter = Awaited<ReturnType<typeof getCommandCenter>>;
