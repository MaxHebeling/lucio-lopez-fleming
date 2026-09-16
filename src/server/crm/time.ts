/**
 * Fechas y horas de la agenda en la zona de la inmobiliaria (America/Argentina/Salta).
 * Los formularios envían "YYYY-MM-DDTHH:mm" (datetime-local) en hora de Salta; la base guarda timestamptz.
 * Funciones puras, sin depender de la zona del servidor.
 */
export const CRM_TIMEZONE = "America/Argentina/Salta";

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsIn(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, second: p.second! };
}

/** Diferencia (ms) entre la hora de pared en `tz` y UTC para un instante. */
function offsetMs(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

export function isLocalDateTime(value: string): boolean {
  const m = LOCAL_RE.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d && h < 24 && mi < 60;
}

/** "2026-09-16T10:30" en hora de Salta → instante UTC. */
export function localToUtc(value: string, tz = CRM_TIMEZONE): Date {
  if (!isLocalDateTime(value)) throw new Error(`Fecha y hora inválida: ${value}`);
  const m = LOCAL_RE.exec(value)!;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  let guess = wall - offsetMs(new Date(wall), tz);
  // Segundo paso por si el offset cambia entre la estimación y el resultado (horario de verano).
  guess = wall - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** Instante → "YYYY-MM-DDTHH:mm" en hora de Salta (para inputs datetime-local). */
export function utcToLocalInput(date: Date, tz = CRM_TIMEZONE): string {
  const p = partsIn(date, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Fecha local (YYYY-MM-DD) de un instante en Salta. */
export function localDate(date: Date, tz = CRM_TIMEZONE): string {
  return utcToLocalInput(date, tz).slice(0, 10);
}

export function isLocalDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Suma días a una fecha YYYY-MM-DD (calendario, sin zona). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Lunes de la semana (ISO) que contiene la fecha. */
export function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** Rango [desde, hasta) en UTC que cubre `days` días locales a partir de `dateStr`. */
export function localDayRange(dateStr: string, days = 1, tz = CRM_TIMEZONE): { from: Date; to: Date } {
  return { from: localToUtc(`${dateStr}T00:00`, tz), to: localToUtc(`${addDays(dateStr, days)}T00:00`, tz) };
}
