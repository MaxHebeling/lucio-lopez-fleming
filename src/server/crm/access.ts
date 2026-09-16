/**
 * Alcance "propio vs. todos" del CRM comercial, resuelto SIEMPRE en el servidor.
 * Un registro fuera de alcance se informa como inexistente (404): no se confirma que exista.
 */
import { can, requireStaff, type Actor } from "../auth/actor";
import { AppError, forbidden, notFound } from "../errors";

export type Scope = { all: boolean; userId: string | null };

function scope(actor: Actor, allPermission: string, ownPermission: string): Scope {
  if (actor.kind === "system") return { all: true, userId: null };
  if (actor.kind === "anonymous") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  requireStaff(actor);
  if (can(actor, allPermission)) return { all: true, userId: actor.userId };
  if (can(actor, ownPermission)) return { all: false, userId: actor.userId };
  throw forbidden();
}

export const leadScope = (actor: Actor) => scope(actor, "leads.read_all", "leads.read_own");
export const opportunityScope = (actor: Actor) => scope(actor, "opportunities.read_all", "opportunities.read_own");
export const agendaScope = (actor: Actor) => scope(actor, "agenda.read_all", "agenda.manage");
export const taskScope = (actor: Actor) => scope(actor, "tasks.read_all", "tasks.manage");

/** Scope sin lanzar: null si el actor no tiene ninguno de los dos permisos. */
export function tryScope(fn: (a: Actor) => Scope, actor: Actor): Scope | null {
  try {
    return fn(actor);
  } catch (e) {
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "unauthenticated")) return null;
    throw e;
  }
}

/** Verifica que un registro asignado esté dentro del alcance; si no, 404. */
export function assertInScope(s: Scope, assignedUserId: string | null, what: string, extraOwnerIds: Array<string | null> = []): void {
  if (s.all) return;
  if (s.userId && (assignedUserId === s.userId || extraOwnerIds.includes(s.userId))) return;
  throw notFound(what);
}

export function actorStaffId(actor: Actor): string | null {
  return actor.kind === "staff" ? actor.userId : null;
}
