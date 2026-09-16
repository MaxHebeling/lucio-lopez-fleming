/**
 * Gestión de leads desde el CRM: carga manual, asignación, estado, prioridad y primer contacto.
 * Alcance: con `leads.read_all` se opera sobre todos; con `leads.read_own` solo sobre los asignados a uno.
 */
import { z } from "zod";
import type { Database, Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, can, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid } from "../errors";
import { notifyUser } from "../notifications";
import { captureLead, type CaptureLeadResult } from "./capture";
import { loadLead } from "../crm/entities";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted", "discarded"] as const;
export const LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const MANUAL_LEAD_SOURCES = ["manual", "phone", "walk_in"] as const;

export const manualLeadSchema = z
  .object({
    name: z.string().trim().min(2, "Ingresá el nombre").max(200),
    email: z.string().trim().max(254).optional().transform((v) => v || null),
    phone: z.string().trim().max(40).optional().transform((v) => v || null),
    phoneIsWhatsapp: z.boolean().optional(),
    message: z.string().trim().max(5000).optional().transform((v) => v || null),
    sourceKey: z.enum(MANUAL_LEAD_SOURCES),
    propertyId: z.uuid().nullable().optional(),
    operationInterest: z.enum(["sale", "rent", "temporary_rent", "appraisal", "sell_my_property", "other"]).nullable().optional(),
    priority: z.enum(LEAD_PRIORITIES).default("normal"),
    assignedUserId: z.uuid().nullable().optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine((v) => Boolean(v.email || v.phone), { message: "Ingresá un email o un teléfono", path: ["phone"] });

/** Carga manual (teléfono, oficina, otra vía). Reusa la captura multicanal: dedupe de contacto + idempotencia + lead.created. */
export async function createManualLead(db: Database, actor: Actor, raw: z.input<typeof manualLeadSchema>): Promise<CaptureLeadResult> {
  requirePermission(actor, "leads.create");
  const input = manualLeadSchema.parse(raw);
  let assignedUserId = input.assignedUserId ?? null;
  if (!can(actor, "leads.assign")) {
    // Sin permiso de asignar: el lead queda a cargo de quien lo carga (si no, lo perdería de vista).
    if (assignedUserId && assignedUserId !== actorUserId(actor)) throw invalid("No podés asignar leads a otra persona", { assignedUserId: ["Sin permiso para asignar"] });
    assignedUserId = actorUserId(actor);
  }
  if (assignedUserId) await assertActiveStaff(db, assignedUserId);
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(input.email)) throw invalid("Email inválido", { email: ["Email inválido"] });
  return captureLead(db, actor, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    phoneIsWhatsapp: input.phoneIsWhatsapp,
    message: input.message,
    sourceKey: input.sourceKey,
    propertyId: input.propertyId ?? null,
    operationInterest: input.operationInterest ?? null,
    priority: input.priority,
    assignedUserId,
    idempotencyKey: `crm:${input.idempotencyKey}`,
  });
}

async function assertActiveStaff(db: Database | Tx, userId: string) {
  const u = await db.selectFrom("users").select("id").where("id", "=", userId).where("kind", "=", "staff").where("is_active", "=", true).where("deleted_at", "is", null).executeTakeFirst();
  if (!u) throw invalid("Usuario inválido", { assignedUserId: ["Elegí un usuario activo del equipo"] });
}

export const assignLeadSchema = z.object({ leadId: z.uuid(), userId: z.uuid().nullable() });

export async function assignLead(db: Database, actor: Actor, raw: z.input<typeof assignLeadSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "leads.assign");
  const input = assignLeadSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const lead = await loadLead(trx, actor, input.leadId, { forUpdate: true });
    if (lead.assigned_user_id === input.userId) return { changed: false };
    if (input.userId) await assertActiveStaff(trx, input.userId);
    const now = new Date();
    await trx.updateTable("leads").set({ assigned_user_id: input.userId, assigned_at: input.userId ? now : null }).where("id", "=", lead.id).execute();
    await audit(trx, actor, { action: "LEAD_ASSIGNED", entityType: "lead", entityId: lead.id, before: { assignedUserId: lead.assigned_user_id }, after: { assignedUserId: input.userId } });
    if (input.userId) {
      const contact = await trx.selectFrom("contacts").select("display_name").where("id", "=", lead.contact_id).executeTakeFirst();
      const eventId = await emitEvent(trx, actor, {
        type: "lead.assigned",
        aggregateType: "lead",
        aggregateId: lead.id,
        payload: { assignedUserId: input.userId, previousUserId: lead.assigned_user_id, contactId: lead.contact_id, link: `/crm/leads/${lead.id}`, summary: contact?.display_name ?? null },
      });
      if (input.userId !== actorUserId(actor)) {
        await notifyUser(trx, input.userId, {
          kind: "lead.assigned",
          title: "Te asignaron un lead",
          body: contact?.display_name ?? null,
          link: `/crm/leads/${lead.id}`,
          entityType: "lead",
          entityId: lead.id,
          dedupeKey: `lead.assigned:${eventId}`,
        });
      }
    }
    return { changed: true };
  });
}

