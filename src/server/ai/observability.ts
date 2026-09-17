/**
 * Observabilidad y costos de la IA (página CRM → Integraciones → Uso de IA). Solo lectura, permiso `ai.read_usage`.
 * Todo sale de ai_interactions / ai_feedback / ai_knowledge_*: nada estimado fuera de los tokens registrados.
 */
import { z } from "zod";
import { sql, type Database } from "../db";
import { requirePermission, type Actor } from "../auth/actor";
import { parseInput } from "../validate";
import { organizationId } from "../org";
import { budgetStatus, dailyBudgetUsd } from "./budget";
import { modelRouting } from "./core/routing";
import { knowledgeStats } from "./knowledge/retrieval";
import { listPrompts } from "./prompts/registry";

const TZ = "America/Argentina/Salta";

export const usageFiltersSchema = z.object({ days: z.coerce.number().int().refine((n) => [1, 7, 30, 90].includes(n)).catch(7) });

export async function getAiUsage(db: Database, actor: Actor, raw: unknown) {
  requirePermission(actor, "ai.read_usage");
  const { days } = parseInput(usageFiltersSchema, raw ?? {});
  // Filas históricas del asistente de WhatsApp no tienen organización: pertenecen a la organización principal.
  const primary = actor.organizationId === (await organizationId(db));
  const org = sql`(i.organization_id = ${actor.organizationId}${primary ? sql` or i.organization_id is null` : sql``})`;
  const since = sql<Date>`now() - make_interval(days => ${days})`;

  const [byFeature, reasons, daily, costs, tools, feedback, comments, routing, knowledge, integration, flags, budget, budgetUsd] = await Promise.all([
    sql<{
      feature: string;
      requests: number;
      model_requests: number;
      errors: number;
      fallbacks: number;
      p50: number | null;
      p95: number | null;
      tool_failures: number;
      retrieval_failures: number;
      cost_micros: string;
    }>`
      select coalesce(i.feature, i.purpose) as feature,
             count(*)::int as requests,
             count(*) filter (where coalesce(i.provider, 'anthropic') <> 'deterministic' or i.fallback_reason is not null)::int as model_requests,
             count(*) filter (where i.status in ('error', 'timeout', 'invalid_output', 'blocked'))::int as errors,
             count(*) filter (where i.fallback_reason is not null or i.status in ('fallback', 'budget_exceeded', 'unavailable', 'rate_limited'))::int as fallbacks,
             percentile_cont(0.5) within group (order by i.latency_ms) as p50,
             percentile_cont(0.95) within group (order by i.latency_ms) as p95,
             coalesce(sum(i.tool_failures), 0)::int as tool_failures,
             count(*) filter (where i.retrieval_failed)::int as retrieval_failures,
             coalesce(sum(i.cost_usd_micros), 0)::text as cost_micros
        from ai_interactions i
       where ${org} and i.created_at >= ${since}
       group by 1 order by 2 desc`.execute(db),
    sql<{ reason: string; n: number }>`
      select coalesce(i.fallback_reason, i.status) as reason, count(*)::int as n
        from ai_interactions i
       where ${org} and i.created_at >= ${since} and (i.fallback_reason is not null or i.status <> 'ok')
       group by 1 order by 2 desc`.execute(db),
    sql<{ day: string; requests: number; errors: number; cost_micros: string }>`
      select to_char((i.created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, count(*)::int as requests,
             count(*) filter (where i.status in ('error', 'timeout', 'invalid_output', 'blocked'))::int as errors,
             coalesce(sum(i.cost_usd_micros), 0)::text as cost_micros
        from ai_interactions i
       where ${org} and i.created_at >= ${since}
       group by 1 order by 1 desc`.execute(db),
    sql<{ today: string; month: string; days_in_month: number; day_of_month: number }>`
      select coalesce(sum(i.cost_usd_micros) filter (where i.created_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})), 0)::text as today,
             coalesce(sum(i.cost_usd_micros) filter (where i.created_at >= (date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ})), 0)::text as month,
             extract(day from (date_trunc('month', now() at time zone ${TZ}) + interval '1 month - 1 day'))::int as days_in_month,
             extract(day from now() at time zone ${TZ})::int as day_of_month
        from ai_interactions i
       where ${org} and i.created_at >= (date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ})`.execute(db),
    sql<{ name: string; calls: number; failures: number }>`
      select t->>'name' as name, count(*)::int as calls, count(*) filter (where (t->>'ok')::boolean is false)::int as failures
        from ai_interactions i, jsonb_array_elements(i.tool_calls) t
       where ${org} and i.created_at >= ${since} and i.feature is not null
       group by 1 order by 2 desc limit 20`.execute(db),
    sql<{ up: number; down: number }>`
      select count(*) filter (where rating = 1)::int as up, count(*) filter (where rating = -1)::int as down
        from ai_feedback where organization_id = ${actor.organizationId} and created_at >= ${since}`.execute(db),
    db
      .selectFrom("ai_feedback as f")
      .innerJoin("users as u", "u.id", "f.user_id")
      .select(["f.id", "f.rating", "f.comment", "f.feature", "f.prompt_ref", "f.created_at", "u.full_name"])
      .where("f.organization_id", "=", actor.organizationId)
      .where("f.comment", "is not", null)
      .orderBy("f.created_at", "desc")
      .limit(10)
      .execute(),
    modelRouting(db),
    knowledgeStats(db),
    db.selectFrom("integrations").select(["status", "last_ok_at", "last_error_at", "last_error", "circuit_open_until", "consecutive_failures"]).where("key", "=", "anthropic").executeTakeFirst(),
    db.selectFrom("feature_flags").select(["key", "enabled", "description"]).where("key", "like", "ai\\_%").orderBy("key").execute(),
    budgetStatus(db),
    dailyBudgetUsd(db),
  ]);

  const totals = byFeature.rows.reduce(
    (t, r) => ({ requests: t.requests + r.requests, errors: t.errors + r.errors, fallbacks: t.fallbacks + r.fallbacks, toolFailures: t.toolFailures + r.tool_failures, retrievalFailures: t.retrievalFailures + r.retrieval_failures }),
    { requests: 0, errors: 0, fallbacks: 0, toolFailures: 0, retrievalFailures: 0 },
  );
  const c = costs.rows[0];
  const monthMicros = Number(c?.month ?? 0);
  return {
    days,
    totals: { ...totals, fallbackRate: totals.requests ? totals.fallbacks / totals.requests : null },
    byFeature: byFeature.rows.map((r) => ({ ...r, p50: r.p50 === null ? null : Math.round(r.p50), p95: r.p95 === null ? null : Math.round(r.p95), costUsd: Number(r.cost_micros) / 1e6 })),
    reasons: reasons.rows,
    daily: daily.rows.map((r) => ({ ...r, costUsd: Number(r.cost_micros) / 1e6 })),
    cost: {
      todayUsd: Number(c?.today ?? 0) / 1e6,
      monthUsd: monthMicros / 1e6,
      dailyBudgetUsd: budgetUsd,
      // Referencia: presupuesto diario × días transcurridos del mes (no hay presupuesto mensual separado).
      monthBudgetToDateUsd: budgetUsd * (c?.day_of_month ?? 0),
      budgetExhausted: budget.exhausted,
    },
    tools: tools.rows,
    feedback: { up: feedback.rows[0]?.up ?? 0, down: feedback.rows[0]?.down ?? 0, comments },
    routing: Object.values(routing),
    prompts: listPrompts(),
    knowledge,
    integration: integration ?? null,
    flags,
  };
}
export type AiUsage = Awaited<ReturnType<typeof getAiUsage>>;
