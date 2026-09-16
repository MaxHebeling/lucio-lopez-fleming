/**
 * Valores de índices de ajuste.
 * - ICL y CER: descarga diaria desde la API pública del BCRA (job `rentals.fetch_indices`, flag `rent_index_fetch`),
 *   con callIntegration (circuito + integration_logs), timeout y reintentos. Idempotente por (índice, fecha).
 * - IPC y Casa Propia: carga manual auditada (permiso rentals.adjust). Se guarda el coeficiente mensual 1 + variación/100.
 */
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, requireStaff, type Actor } from "../auth/actor";
import { isEnabled } from "../flags";
import { log } from "../log";
import { callIntegration } from "../resilience";
import { fetchBcraSeries, type BcraIndex, type BcraPoint, type FetchLike } from "../integrations/bcra";
import { conflict } from "../errors";
import { addDays, todayInSalta } from "./dates";
import { monthlyCoefficientFromPct } from "./adjustment-calc";
import { manualIndexSchema } from "./schema";

const FIRST_AVAILABLE: Record<BcraIndex, string> = { ICL: "2020-07-01", CER: "2002-02-02" };
/** Días hacia atrás que se vuelven a pedir en cada corrida (por si el BCRA corrige valores recientes). */
const OVERLAP_DAYS = 10;
/** El BCRA publica ICL/CER por adelantado: se piden hasta 60 días hacia adelante. */
const AHEAD_DAYS = 60;

export async function upsertBcraValues(db: Database, indexKey: BcraIndex, points: BcraPoint[]): Promise<{ inserted: number; updated: number; unchanged: number }> {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < points.length; i += 500) {
    const chunk = points.slice(i, i + 500);
    const r = await sql<{ inserted: boolean }>`
      insert into index_values(index_key, period_date, value, source)
      select ${indexKey}, d::date, v::numeric, 'bcra_api'
        from unnest(${chunk.map((p) => p.date)}::text[], ${chunk.map((p) => p.value)}::text[]) as t(d, v)
      on conflict (index_key, period_date) do update
        set value = excluded.value, fetched_at = now()
        where index_values.source = 'bcra_api' and index_values.value is distinct from excluded.value
      returning (xmax = 0) as inserted`.execute(db);
    inserted += r.rows.filter((x) => x.inserted).length;
    updated += r.rows.filter((x) => !x.inserted).length;
  }
  return { inserted, updated, unchanged: points.length - inserted - updated };
}

async function fetchFrom(db: Database, key: BcraIndex, today: string): Promise<string> {
  const last = await db.selectFrom("index_values").select(sql<string>`max(period_date)::text`.as("d")).where("index_key", "=", key).where("source", "=", "bcra_api").executeTakeFirst();
  if (last?.d) {
    const from = addDays(last.d < today ? last.d : today, -OVERLAP_DAYS);
    return from < FIRST_AVAILABLE[key] ? FIRST_AVAILABLE[key] : from;
  }
  // Primera carga: desde el inicio más antiguo de un contrato que use el índice (o 13 meses atrás).
  const earliest = await db
    .selectFrom("rental_contracts")
    .select(sql<string>`min(start_date)::text`.as("d"))
    .where("adjustment_index_key", "=", key)
    .where("status", "in", ["draft", "active"])
    .executeTakeFirst();
  const base = earliest?.d && earliest.d < addDays(today, -400) ? earliest.d : addDays(today, -400);
  const from = addDays(base, -OVERLAP_DAYS);
  return from < FIRST_AVAILABLE[key] ? FIRST_AVAILABLE[key] : from;
}

export type FetchIndicesResult = {
  skipped?: "flag_off";
  results: Array<{ index: BcraIndex; from: string; to: string; received: number; inserted: number; updated: number; error?: string }>;
};

export async function fetchIndicesFromBcra(
  db: Database,
  opts: { force?: boolean; today?: string; fetchImpl?: FetchLike; requestId?: string } = {},
): Promise<FetchIndicesResult> {
  if (!opts.force && !(await isEnabled(db, "rent_index_fetch"))) return { skipped: "flag_off", results: [] };
  const today = opts.today ?? todayInSalta();
  const results: FetchIndicesResult["results"] = [];
  for (const key of ["ICL", "CER"] as const) {
    const from = await fetchFrom(db, key, today);
    const to = addDays(today, AHEAD_DAYS);
    try {
      const points = await callIntegration(db, "bcra", `fetch_${key.toLowerCase()}`, () => fetchBcraSeries(key, from, to, { fetchImpl: opts.fetchImpl }), {
        entityType: "adjustment_index",
        entityId: key,
        requestId: opts.requestId,
      });
      const r = await upsertBcraValues(db, key, points);
      results.push({ index: key, from, to, received: points.length, inserted: r.inserted, updated: r.updated });
      if (r.updated) log.warn("rentals.bcra_values_revised", { index: key, updated: r.updated });
    } catch (e) {
      results.push({ index: key, from, to, received: 0, inserted: 0, updated: 0, error: (e as Error).message });
    }
  }
  return { results };
}

/** Carga manual de IPC / Casa Propia (variación mensual en %). Auditada con valor anterior y nuevo. */
export async function setManualIndexValue(db: Database, actor: Actor, raw: unknown): Promise<{ changed: boolean; coefficient: string }> {
  requirePermission(actor, "rentals.adjust");
  requireStaff(actor);
  const input = manualIndexSchema.parse(raw);
  const coefficient = monthlyCoefficientFromPct(input.variationPct);
  const periodDate = `${input.month}-01`;
  if (periodDate > todayInSalta()) throw conflict("No se puede cargar un mes que todavía no empezó");
  return db.transaction().execute(async (trx) => {
    const prev = await trx
      .selectFrom("index_values")
      .select(["value", "source"])
      .where("index_key", "=", input.indexKey)
      .where("period_date", "=", periodDate)
      .forUpdate()
      .executeTakeFirst();
    if (prev && prev.value === coefficient) return { changed: false, coefficient };
    await trx
      .insertInto("index_values")
      .values({ index_key: input.indexKey, period_date: periodDate, value: coefficient, source: "manual", entered_by: actorUserId(actor) })
      .onConflict((oc) => oc.columns(["index_key", "period_date"]).doUpdateSet({ value: coefficient, source: "manual", entered_by: actorUserId(actor), fetched_at: new Date() }))
      .execute();
    await audit(trx, actor, {
      action: prev ? "INDEX_VALUE_CORRECTED" : "INDEX_VALUE_LOADED",
      entityType: "index_value",
      entityId: `${input.indexKey}:${periodDate}`,
      before: prev ? { value: prev.value, source: prev.source } : undefined,
      after: { value: coefficient, variationPct: input.variationPct, source: "manual" },
    });
    return { changed: true, coefficient };
  });
}
