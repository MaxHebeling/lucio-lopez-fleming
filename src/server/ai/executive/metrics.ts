/**
 * Métricas de dirección (Executive AI): cálculo PURO de períodos, comparaciones, tasas y medianas, con reglas de
 * prudencia para muestras chicas. Las consultas están en queries.ts; las herramientas del copiloto, en
 * src/server/ai/domains/executive-management.ts. Hora de Salta (UTC−3, sin horario de verano).
 */

export const EXEC_PERIODS = ["last_7_days", "this_week", "this_month", "last_month", "last_30_days"] as const;
export type ExecPeriod = (typeof EXEC_PERIODS)[number];

export type Range = { from: Date; to: Date; label: string };
export type PeriodRange = Range & { period: ExecPeriod; previous: Range };

const DAY = 86_400_000;
const OFFSET_MS = 3 * 3_600_000; // Salta = UTC−3

/** Medianoche de Salta del día que contiene `d`. */
function saltaMidnight(d: Date): Date {
  const local = new Date(d.getTime() - OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + OFFSET_MS);
}

function saltaParts(d: Date): { y: number; m: number; day: number; dow: number } {
  const local = new Date(d.getTime() - OFFSET_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), day: local.getUTCDate(), dow: local.getUTCDay() };
}

function monthStart(y: number, m: number): Date {
  return new Date(Date.UTC(y, m, 1) + OFFSET_MS);
}

const dm = (d: Date) => {
  const p = saltaParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.m + 1).padStart(2, "0")}`;
};

function label(prefix: string, from: Date, to: Date): string {
  // `to` es exclusivo: se muestra el último día incluido.
  const last = new Date(to.getTime() - 1);
  return `${prefix} (${dm(from)} al ${dm(last)})`;
}

export function periodRange(period: ExecPeriod, now: Date): PeriodRange {
  switch (period) {
    case "last_7_days":
    case "last_30_days": {
      const days = period === "last_7_days" ? 7 : 30;
      const from = new Date(now.getTime() - days * DAY);
      const prevFrom = new Date(from.getTime() - days * DAY);
      return { period, from, to: now, label: label(`Últimos ${days} días`, from, now), previous: { from: prevFrom, to: from, label: label(`${days} días anteriores`, prevFrom, from) } };
    }
    case "this_week": {
      const today = saltaMidnight(now);
      const dow = saltaParts(now).dow; // 0 = domingo
      const from = new Date(today.getTime() - ((dow + 6) % 7) * DAY);
      const elapsed = now.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - 7 * DAY);
      return { period, from, to: now, label: label("Semana en curso", from, now), previous: { from: prevFrom, to: new Date(prevFrom.getTime() + elapsed), label: label("Mismo tramo de la semana anterior", prevFrom, new Date(prevFrom.getTime() + elapsed)) } };
    }
    case "this_month": {
      const p = saltaParts(now);
      const from = monthStart(p.y, p.m);
      const prevFrom = monthStart(p.m === 0 ? p.y - 1 : p.y, p.m === 0 ? 11 : p.m - 1);
      // Mismo tramo del mes anterior (si el mes anterior es más corto, hasta su fin).
      const prevTo = new Date(Math.min(prevFrom.getTime() + (now.getTime() - from.getTime()), from.getTime()));
      return { period, from, to: now, label: label("Mes en curso", from, now), previous: { from: prevFrom, to: prevTo, label: label("Mismo tramo del mes anterior", prevFrom, prevTo) } };
    }
    case "last_month": {
      const p = saltaParts(now);
      const to = monthStart(p.y, p.m);
      const from = monthStart(p.m === 0 ? p.y - 1 : p.y, p.m === 0 ? 11 : p.m - 1);
      const fp = saltaParts(from);
      const prevFrom = monthStart(fp.m === 0 ? fp.y - 1 : fp.y, fp.m === 0 ? 11 : fp.m - 1);
      return { period, from, to, label: label("Mes anterior", from, to), previous: { from: prevFrom, to: from, label: label("Mes previo", prevFrom, from) } };
    }
  }
}

/** Debajo de este tamaño no se informan variaciones porcentuales ni tendencias. */
export const MIN_SAMPLE = 5;

export type Comparison = { current: number; previous: number; delta: number; pct: number | null; smallSample: boolean };

export function compareCounts(current: number, previous: number): Comparison {
  const smallSample = Math.max(current, previous) < MIN_SAMPLE;
  const pct = previous > 0 && !smallSample ? Math.round(((current - previous) / previous) * 100) : null;
  return { current, previous, delta: current - previous, pct, smallSample };
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function formatComparison(c: Comparison): string {
  const base = `${c.current} (período anterior: ${c.previous}`;
  if (c.delta === 0) return `${base}, sin cambios)`;
  if (c.smallSample) return `${base}, ${signed(c.delta)}; muestra chica, sin variación porcentual)`;
  if (c.pct === null) return `${base}, ${signed(c.delta)}; sin base para porcentaje)`;
  return `${base}, ${signed(c.delta)}, ${signed(c.pct)} %)`;
}

export type Rate = { numerator: number; denominator: number; value: number | null };

export function rate(numerator: number, denominator: number, minDenominator = MIN_SAMPLE): Rate {
  return { numerator, denominator, value: denominator >= minDenominator ? Math.round((numerator / denominator) * 100) : null };
}

export function formatRate(r: Rate): string {
  if (r.value === null) return `${r.numerator} de ${r.denominator} (muestra chica: menos de ${MIN_SAMPLE}, sin porcentaje)`;
  return `${r.value} % (${r.numerator} de ${r.denominator})`;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mediana solo con muestra suficiente (≥ 3 valores); si no, null. */
export function robustMedian(values: number[], min = 3): number | null {
  return values.length >= min ? median(values) : null;
}

export function formatHours(h: number | null): string {
  if (h === null) return "sin muestra suficiente";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`.replace(".", ",");
  return `${Math.round((h / 24) * 10) / 10} días`.replace(".", ",");
}
