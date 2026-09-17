/** Utilidades comunes de las herramientas de dominio (solo lectura, con alcance y organización del actor). */
import { sql } from "../../db";
import { can, type StaffActor } from "../../auth/actor";
import { tryScope, type Scope } from "../../crm/access";
import type { Actor } from "../../auth/actor";

export const TZ = "America/Argentina/Salta";
export const MAX_ITEMS = 15;

/** Inicio del día de hoy en Salta (+ offset de días), como timestamptz. */
export function saltaDayStart(offsetDays = 0) {
  return sql<Date>`((date_trunc('day', now() at time zone ${TZ}) + make_interval(days => ${offsetDays})) at time zone ${TZ})`;
}

/** Lunes de la semana actual en Salta. */
export function saltaWeekStart() {
  return sql<Date>`(date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})`;
}

const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export function hhmm(d: Date): string {
  return timeFmt.format(d);
}

export function scopeOf(actor: StaffActor, fn: (a: Actor) => Scope): Scope | null {
  return tryScope(fn, actor);
}

export function scopeLabel(s: Scope): "own" | "all" {
  return s.all ? "all" : "own";
}

export function hoursSince(d: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 3_600_000));
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export { can };
