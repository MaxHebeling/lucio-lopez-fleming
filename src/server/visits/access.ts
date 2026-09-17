/**
 * Alcance del portal de visitas, resuelto en el servidor.
 * - `visits.operate`: el agente ve y opera SOLO las visitas asignadas a él (no alcanza con haberlas creado).
 * - `visits.monitor` o `agenda.read_all`: ve todas las de su organización.
 * - Presencia (en camino, check-in, problema de ubicación, iniciar): solo el agente asignado, aunque sea admin.
 * Fuera de alcance o de otra organización → 404 (no se confirma que exista).
 */
import type { Executor } from "../db";
import { can, requireStaff, type Actor, type StaffActor } from "../auth/actor";
import { AppError, forbidden, notFound } from "../errors";

export type VisitScope = { all: boolean; userId: string };

export function visitScope(actor: Actor): VisitScope {
  if (actor.kind === "anonymous") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  requireStaff(actor);
  if (!can(actor, "visits.operate") && !can(actor, "visits.monitor")) throw forbidden();
  return { all: can(actor, "visits.monitor") || can(actor, "agenda.read_all"), userId: actor.userId };
}

export function tryVisitScope(actor: Actor): VisitScope | null {
  try {
    return visitScope(actor);
  } catch (e) {
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "unauthenticated")) return null;
    throw e;
  }
}

export async function loadVisit(db: Executor, actor: Actor, id: string, opts: { forUpdate?: boolean } = {}) {
  const scope = visitScope(actor);
  const staff = actor as StaffActor;
  let q = db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .selectAll("a")
    .select(["u.organization_id as agent_organization_id", "u.full_name as agent_name", "u.is_active as agent_active"])
    .where("a.id", "=", id)
    .where("a.kind", "=", "visit");
  if (opts.forUpdate) q = q.forUpdate("a");
  const v = await q.executeTakeFirst();
  if (!v || v.agent_organization_id !== staff.organizationId) throw notFound("Visita");
  if (!scope.all && v.assigned_user_id !== scope.userId) throw notFound("Visita");
  return v;
}

export type VisitRow = Awaited<ReturnType<typeof loadVisit>>;

/** Acciones de presencia: solo quien va a la propiedad. */
export function assertAssignedAgent(actor: Actor, v: Pick<VisitRow, "assigned_user_id">): void {
  if (actor.kind !== "staff" || actor.userId !== v.assigned_user_id) throw forbidden("Solo el agente asignado puede registrar su llegada y el avance de la visita");
}

/** Gestión de la visita (link, informe, cierre, seguimiento): el agente asignado o quien ve todas. */
export function assertCanManageVisit(actor: Actor, v: Pick<VisitRow, "assigned_user_id">): void {
  const scope = visitScope(actor);
  if (!can(actor, "visits.operate")) throw forbidden();
  if (!scope.all && v.assigned_user_id !== scope.userId) throw notFound("Visita");
}
