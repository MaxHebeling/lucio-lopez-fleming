/** Lecturas de agenda con alcance (propia / equipo). */
import { type Executor } from "../db";
import { can, type Actor } from "../auth/actor";
import { agendaScope } from "../crm/access";
import { loadAppointment } from "../crm/entities";

export async function listAppointments(db: Executor, actor: Actor, opts: { from: Date; to: Date; agent?: string; includeInactive?: boolean }) {
  const scope = agendaScope(actor);
  let q = db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .leftJoin("contacts as c", "c.id", "a.contact_id")
    .leftJoin("properties as p", "p.id", "a.property_id")
    .select([
      "a.id",
      "a.kind",
      "a.title",
      "a.starts_at",
      "a.ends_at",
      "a.status",
      "a.location",
      "a.assigned_user_id",
      "u.full_name as agent_name",
      "c.id as contact_id",
      "c.display_name as contact_name",
      "p.code as property_code",
    ])
    .where("a.starts_at", "<", opts.to)
    .where("a.ends_at", ">", opts.from);
  if (!scope.all) q = q.where((eb) => eb.or([eb("a.assigned_user_id", "=", scope.userId!), eb("a.created_by", "=", scope.userId!)]));
  else if (opts.agent && /^[0-9a-f-]{36}$/i.test(opts.agent)) q = q.where("a.assigned_user_id", "=", opts.agent);
  if (!opts.includeInactive) q = q.where("a.status", "in", ["scheduled", "confirmed", "en_route", "checked_in", "in_progress", "completed", "no_show"]);
  const rows = await q.orderBy("a.starts_at").limit(1000).execute();
  return { rows, scopeAll: scope.all };
}

export async function getAppointmentDetail(db: Executor, actor: Actor, id: string) {
  const a = await loadAppointment(db, actor, id);
  const [agent, contact, phones, property, opportunity, lead, notes] = await Promise.all([
    db.selectFrom("users").select(["id", "full_name"]).where("id", "=", a.assigned_user_id).executeTakeFirstOrThrow(),
    a.contact_id ? db.selectFrom("contacts").select(["id", "display_name"]).where("id", "=", a.contact_id).executeTakeFirst() : Promise.resolve(undefined),
    a.contact_id
      ? db.selectFrom("contact_phones").select(["id", "phone_raw", "phone_e164", "is_whatsapp", "is_primary"]).where("contact_id", "=", a.contact_id).orderBy("is_primary", "desc").execute()
      : Promise.resolve([]),
    a.property_id && can(actor, "properties.read")
      ? db.selectFrom("properties").select(["id", "code", "title", "address_street", "address_number"]).where("id", "=", a.property_id).executeTakeFirst()
      : Promise.resolve(undefined),
    a.opportunity_id ? db.selectFrom("opportunities").select(["id", "title", "status", "assigned_user_id"]).where("id", "=", a.opportunity_id).executeTakeFirst() : Promise.resolve(undefined),
    a.lead_id ? db.selectFrom("leads").select(["id", "assigned_user_id"]).where("id", "=", a.lead_id).executeTakeFirst() : Promise.resolve(undefined),
    db
      .selectFrom("notes as n")
      .leftJoin("users as u", "u.id", "n.author_user_id")
      .select(["n.id", "n.body", "n.created_at", "u.full_name as author_name"])
      .where("n.entity_type", "=", "appointment")
      .where("n.entity_id", "=", a.id)
      .where("n.deleted_at", "is", null)
      .orderBy("n.created_at", "desc")
      .execute(),
  ]);
  return { appointment: a, agent, contact, phones, property, opportunity, lead, notes };
}
