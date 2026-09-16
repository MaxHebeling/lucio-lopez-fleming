/**
 * Carga de entidades del CRM respetando el alcance del actor. Fuera de alcance → 404 (no se revela existencia).
 */
import type { Executor } from "../db";
import { requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { agendaScope, assertInScope, leadScope, opportunityScope, taskScope } from "./access";

export async function loadLead(db: Executor, actor: Actor, id: string, opts: { forUpdate?: boolean } = {}) {
  const scope = leadScope(actor);
  let q = db.selectFrom("leads").selectAll().where("id", "=", id).where("deleted_at", "is", null);
  if (opts.forUpdate) q = q.forUpdate();
  const lead = await q.executeTakeFirst();
  if (!lead) throw notFound("Lead");
  assertInScope(scope, lead.assigned_user_id, "Lead");
  return lead;
}

export async function loadOpportunity(db: Executor, actor: Actor, id: string, opts: { forUpdate?: boolean } = {}) {
  const scope = opportunityScope(actor);
  let q = db.selectFrom("opportunities").selectAll().where("id", "=", id).where("deleted_at", "is", null);
  if (opts.forUpdate) q = q.forUpdate();
  const opp = await q.executeTakeFirst();
  if (!opp) throw notFound("Oportunidad");
  assertInScope(scope, opp.assigned_user_id, "Oportunidad");
  return opp;
}

export async function loadAppointment(db: Executor, actor: Actor, id: string, opts: { forUpdate?: boolean } = {}) {
  const scope = agendaScope(actor);
  let q = db.selectFrom("appointments").selectAll().where("id", "=", id);
  if (opts.forUpdate) q = q.forUpdate();
  const a = await q.executeTakeFirst();
  if (!a) throw notFound("Cita");
  assertInScope(scope, a.assigned_user_id, "Cita", [a.created_by]);
  return a;
}

export async function loadTask(db: Executor, actor: Actor, id: string, opts: { forUpdate?: boolean } = {}) {
  const scope = taskScope(actor);
  let q = db.selectFrom("tasks").selectAll().where("id", "=", id);
  if (opts.forUpdate) q = q.forUpdate();
  const t = await q.executeTakeFirst();
  if (!t) throw notFound("Tarea");
  assertInScope(scope, t.assigned_user_id, "Tarea", [t.created_by]);
  return t;
}

export async function loadContact(db: Executor, actor: Actor, id: string) {
  requirePermission(actor, "contacts.read");
  const c = await db.selectFrom("contacts").selectAll().where("id", "=", id).where("deleted_at", "is", null).where("merged_into_id", "is", null).executeTakeFirst();
  if (!c) throw notFound("Contacto");
  return c;
}

export type LinkableEntity = "contact" | "property" | "lead" | "opportunity" | "appointment";

/** Verifica que el actor pueda ver la entidad a la que se vincula algo (tarea, nota, cita). */
export async function assertEntityVisible(db: Executor, actor: Actor, type: LinkableEntity, id: string): Promise<void> {
  switch (type) {
    case "contact":
      await loadContact(db, actor, id);
      return;
    case "lead":
      await loadLead(db, actor, id);
      return;
    case "opportunity":
      await loadOpportunity(db, actor, id);
      return;
    case "appointment":
      await loadAppointment(db, actor, id);
      return;
    case "property": {
      requirePermission(actor, "properties.read");
      const p = await db.selectFrom("properties").select("id").where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
      if (!p) throw notFound("Propiedad");
      return;
    }
  }
}