export const leadStatusSchema = z.object({ leadId: z.uuid(), status: z.enum(LEAD_STATUSES).exclude(["converted"]) });

export async function changeLeadStatus(db: Database, actor: Actor, raw: z.input<typeof leadStatusSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "leads.update");
  const input = leadStatusSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const lead = await loadLead(trx, actor, input.leadId, { forUpdate: true });
    if (lead.status === input.status) return { changed: false };
    if (lead.status === "converted") throw conflict("El lead ya se convirtió en oportunidad");
    const set: { status: string; first_response_at?: Date } = { status: input.status };
    // Pasar a "contactado" registra el primer contacto si todavía no estaba.
    if (input.status === "contacted" && !lead.first_response_at) set.first_response_at = new Date();
    await trx.updateTable("leads").set(set).where("id", "=", lead.id).execute();
    await audit(trx, actor, { action: "LEAD_STATUS_CHANGED", entityType: "lead", entityId: lead.id, before: { status: lead.status }, after: set });
    return { changed: true };
  });
}

export const leadPrioritySchema = z.object({ leadId: z.uuid(), priority: z.enum(LEAD_PRIORITIES) });

export async function changeLeadPriority(db: Database, actor: Actor, raw: z.input<typeof leadPrioritySchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "leads.update");
  const input = leadPrioritySchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const lead = await loadLead(trx, actor, input.leadId, { forUpdate: true });
    if (lead.priority === input.priority) return { changed: false };
    await trx.updateTable("leads").set({ priority: input.priority }).where("id", "=", lead.id).execute();
    await audit(trx, actor, { action: "LEAD_PRIORITY_CHANGED", entityType: "lead", entityId: lead.id, before: { priority: lead.priority }, after: { priority: input.priority } });
    return { changed: true };
  });
}

export const firstContactSchema = z.object({
  leadId: z.uuid(),
  channel: z.enum(["call", "whatsapp", "email", "in_person", "other"]),
  note: z.string().trim().max(2000).optional().transform((v) => v || null),
});

const CHANNEL_LABEL = { call: "llamada", whatsapp: "WhatsApp", email: "email", in_person: "en persona", other: "otro medio" } as const;

/** Registra el primer contacto con el lead. `first_response_at` se fija una sola vez. */
export async function registerFirstContact(db: Database, actor: Actor, raw: z.input<typeof firstContactSchema>): Promise<{ alreadyRegistered: boolean }> {
  requirePermission(actor, "leads.update");
  const input = firstContactSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const lead = await loadLead(trx, actor, input.leadId, { forUpdate: true });
    if (lead.first_response_at) return { alreadyRegistered: true };
    const now = new Date();
    const status = lead.status === "new" ? "contacted" : lead.status;
    await trx.updateTable("leads").set({ first_response_at: now, status }).where("id", "=", lead.id).execute();
    const summary = `Primer contacto por ${CHANNEL_LABEL[input.channel]}${input.note ? `: ${input.note}` : ""}`.slice(0, 500);
    await trx
      .insertInto("activities")
      .values([
        { entity_type: "lead", entity_id: lead.id, kind: "first_contact", summary, actor_user_id: actorUserId(actor), metadata: JSON.stringify({ channel: input.channel }) },
        { entity_type: "contact", entity_id: lead.contact_id, kind: "first_contact", summary, actor_user_id: actorUserId(actor), metadata: JSON.stringify({ channel: input.channel, leadId: lead.id }) },
      ])
      .execute();
    await audit(trx, actor, {
      action: "LEAD_FIRST_CONTACT",
      entityType: "lead",
      entityId: lead.id,
      before: { status: lead.status, firstResponseAt: null },
      after: { status, firstResponseAt: now.toISOString(), channel: input.channel },
    });
    return { alreadyRegistered: false };
  });
}
