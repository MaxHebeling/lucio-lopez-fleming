/** Presupuesto diario de IA (setting `ai.daily_budget_usd`). El día se cuenta en hora de Salta. */
import { sql, type Executor } from "../db";

export const DEFAULT_DAILY_BUDGET_USD = 5;

export async function dailyBudgetUsd(db: Executor): Promise<number> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", "ai.daily_budget_usd").executeTakeFirst();
  if (!row) return DEFAULT_DAILY_BUDGET_USD;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}

export async function spentTodayMicros(db: Executor): Promise<number> {
  const r = await sql<{ micros: string | null }>`
    select coalesce(sum(cost_usd_micros), 0)::text as micros from ai_interactions
     where created_at >= (date_trunc('day', now() at time zone 'America/Argentina/Salta') at time zone 'America/Argentina/Salta')`.execute(db);
  return Number(r.rows[0]?.micros ?? 0);
}

export async function budgetStatus(db: Executor): Promise<{ budgetMicros: number; spentMicros: number; exhausted: boolean }> {
  const budget = await dailyBudgetUsd(db);
  const spent = await spentTodayMicros(db);
  const budgetMicros = Math.round(budget * 1_000_000);
  return { budgetMicros, spentMicros: spent, exhausted: spent >= budgetMicros };
}
