/**
 * Agenda: visitas, llamadas, reuniones y seguimientos. Horarios en zona America/Argentina/Salta.
 * La base impide superposiciones del mismo agente (constraint de exclusión) y acá se traduce a un error claro.
 * Una visita vinculada a una oportunidad la avanza a "visita_programada" / "visita_realizada" (auditado).
 */
import { z } from "zod";
import { pgCode, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { AppError, conflict, invalid } from "../errors";
import { notifyUser } from "../notifications";
import { agendaScope } from "../crm/access";
import { loadAppointment, loadContact, loadLead, loadOpportunity } from "../crm/entities";
import { isLocalDateTime, localToUtc } from "../crm/time";
import { advanceOpportunityForVisit } from "../opportunities/service";

export const APPOINTMENT_KINDS = ["visit", "call", "meeting", "follow_up"] as const;
export const KIND_LABEL: Record<(typeof APPOINTMENT_KINDS)[number], string> = { visit: "Visita", call: "Llamada", meeting: "Reunión", follow_up: "Seguimiento" };
export const OVERLAP_MESSAGE = "El agente ya tiene una cita en ese horario";

const localDateTime = z.string().refine(isLocalDateTime, "Fecha y hora inválidas");

export const createAppointmentSchema = z
  .object({
    kind: z.enum(APPOINTMENT_KINDS),
    title: z.string().trim().max(200).optional().transform((v) => v || null),
    startsAt: localDateTime,
    durationMinutes: z.coerce.number().int().min(5, "Mínimo 5 minutos").max(12 * 60, "Máximo 12 horas").default(60),
    propertyId: z.uuid().nullable().optional(),
    contactId: z.uuid().nullable().optional(),
    opportunityId: z.uuid().nullable().optional(),
    leadId: z.uuid().nullable().optional(),
    assignedUserId: z.uuid().nullable().optional(),
    location: z.string().trim().max(300).optional().transform((v) => v || null),
    notes: z.string().trim().max(5000).optional().transform((v) => v || null),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine((v) => v.kind !== "visit" || Boolean(v.propertyId || v.opportunityId || v.leadId), { message: "Elegí la propiedad a visitar", path: ["propertyId"] });

function overlapGuard(e: unknown): never {
  if (pgCode(e) === "23P01") throw new AppError("conflict", OVERLAP_MESSAGE, { startsAt: [OVERLAP_MESSAGE] });
  throw e;
}

async function assertAgent(trx: Tx, userId: string) {
  const u = await trx.selectFrom("users").select(["id", "full_name"]).where("id", "=", userId).where("kind", "=", "staff").where("is_active", "=", true).where("deleted_at", "is", null).executeTakeFirst();
  if (!u) throw invalid("Agente inválido", { assignedUserId: ["Elegí un usuario activo del equipo"] });
  return u;
}

export async function createAppointment(db: Database, actor: Actor, raw: z.input<typeof createAppointmentSchema>): Promise<{ id: string; replayed: boolean; opportunityAdvanced: boolean }> {
  requirePermission(actor, "agenda.manage");
  const input = createAppointmentSchema.parse(raw);
  const scope = agendaScope(actor);
  const assignee = input.assignedUserId ?? actorUserId(actor);
  if (!assignee) throw invalid("Elegí el agente", { assignedUserId: ["Elegí el agente"] });
  if (assignee !== actorUserId(actor) && !scope.all) throw invalid("No podés agendar para otra persona", { assignedUserId: ["Sin permiso para agendar a otros"] });
  const prev = await db.selectFrom("appointments").select("id").where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
  if (prev) return { id: prev.id, replayed: true, opportunityAdvanced: false };
  const startsAt = localToUtc(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  try {
    return await db.transaction().execute(async (trx) => {
      await assertAgent(trx, assignee);
      let contactId = input.contactId ?? null;
      let propertyId = input.propertyId ?? null;
      let leadId = input.leadId ?? null;
      if (input.opportunityId) {
        const opp = await loadOpportunity(trx, actor, input.opportunityId);
        contactId = contactId ?? opp.contact_id;
        propertyId = propertyId ?? opp.property_id;
        leadId = leadId ?? opp.lead_id;
      }
      if (input.leadId) {
        const lead = await loadLead(trx, actor, input.leadId);
        contactId = contactId ?? lead.contact_id;
        propertyId = propertyId ?? lead.property_id;
      }
      if (contactId) await loadContact(trx, actor, contactId);
      let property: { code: number; title: string; address_street: string | null; address_number: string | null } | undefined;
      if (propertyId) {
        requirePermission(actor, "properties.read");
        property = await trx.selectFrom("properties").select(["code", "title", "address_street", "address_number"]).where("id", "=", propertyId).where("deleted_at", "is", null).executeTakeFirst();
        if (!property) throw invalid("Propiedad inválida", { propertyId: ["Propiedad inexistente"] });
      }
      if (input.kind === "visit" && !property) throw invalid("Elegí la propiedad a visitar", { propertyId: ["Elegí la propiedad a visitar"] });
      const contact = contactId ? await trx.selectFrom("contacts").select("display_name").where("id", "=", contactId).executeTakeFirst() : undefined;
      const title =
        input.title ??
        [KIND_LABEL[input.kind], property ? `Prop. ${property.code}` : null, contact?.display_name].filter(Boolean).join(" · ").slice(0, 200);
      const location = input.location ?? (input.kind === "visit" && property ? [property.address_street, property.address_number].filter(Boolean).join(" ") || null : null);

      const row = await trx
        .insertInto("appointments")
        .values({
          kind: input.kind,
          title,
          starts_at: startsAt,
          ends_at: endsAt,
          property_id: propertyId,
          contact_id: contactId,
          opportunity_id: input.opportunityId ?? null,
          lead_id: leadId,
          assigned_user_id: assignee,
          location,
          notes: input.notes,
          idempotency_key: input.idempotencyKey,
          created_by: actorUserId(actor),
        })
        .onConflict((oc) => oc.column("idempotency_key").doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!row) {
        const again = await trx.selectFrom("appointments").select("id").where("idempotency_key", "=", input.idempotencyKey).executeTakeFirstOrThrow();
        return { id: again.id, replayed: true, opportunityAdvanced: false };
      }
      await audit(trx, actor, {
        action: "APPOINTMENT_CREATED",
        entityType: "appointment",
        entityId: row.id,
        after: { kind: input.kind, title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assignedUserId: assignee, propertyId, contactId, opportunityId: input.opportunityId ?? null, leadId },
      });
      let opportunityAdvanced = false;
      if (input.kind === "visit") {
        await emitEvent(trx, actor, {
          type: "visit.scheduled",
          aggregateType: "appointment",
          aggregateId: row.id,
          payload: { assignedUserId: assignee, propertyId, contactId, opportunityId: input.opportunityId ?? null, startsAt: startsAt.toISOString(), link: `/crm/agenda/${row.id}`, summary: title },
          dedupeKey: `visit.scheduled:${row.id}`,
        });
        if (input.opportunityId) {
          opportunityAdvanced = await advanceOpportunityForVisit(trx, actor, input.opportunityId, "visita_programada", "Visita agendada");
        }
      }
      if (assignee !== actorUserId(actor)) {
        await notifyUser(trx, assignee, { kind: "appointment.assigned", title: `${KIND_LABEL[input.kind]} agendada para vos`, body: title, link: `/crm/agenda/${row.id}`, entityType: "appointment", entityId: row.id, dedupeKey: `appointment.assigned:${row.id}` });
      }
      return { id: row.id, replayed: false, opportunityAdvanced };
    });
  } catch (e) {
    overlapGuard(e);
  }
}

export const appointmentActionSchema = z.object({
  appointmentId: z.uuid(),
  result: z.string().trim().max(5000).optional().transform((v) => v || null),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
});

type AppointmentRow = Awaited<ReturnType<typeof loadAppointment>>;

async function transition(
  db: Database,
  actor: Actor,
  appointmentId: string,
  fn: (trx: Tx, a: AppointmentRow) => Promise<{ changed: boolean; opportunityAdvanced?: boolean }>,
) {
  requirePermission(actor, "agenda.manage");
  try {
    return await db.transaction().execute(async (trx) => fn(trx, await loadAppointment(trx, actor, appointmentId, { forUpdate: true })));
  } catch (e) {
    overlapGuard(e);
  }
}

const ACTIVE = new Set(["scheduled", "confirmed"]);

export async function confirmAppointment(db: Database, actor: Actor, raw: z.input<typeof appointmentActionSchema>) {
  const input = appointmentActionSchema.parse(raw);
  return transition(db, actor, input.appointmentId, async (trx, a) => {
    if (a.status === "confirmed") return { changed: false };
    if (a.status !== "scheduled") throw conflict("Solo se confirman citas programadas");
    await trx.updateTable("appointments").set({ status: "confirmed" }).where("id", "=", a.id).execute();
    await audit(trx, actor, { action: "APPOINTMENT_CONFIRMED", entityType: "appointment", entityId: a.id, before: { status: a.status }, after: { status: "confirmed" } });
    return { changed: true };
  });
}

export async function completeAppointment(db: Database, actor: Actor, raw: z.input<typeof appointmentActionSchema>) {
  const input = appointmentActionSchema.parse(raw);
  if (!input.result || input.result.length < 3) throw invalid("Contá cómo fue", { result: ["El resultado es obligatorio"] });
  return transition(db, actor, input.appointmentId, async (trx, a) => {
    if (a.status === "completed") return { changed: false };
    if (!ACTIVE.has(a.status)) throw conflict("La cita no está activa");
    if (a.starts_at.getTime() > Date.now()) throw invalid("La cita todavía no empezó", { result: ["No se puede completar una cita futura"] });
    await trx.updateTable("appointments").set({ status: "completed", result: input.result }).where("id", "=", a.id).execute();
    await audit(trx, actor, { action: "APPOINTMENT_COMPLETED", entityType: "appointment", entityId: a.id, before: { status: a.status }, after: { status: "completed", result: input.result } });
    let opportunityAdvanced = false;
    if (a.kind === "visit") {
      await emitEvent(trx, actor, {
        type: "visit.completed",
        aggregateType: "appointment",
        aggregateId: a.id,
        payload: { assignedUserId: a.assigned_user_id, propertyId: a.property_id, contactId: a.contact_id, opportunityId: a.opportunity_id, link: `/crm/agenda/${a.id}`, summary: a.title },
        dedupeKey: `visit.completed:${a.id}`,
      });
      if (a.contact_id) {
        await trx
          .insertInto("activities")
          .values({ entity_type: "contact", entity_id: a.contact_id, kind: "visit_completed", summary: `Visita realizada: ${input.result}`.slice(0, 500), actor_user_id: actorUserId(actor), metadata: JSON.stringify({ appointmentId: a.id, propertyId: a.property_id }) })
          .execute();
      }
      if (a.opportunity_id) opportunityAdvanced = await advanceOpportunityForVisit(trx, actor, a.opportunity_id, "visita_realizada", "Visita realizada");
    }
    return { changed: true, opportunityAdvanced };
  });
}

export async function cancelAppointment(db: Database, actor: Actor, raw: z.input<typeof appointmentActionSchema>) {
  const input = appointmentActionSchema.parse(raw);
  if (!input.reason || input.reason.length < 3) throw invalid("Indicá el motivo", { reason: ["El motivo es obligatorio"] });
  return transition(db, actor, input.appointmentId, async (trx, a) => {
    if (a.status === "cancelled") return { changed: false };
    if (!ACTIVE.has(a.status)) throw conflict("La cita no está activa");
    await trx.updateTable("appointments").set({ status: "cancelled", cancel_reason: input.reason }).where("id", "=", a.id).execute();
    await audit(trx, actor, { action: "APPOINTMENT_CANCELLED", entityType: "appointment", entityId: a.id, before: { status: a.status }, after: { status: "cancelled", reason: input.reason } });
    return { changed: true };
  });
}

export async function markNoShow(db: Database, actor: Actor, raw: z.input<typeof appointmentActionSchema>) {
  const input = appointmentActionSchema.parse(raw);
  return transition(db, actor, input.appointmentId, async (trx, a) => {
    if (a.status === "no_show") return { changed: false };
    if (!ACTIVE.has(a.status)) throw conflict("La cita no está activa");
    if (a.starts_at.getTime() > Date.now()) throw invalid("La cita todavía no empezó");
    await trx.updateTable("appointments").set({ status: "no_show", result: input.result }).where("id", "=", a.id).execute();
    await audit(trx, actor, { action: "APPOINTMENT_NO_SHOW", entityType: "appointment", entityId: a.id, before: { status: a.status }, after: { status: "no_show", note: input.result } });
    return { changed: true };
  });
}

export const rescheduleSchema = z.object({
  appointmentId: z.uuid(),
  startsAt: localDateTime,
  durationMinutes: z.coerce.number().int().min(5, "Mínimo 5 minutos").max(12 * 60, "Máximo 12 horas"),
  assignedUserId: z.uuid().nullable().optional(),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
});

export async function rescheduleAppointment(db: Database, actor: Actor, raw: z.input<typeof rescheduleSchema>) {
  const input = rescheduleSchema.parse(raw);
  const scope = agendaScope(actor);
  return transition(db, actor, input.appointmentId, async (trx, a) => {
    if (!ACTIVE.has(a.status)) throw conflict("Solo se reprograman citas activas");
    const startsAt = localToUtc(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    const assignee = input.assignedUserId ?? a.assigned_user_id;
    if (assignee !== a.assigned_user_id) {
      if (!scope.all) throw invalid("No podés pasar la cita a otra persona", { assignedUserId: ["Sin permiso para agendar a otros"] });
      await assertAgent(trx, assignee);
    }
    if (startsAt.getTime() === a.starts_at.getTime() && endsAt.getTime() === a.ends_at.getTime() && assignee === a.assigned_user_id) return { changed: false };
    // Reprogramar vuelve la cita a "programada": la confirmación era para el horario anterior.
    await trx.updateTable("appointments").set({ starts_at: startsAt, ends_at: endsAt, assigned_user_id: assignee, status: "scheduled" }).where("id", "=", a.id).execute();
    await audit(trx, actor, {
      action: "APPOINTMENT_RESCHEDULED",
      entityType: "appointment",
      entityId: a.id,
      before: { startsAt: a.starts_at.toISOString(), endsAt: a.ends_at.toISOString(), assignedUserId: a.assigned_user_id, status: a.status },
      after: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), assignedUserId: assignee, status: "scheduled", reason: input.reason },
    });
    if (assignee !== actorUserId(actor)) {
      await notifyUser(trx, assignee, { kind: "appointment.rescheduled", title: "Cita reprogramada", body: a.title, link: `/crm/agenda/${a.id}`, entityType: "appointment", entityId: a.id, dedupeKey: `appointment.rescheduled:${a.id}:${startsAt.toISOString()}:${assignee}` });
    }
    return { changed: true };
  });
}
