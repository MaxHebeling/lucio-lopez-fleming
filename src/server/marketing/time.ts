export const TIMEZONE = "America/Argentina/Salta";

/** Offset (ms) de una zona IANA en un instante dado. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-10-01T09:30" en hora local de la zona → instante UTC (válido también si la zona tuviera horario de verano). */
export function zonedLocalToUtc(local: string, timeZone = TIMEZONE): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return new Date(NaN);
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = naive - zoneOffsetMs(new Date(naive), timeZone);
  guess = naive - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Instante → "YYYY-MM-DDTHH:mm" en la zona (para inputs datetime-local). */
export function utcToZonedLocal(d: Date, timeZone = TIMEZONE): string {
  const shifted = new Date(d.getTime() + zoneOffsetMs(d, timeZone));
  return shifted.toISOString().slice(0, 16);
}
