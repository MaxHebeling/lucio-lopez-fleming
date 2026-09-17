/**
 * Captura multicanal de leads: web, WhatsApp, redes, portales, email y carga manual convergen acá.
 * Garantías: contacto único (normalización + dedupe), idempotencia (idempotency_key) y evento lead.created
 * en la misma transacción (ninguna consulta se pierde aunque el aviso falle después).
 * Datos de contacto no verificados sobre un contacto existente (ver resolveContactForCapture) quedan en
 * leads.submitted_email / submitted_phone y no en la ficha.
 */
import { z } from "zod";
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { emitEvent } from "../events";
import { invalid } from "../errors";
import type { Actor } from "../auth/actor";
import { resolveContactForCapture, type ContactRole } from "../contacts/service";

export const captureLeadSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().max(254).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    phoneIsWhatsapp: z.boolean().optional(),
    message: z.string().trim().max(5000).nullable().optional(),
    sourceKey: z.string().regex(/^[a-z0-9_]{2,40}$/),
    propertyId: z.uuid().nullable().optional(),
    propertyCode: z.number().int().positive().nullable().optional(),
    operationInterest: z.enum(["sale", "rent", "temporary_rent", "appraisal", "sell_my_property", "other"]).nullable().optional(),
    utm: z.record(z.string(), z.string().max(200)).optional(),
    campaignId: z.uuid().nullable().optional(),
    conversationId: z.uuid().nullable().optional(),
    externalId: z.string().max(200).nullable().optional(),
    idempotencyKey: z.string().min(8).max(200).nullable().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    assignedUserId: z.uuid().nullable().optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), { message: "Dejanos un email o un teléfono para responderte", path: ["email"] });
export type CaptureLeadInput = z.input<typeof captureLeadSchema>;

export type CaptureLeadResult = { leadId: string; contactId: string; duplicate: boolean; assignedUserId: string | null };

function roleFor(interest: string | null | undefined): ContactRole {
  if (interest === "appraisal" || interest === "sell_my_property") return "owner";
  if (interest === "rent" || interest === "temporary_rent") return "tenant";
  return "prospect";
}

export async function captureLead(db: Database, actor: Actor, raw: CaptureLeadInput): Promise<CaptureLeadResult> {
  const input = captureLeadSchema.parse(raw);

  if (input.idempotencyKey) {
    const existing = await db.selectFrom("leads").select(["id", "contact_id", "assigned_user_id"]).where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (existing) return { leadId: existing.id, contactId: existing.contact_id, duplicate: true, assignedUserId: existing.assigned_user_id };
  }

  return db.transaction().execute(async (trx) => {
    const source = await trx.selectFrom("lead_sources").select(["key", "is_active"]).where("key", "=", input.sourceKey).executeTakeFirst();
    if (!source?.is_active) throw invalid("Fuente de lead inválida");

    let propertyId = input.propertyId ?? null;
    let branchId: string | null = null;
    if (!propertyId && input.propertyCode) {
      const p = await trx.selectFrom("properties").select("id").where("code", "=", input.propertyCode).where("deleted_at", "is", null).executeTakeFirst();
      propertyId = p?.id ?? null;
    }
    let assignedUserId = input.assignedUserId ?? null;
    if (propertyId) {
      const p = await trx.selectFrom("properties").select(["branch_id"]).where("id", "=", propertyId).executeTakeFirst();
      branchId = p?.branch_id ?? null;
      if (!assignedUserId) {
        const agent = await trx
          .selectFrom("property_agents as pa")
          .innerJoin("users as u", "u.id", "pa.user_id")
          .select("pa.user_id")
          .where("pa.property_id", "=", propertyId)
          .where("pa.role", "=", "lead")
          .where("u.is_active", "=", true)
          .where("u.deleted_at", "is", null)
          .executeTakeFirst();
        assignedUserId = agent?.user_id ?? null;
      }
    }

    const { contactId, unverified } = await resolveContactForCapture(trx, actor, {
      name: input.name,
      email: input.email,
      phone: input.phone,
      phoneIsWhatsapp: input.phoneIsWhatsapp,
      source: input.sourceKey,
      role: roleFor(input.operationInterest),
    });

    const inserted = await sql<{ id: string }>`
      insert into leads(organization_id, contact_id, source_key, property_id, campaign_id, conversation_id, branch_id,
        operation_interest, message, utm, external_id, idempotency_key, priority, assigned_user_id, assigned_at,
        submitted_email, submitted_phone)
      values (${actor.organizationId}, ${contactId}, ${input.sourceKey}, ${propertyId}, ${input.campaignId ?? null},
        ${input.conversationId ?? null}, ${branchId}, ${input.operationInterest ?? null}, ${input.message ?? null},
        ${JSON.stringify(input.utm ?? {})}::jsonb, ${input.externalId ?? null}, ${input.idempotencyKey ?? null},
        ${input.priority ?? "normal"}, ${assignedUserId}, ${assignedUserId ? new Date() : null},
        ${unverified.email}, ${unverified.phone})
      on conflict (idempotency_key) do nothing
      returning id`.execute(trx);

    if (!inserted.rows[0]) {
      // Carrera con otra request con la misma clave: devolvemos la existente.
      const existing = await trx.selectFrom("leads").select(["id", "contact_id", "assigned_user_id"]).where("idempotency_key", "=", input.idempotencyKey!).executeTakeFirstOrThrow();
      return { leadId: existing.id, contactId: existing.contact_id, duplicate: true, assignedUserId: existing.assigned_user_id };
    }
    const leadId = inserted.rows[0].id;

    await trx
      .insertInto("activities")
      .values({ entity_type: "contact", entity_id: contactId, kind: "lead_created", summary: `Nueva consulta (${input.sourceKey})`, metadata: JSON.stringify({ leadId, propertyId }) })
      .execute();
    if (unverified.email || unverified.phone) {
      // Aviso para revisión humana en la ficha del contacto (y los datos quedan visibles en el lead).
      await trx
        .insertInto("activities")
        .values({
          entity_type: "contact",
          entity_id: contactId,
          kind: "unverified_contact_data",
          summary: "Consulta con datos de contacto sin verificar: revisalos en el lead antes de agregarlos a la ficha",
          metadata: JSON.stringify({ leadId, sourceKey: input.sourceKey }),
        })
        .execute();
    }
    await audit(trx, actor, {
      action: "LEAD_CREATED",
      entityType: "lead",
      entityId: leadId,
      after: { sourceKey: input.sourceKey, propertyId, contactId, assignedUserId, unverifiedContactData: Boolean(unverified.email || unverified.phone) },
    });
    await emitEvent(trx, actor, {
      type: "lead.created",
      aggregateType: "lead",
      aggregateId: leadId,
      payload: {
        contactId,
        propertyId,
        sourceKey: input.sourceKey,
        assignedUserId,
        summary: [input.name, input.message].filter(Boolean).join(" — ").slice(0, 300),
        link: `/crm/leads/${leadId}`,
      },
      dedupeKey: `lead.created:${leadId}`,
    });
    return { leadId, contactId, duplicate: false, assignedUserId };
  });
}
