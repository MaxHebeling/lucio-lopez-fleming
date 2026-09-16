/**
 * Fechas de calendario como "YYYY-MM-DD" (sin hora ni zona): vencimientos, períodos y fechas de ajuste.
 * "Hoy" se calcula en la zona de Salta: un vencimiento no cambia de día por la hora del servidor (UTC).
 */
export const TZ = "America/Argentina/Salta";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayInSalta(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parts(s: string): [number, number, number] {
  if (!isIsoDate(s)) throw new Error(`Fecha inválida: ${s}`);
  return [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Suma meses conservando el día; si el mes destino es más corto, queda en su último día. */
export function addMonths(s: string, months: number): string {
  const [y, m, d] = parts(s);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(s: string, days: number): string {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function firstOfMonth(s: string): string {
  const [y, m] = parts(s);
  return fmt(y, m, 1);
}

export function lastOfMonth(s: string): string {
  const [y, m] = parts(s);
  return fmt(y, m, daysInMonth(y, m));
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Períodos mensuales (día 1) desde el mes de `start` mientras el período empiece antes de `endExclusive`. */
export function monthlyPeriods(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  for (let p = firstOfMonth(start); p < endExclusive; p = addMonths(p, 1)) out.push(p);
  return out;
}

/** Fecha de vencimiento de un período con el día de pago del contrato (1–28, siempre existe). */
export function dueDateFor(periodStart: string, dueDay: number): string {
  const [y, m] = parts(periodStart);
  return fmt(y, m, dueDay);
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-09-01" → "septiembre 2026" */
export function monthLabel(s: string): string {
  const [y, m] = parts(s);
  return `${MONTHS[m - 1]} ${y}`;
}
