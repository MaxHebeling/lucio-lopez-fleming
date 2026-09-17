/**
 * Cálculo puro de ajustes de alquiler (sin base de datos). Fórmulas:
 *
 * - ICL / CER (índices diarios del BCRA):
 *     factor = valor(fecha efectiva del ajuste) / valor(fecha de inicio del período anterior)
 *   Si no hay valor para el día exacto se usa el último valor publicado ANTERIOR a esa fecha, siempre que no
 *   esté a más de MAX_GAP_DAYS días (si no, se considera faltante). Se registran las fechas pedidas y usadas.
 *
 * - IPC / CASA_PROPIA (índices mensuales, carga manual):
 *     factor = Π (1 + variación mensual / 100) de los meses del período anterior
 *   (desde el mes de inicio del período, tantos meses como la periodicidad del contrato).
 *
 * - Monto nuevo = monto vigente × razón exacta, redondeado a centavos half-up (ver decimal.ts).
 *
 * Si falta cualquier valor NO se calcula: se devuelve la lista de faltantes para dejar el aviso.
 */
import { addDays, addMonths, diffDays, firstOfMonth } from "./dates";
import { applyRatioToCents, centsToString, div, mul, ONE, parseRatio, ratioToFixed, toCents, type Ratio } from "./decimal";

export const MAX_GAP_DAYS = 7;
export const DAILY_INDICES = ["ICL", "CER"] as const;
export const MONTHLY_INDICES = ["IPC", "CASA_PROPIA"] as const;
export type IndexKey = (typeof DAILY_INDICES)[number] | (typeof MONTHLY_INDICES)[number];

export type IndexPoint = { date: string; value: string };

export type DailyPick = { requestedDate: string; usedDate: string; value: string };

export type Calculation =
  | {
      ok: true;
      indexKey: IndexKey;
      previousAmount: string;
      newAmount: string;
      factor: string; // 8 decimales, informativo
      ratio: { numerator: string; denominator: string };
      start?: DailyPick;
      end?: DailyPick;
      months?: Array<{ month: string; coefficient: string }>;
      rounding: "half_up_2";
    }
  | { ok: false; indexKey: IndexKey; missing: string[] };

/** Último valor con fecha ≤ `date` y a no más de `maxGap` días. `values` en cualquier orden. */
export function pickOnOrBefore(values: IndexPoint[], date: string, maxGap = MAX_GAP_DAYS): IndexPoint | null {
  let best: IndexPoint | null = null;
  for (const v of values) {
    if (v.date <= date && (!best || v.date > best.date)) best = v;
  }
  if (!best || diffDays(best.date, date) > maxGap) return null;
  return best;
}

export function previousPeriodStart(effectiveDate: string, periodMonths: number, contractStart: string): string {
  const s = addMonths(effectiveDate, -periodMonths);
  return s < contractStart ? contractStart : s;
}

/** Meses (día 1) cuyo coeficiente se multiplica para un período que empieza en `periodStart`. */
export function monthsForPeriod(periodStart: string, periodMonths: number): string[] {
  const first = firstOfMonth(periodStart);
  return Array.from({ length: periodMonths }, (_, i) => addMonths(first, i));
}

export function calculateAdjustment(input: {
  indexKey: IndexKey;
  previousAmount: string;
  periodStart: string;
  effectiveDate: string;
  periodMonths: number;
  /** Diarios: valores alrededor de ambas fechas. Mensuales: coeficientes por mes (date = día 1). */
  values: IndexPoint[];
}): Calculation {
  const { indexKey } = input;
  let ratio: Ratio;
  const extra: Pick<Extract<Calculation, { ok: true }>, "start" | "end" | "months"> = {};

  if ((DAILY_INDICES as readonly string[]).includes(indexKey)) {
    const start = pickOnOrBefore(input.values, input.periodStart);
    const end = pickOnOrBefore(input.values, input.effectiveDate);
    const missing: string[] = [];
    if (!start) missing.push(`${indexKey} del ${input.periodStart} (o hasta ${MAX_GAP_DAYS} días antes)`);
    if (!end) missing.push(`${indexKey} del ${input.effectiveDate} (o hasta ${MAX_GAP_DAYS} días antes)`);
    if (!start || !end) return { ok: false, indexKey, missing };
    ratio = div(parseRatio(end.value), parseRatio(start.value));
    extra.start = { requestedDate: input.periodStart, usedDate: start.date, value: start.value };
    extra.end = { requestedDate: input.effectiveDate, usedDate: end.date, value: end.value };
  } else {
    const months = monthsForPeriod(input.periodStart, input.periodMonths);
    const byMonth = new Map(input.values.map((v) => [v.date, v.value]));
    const missing = months.filter((m) => !byMonth.has(m)).map((m) => `${indexKey} de ${m.slice(0, 7)}`);
    if (missing.length) return { ok: false, indexKey, missing };
    ratio = months.reduce((acc, m) => mul(acc, parseRatio(byMonth.get(m)!)), ONE);
    extra.months = months.map((m) => ({ month: m, coefficient: byMonth.get(m)! }));
  }

  const newCents = applyRatioToCents(toCents(input.previousAmount), ratio);
  return {
    ok: true,
    indexKey,
    previousAmount: centsToString(toCents(input.previousAmount)),
    newAmount: centsToString(newCents),
    factor: ratioToFixed(ratio, 8),
    ratio: { numerator: ratio.n.toString(), denominator: ratio.d.toString() },
    ...extra,
    rounding: "half_up_2",
  };
}

/** Variación mensual en % ("1.7", "-0.3") → coeficiente exacto "1.017" con hasta 8 decimales. */
export function monthlyCoefficientFromPct(pct: string): string {
  const r = parseRatio(pct);
  const coef = { n: r.d * 100n + r.n, d: r.d * 100n };
  if (coef.n <= 0n) throw new Error("La variación debe ser mayor a -100%");
  return ratioToFixed(coef, 8);
}

/** Coeficiente guardado → variación en % para mostrar ("1.01700000" → "1.7000"). */
export function pctFromCoefficient(coef: string, scale = 4): string {
  const r = parseRatio(coef);
  return ratioToFixed({ n: (r.n - r.d) * 100n, d: r.d }, scale);
}

/** Ventana de fechas a consultar para un índice diario. */
export function dailyWindow(date: string): { from: string; to: string } {
  return { from: addDays(date, -MAX_GAP_DAYS), to: date };
}
