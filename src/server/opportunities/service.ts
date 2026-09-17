/**
 * Oportunidades y pipeline: alta (desde lead o contacto), movimiento de etapa con historial, ganar/perder/pausar,
 * edición de presupuesto/requisitos y asignación. Todo en transacción con bloqueo de fila, auditoría y evento.
 */
import { z } from "zod";
import type { SchemaIn } from "../crm/types";
import { sql, type Database, type Tx } from "../db";
import { audit, diff } from "../audit";
import { actorUserId, can, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid, notFound } from "../errors";
import { notifyUser } from "../notifications";
import { loadContact, loadLead, loadOpportunity } from "../crm/entities";

const money = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : v),
  z.number({ error: "Número inválido" }).min(0, "No puede ser negativo").max(999_999_999_999, "Monto demasiado grande").nullable(),
);

export const requirementsSchema = z
  .object({
    text: z.string().trim().max(2000).optional(),
    zones: z.string().trim().max(300).optional(),
    bedroomsMin: z.number().int().min(0).max(50).nullable().optional(),
    propertyTypes: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(15).optional(),
  })
  .strict();

const PIPELINE_BY_INTEREST: Record<string, string> = {
  sale: "ventas",
  rent: "alquileres",
  temporary_rent: "alquileres",
  appraisal: "captacion",
  sell_my_property: "captacion",
};

export const createOpportunitySchema = z
  .object({
    leadId: z.uuid().nullable().optional(),
    contactId: z.uuid().nullable().optional(),
    pipelineKey: z.string().regex(/^[a-z0-9_]{2,40}$/).nullable().optional(),
    propertyId: z.uuid().nullable().optional(),
    operation: z.enum(["sale", "rent", "temporary_rent"]).nullable().optional(),
    title: z.string().trim().max(200).nullish().transform((v) => v || null),
    budgetMin: money.optional(),
    budgetMax: money.optional(),
    budgetCurrency: z.enum(["USD", "ARS"]).nullable().optional(),
    requirements: requirementsSchema.optional(),
    assignedUserId: z.uuid().nullable().optional(),
    idempotencyKey: z.string().min(8).max(200).nullable().optional(),
  })
  .refine((v) => Boolean(v.leadId || v.contactId), { message: "Elegí un lead o un contacto", path: ["contactId"] })
  .refine((v) => v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax, { message: "El mínimo supera al máximo", path: ["budgetMax"] });

async function assertActiveStaff(trx: Tx, userId: string) {
  const u = await trx.selectFrom("users").select("id").where("id", "=", userId).where("kind", "=", "staff").where("is_active", "=", true).where("deleted_at", "is", null).executeTakeFirst();
  if (!u) throw invalid("Usuario inválido", { assignedUserId: ["Elegí un usuario activo del equipo"] });
}

export async function createOpportunity(db: Database, actor: Actor, raw: SchemaIn<typeof createOpportunitySchema>): Promise<{ id: string; replayed: boolean }> {
  requirePermission(actor, "opportunities.update");
  const input = createOpportunitySchema.parse(raw);
  if (input.idempotencyKey) {
    const prev = await db.selectFrom("opportunities").select("id").where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (prev) return { id: prev.id, replayed: true };
  }
  return db.transaction().execute(async (trx) => {
    let contactId = input.contactId ?? null;
    let propertyId = input.propertyId ?? null;
    let assignedUserId = input.assignedUserId ?? null;
    let interest: string | null = null;
    let lead: Awaited<ReturnType<typeof loadLead>> | null = null;
    if (input.leadId) {
      requirePermission(actor, "leads.update");
      lead = await loadLead(trx, actor, input.leadId, { forUpdate: true });
      const existing = await trx.selectFrom("opportunities").select("id").where("lead_id", "=", lead.id).where("deleted_at", "is", null).executeTakeFirst();
      if (existing) return { id: existing.id, replayed: true };
      contactId = lead.contact_id;
      propertyId = propertyId ?? lead.property_id;
      assignedUserId = input.assignedUserId !== undefined ? input.assignedUserId : lead.assigned_user_id;
      interest = lead.operation_interest;
    } else {
      await loadContact(trx, actor, contactId!);
    }
    assignedUserId = assignedUserId ?? actorUserId(actor);
    if (assignedUserId !== actorUserId(actor) && !can(actor, "opportunities.assign")) {
      // Sin permiso de asignar: solo se puede crear a nombre propio o respetar la asignación del lead que uno ve.
      if (!(lead && assignedUserId === lead.assigned_user_id && can(actor, "opportunities.read_all"))) {
        throw invalid("No podés asignar oportunidades a otra persona", { assignedUserId: ["Sin permiso para asignar"] });
      }
    }
    if (assignedUserId) await assertActiveStaff(trx, assignedUserId);

    const pipelineKey = input.pipelineKey ?? PIPELINE_BY_INTEREST[interest ?? ""] ?? "ventas";
    const pipeline = await trx.selectFrom("pipelines").select(["id", "name", "kind"]).where("key", "=", pipelineKey).executeTakeFirst();
    if (!pipeline) throw invalid("Pipeline inválido", { pipelineKey: ["Pipeline inválido"] });
    const stage = await trx
      .selectFrom("pipeline_stages")
      .select(["id", "key"])
      .where("pipeline_id", "=", pipeline.id)
      .where("outcome", "=", "open")
      .where("is_active", "=", true)
      .orderBy("sort_order")
      .executeTakeFirst();
    if (!stage) throw conflict("El pipeline no tiene etapas abiertas");

    let property: { code: number; title: string } | undefined;
    if (propertyId) {
      requirePermission(actor, "properties.read");
      property = await trx.selectFrom("properties").select(["code", "title"]).where("id", "=", propertyId).where("deleted_at", "is", null).where("is_demo", "=", false).executeTakeFirst();
      if (!property) throw invalid("Propiedad inválida", { propertyId: ["Propiedad inexistente"] });
    }
    const contact = await trx.selectFrom("contacts").select("display_name").where("id", "=", contactId!).executeTakeFirstOrThrow();
    const title = input.title ?? `${contact.display_name} · ${property ? `Prop. ${property.code}` : pipeline.name}`.slice(0, 200);
    const operation =
      input.operation ?? (interest === "sale" || interest === "rent" || interest === "temporary_rent" ? interest : pipeline.kind === "sales" ? "sale" : pipeline.kind === "rentals" ? "rent" : null);

    const row = await trx
      .insertInto("opportunities")
      .values({
        organization_id: actor.organizationId,
        lead_id: lead?.id ?? null,
        contact_id: contactId!,
        property_id: propertyId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        operation,
        title,
        budget_min: input.budgetMin == null ? null : String(input.budgetMin),
        budget_max: input.budgetMax == null ? null : String(input.budgetMax),
        budget_currency: input.budgetMin != null || input.budgetMax != null ? (input.budgetCurrency ?? "USD") : (input.budgetCurrency ?? null),
        requirements: JSON.stringify(input.requirements ?? {}),
        assigned_user_id: assignedUserId,
        created_by: actorUserId(actor),
        idempotency_key: input.idempotencyKey ?? null,
      })
      .onConflict((oc) => oc.column("idempotency_key").where("idempotency_key", "is not", null).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!row) {
      const prev = await trx.selectFrom("opportunities").select("id").where("idempotency_key", "=", input.idempotencyKey!).executeTakeFirstOrThrow();
      return { id: prev.id, replayed: true };
    }
    await trx.insertInto("opportunity_stage_history").values({ opportunity_id: row.id, from_stage_id: null, to_stage_id: stage.id, changed_by: actorUserId(actor), note: lead ? "Creada desde lead" : null }).execute();
    if (lead && lead.status !== "converted") {
      await trx.updateTable("leads").set({ status: "converted" }).where("id", "=", lead.id).execute();
      await audit(trx, actor, { action: "LEAD_CONVERTED", entityType: "lead", entityId: lead.id, before: { status: lead.status }, after: { status: "converted", opportunityId: row.id } });
    }
    await audit(trx, actor, {
      action: "OPPORTUNITY_CREATED",
      entityType: "opportunity",
      entityId: row.id,
      after: { title, pipeline: pipelineKey, stage: stage.key, contactId, propertyId, leadId: lead?.id ?? null, assignedUserId },
    });
    await emitEvent(trx, actor, {
      type: "opportunity.created",
      aggregateType: "opportunity",
      aggregateId: row.id,
      payload: { pipeline: pipelineKey, stage: stage.key, contactId, leadId: lead?.id ?? null, assignedUserId, link: `/crm/pipeline/${row.id}`, summary: title },
      dedupeKey: `opportunity.created:${row.id}`,
    });
    if (assignedUserId && assignedUserId !== actorUserId(actor)) {
      await notifyUser(trx, assignedUserId, { kind: "opportunity.assigned", title: "Te asignaron una oportunidad", body: title, link: `/crm/pipeline/${row.id}`, entityType: "opportunity", entityId: row.id, dedupeKey: `opportunity.assigned:${row.id}:${assignedUserId}:create` });
    }
    return { id: row.id, replayed: false };
  });
}

export const moveStageSchema = z.object({
  opportunityId: z.uuid(),
  stageId: z.uuid(),
  note: z.string().trim().max(2000).nullish().transform((v) => v || null),
  lostReason: z.string().trim().max(500).nullish().transform((v) => v || null),
});

const STATUS_BY_OUTCOME = { open: "open", won: "won", lost: "lost", paused: "paused" } as const;

async function moveInTx(trx: Tx, actor: Actor, opp: { id: string; pipeline_id: string; stage_id: string; status: string; lost_reason: string | null; assigned_user_id: string | null; title: string }, stageId: string, opts: { note?: string | null; lostReason?: string | null; auto?: string }) {
  if (opp.stage_id === stageId) return { changed: false };
  const [from, to] = await Promise.all([
    trx.selectFrom("pipeline_stages").select(["id", "key", "name", "outcome"]).where("id", "=", opp.stage_id).executeTakeFirstOrThrow(),
    trx.selectFrom("pipeline_stages").select(["id", "key", "name", "outcome", "pipeline_id", "is_active"]).where("id", "=", stageId).executeTakeFirst(),
  ]);
  if (!to || to.pipeline_id !== opp.pipeline_id || !to.is_active) throw invalid("La etapa no pertenece a este pipeline", { stageId: ["Etapa inválida"] });
  const status = STATUS_BY_OUTCOME[to.outcome as keyof typeof STATUS_BY_OUTCOME];
  if (status === "lost" && !opts.lostReason) throw invalid("Indicá el motivo de la pérdida", { lostReason: ["El motivo es obligatorio"] });
  const now = new Date();
  const set = {
    stage_id: to.id,
    status,
    stage_entered_at: now,
    closed_at: status === "won" || status === "lost" ? now : null,
    lost_reason: status === "lost" ? opts.lostReason! : null,
  };
  await trx.updateTable("opportunities").set(set).where("id", "=", opp.id).execute();
  const note = [opts.note, status === "lost" ? `Motivo: ${opts.lostReason}` : null].filter(Boolean).join(" · ") || null;
  await trx.insertInto("opportunity_stage_history").values({ opportunity_id: opp.id, from_stage_id: from.id, to_stage_id: to.id, changed_by: actorUserId(actor), note }).execute();
  await audit(trx, actor, {
    action: "OPPORTUNITY_STAGE_CHANGED",
    entityType: "opportunity",
    entityId: opp.id,
    before: { stage: from.key, status: opp.status, lostReason: opp.lost_reason },
    after: { stage: to.key, status, lostReason: set.lost_reason },
    metadata: opts.auto ? { automatic: opts.auto } : undefined,
  });
  await emitEvent(trx, actor, {
    type: "opportunity.stage_changed",
    aggregateType: "opportunity",
    aggregateId: opp.id,
    payload: { from: from.key, to: to.key, status, assignedUserId: opp.assigned_user_id, link: `/crm/pipeline/${opp.id}`, summary: `${opp.title}: ${from.name} → ${to.name}` },
  });
  return { changed: true, status };
}

export async function moveOpportunityStage(db: Database, actor: Actor, raw: SchemaIn<typeof moveStageSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "opportunities.update");
  const input = moveStageSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const opp = await loadOpportunity(trx, actor, input.opportunityId, { forUpdate: true });
    return moveInTx(trx, actor, opp, input.stageId, { note: input.note, lostReason: input.lostReason });
  });
}

async function stageByOutcome(trx: Tx, pipelineId: string, outcome: "won" | "lost" | "paused") {
  const s = await trx.selectFrom("pipeline_stages").select("id").where("pipeline_id", "=", pipelineId).where("outcome", "=", outcome).where("is_active", "=", true).orderBy("sort_order").executeTakeFirst();
  if (!s) throw conflict("El pipeline no tiene esa etapa");
  return s.id;
}

export const closeSchema = z.object({
  opportunityId: z.uuid(),
  note: z.string().trim().max(2000).nullish().transform((v) => v || null),
  lostReason: z.string().trim().max(500).nullish().transform((v) => v || null),
  valueAmount: money.optional(),
  valueCurrency: z.enum(["USD", "ARS"]).nullable().optional(),
});

export async function winOpportunity(db: Database, actor: Actor, raw: SchemaIn<typeof closeSchema>) {
  requirePermission(actor, "opportunities.update");
  const input = closeSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const opp = await loadOpportunity(trx, actor, input.opportunityId, { forUpdate: true });
    if (opp.status === "won") return { changed: false };
    if (input.valueAmount != null) {
      await trx.updateTable("opportunities").set({ value_amount: String(input.valueAmount), value_currency: input.valueCurrency ?? opp.budget_currency ?? "USD" }).where("id", "=", opp.id).execute();
    }
    return moveInTx(trx, actor, opp, await stageByOutcome(trx, opp.pipeline_id, "won"), { note: input.note });
  });
}

export async function loseOpportunity(db: Database, actor: Actor, raw: SchemaIn<typeof closeSchema>) {
  requirePermission(actor, "opportunities.update");
  const input = closeSchema.parse(raw);
  if (!input.lostReason) throw invalid("Indicá el motivo de la pérdida", { lostReason: ["El motivo es obligatorio"] });
  return db.transaction().execute(async (trx) => {
    const opp = await loadOpportunity(trx, actor, input.opportunityId, { forUpdate: true });
    if (opp.status === "lost") return { changed: false };
    return moveInTx(trx, actor, opp, await stageByOutcome(trx, opp.pipeline_id, "lost"), { note: input.note, lostReason: input.lostReason });
  });
}

export async function pauseOpportunity(db: Database, actor: Actor, raw: SchemaIn<typeof closeSchema>) {
  requirePermission(actor, "opportunities.update");
  const input = closeSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const opp = await loadOpportunity(trx, actor, input.opportunityId, { forUpdate: true });
    if (opp.status === "paused") return { changed: false };
    return moveInTx(trx, actor, opp, await stageByOutcome(trx, opp.pipeline_id, "paused"), { note: input.note });
  });
}

export const updateOpportunitySchema = z
  .object({
    opportunityId: z.uuid(),
    title: z.string().trim().min(2, "Mínimo 2 caracteres").max(200).optional(),
    propertyId: z.uuid().nullable().optional(),
    operation: z.enum(["sale", "rent", "temporary_rent"]).nullable().optional(),
    budgetMin: money.optional(),
    budgetMax: money.optional(),
    budgetCurrency: z.enum(["USD", "ARS"]).nullable().optional(),
    valueAmount: money.optional(),
    valueCurrency: z.enum(["USD", "ARS"]).nullable().optional(),
    expectedCloseDate: z.preprocess((v) => (v === "" ? null : v), z.iso.date().nullable().optional()),
    requirements: requirementsSchema.optional(),
  })
  .refine((v) => v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax, { message: "El mínimo supera al máximo", path: ["budgetMax"] });

export async function updateOpportunity(db: Database, actor: Actor, raw: SchemaIn<typeof updateOpportunitySchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "opportunities.update");
  const input = updateOpportunitySchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const opp = await loadOpportunity(trx, actor, input.opportunityId, { forUpdate: true });
    const next: Record<string, unknown> = {};
    if (input.title !== undefined) next.title = input.title;
    if (input.propertyId !== undefined) {
      if (input.propertyId) {
        requirePermission(actor, "properties.read");
        const p = await trx.selectFrom("properties").select("id").where("id", "=", input.propertyId).where("deleted_at", "is", null).where("is_demo", "=", false).executeTakeFirst();
        if (!p) throw invalid("Propiedad inválida", { propertyId: ["Propiedad inexistente"] });
      }
      next.property_id = input.propertyId;
    }
    if (input.operation !== undefined) next.operation = input.operation;
    if (input.budgetMin !== undefined) next.budget_min = input.budgetMin == null ? null : Number(input.budgetMin).toFixed(2);
    if (input.budgetMax !== undefined) next.budget_max = input.budgetMax == null ? null : Number(input.budgetMax).toFixed(2);
    if (input.budgetCurrency !== undefined) next.budget_currency = input.budgetCurrency;
    if (input.valueAmount !== undefined) next.value_amount = input.valueAmount == null ? null : Number(input.valueAmount).toFixed(2);
    if (input.valueCurrency !== undefined) next.value_currency = input.valueCurrency;
    if (input.expectedCloseDate !== undefined) next.expected_close_date = input.expectedCloseDate;
    if (input.requirements !== undefined) next.requirements = input.requirements;
    const min = next.budget_min !== undefined ? next.budget_min : opp.budget_min;
    const max = next.budget_max !== undefined ? next.budget_max : opp.budget_max;
    if (min != null && max != null && Number(min) > Number(max)) throw invalid("El mínimo supera al máximo", { budgetMax: ["El mínimo supera al máximo"] });
    if ((next.budget_min != null || next.budget_max != null) && next.budget_currency === undefined && !opp.budget_currency) next.budget_currency = "USD";
    const changes = diff(opp as unknown as Record<string, unknown>, next);
    if (!Object.keys(changes.after).length) return { changed: false };
    const set = { ...changes.after } as Record<string, unknown>;
    if ("requirements" in set) set.requirements = JSON.stringify(set.requirements);
    await trx.updateTable("opportunities").set(set as never).where("id", "=", opp.id).execute();
    await audit(trx, actor, { action: "OPPORTUNITY_UPDATED", entityType: "opportunity", entityId: opp.id, before: changes.before, after: changes.after });
    return { changed: true };
  });
}

export const assignOpportunitySchema = z.object({ opportunityId: z.uuid(), userId: z.uuid().nullable() });

export async function assignOpportunity(db: Database, actor: Actor, raw: SchemaIn<typeof assignOpportunitySchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "opportunities.assign");
  const input = assignOpportunitySchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const opp = await loadOpportunity(trx, actor, input.opportunityId, { forUpdate: true });
    if (opp.assigned_user_id === input.userId) return { changed: false };
    if (input.userId) await assertActiveStaff(trx, input.userId);
    await trx.updateTable("opportunities").set({ assigned_user_id: input.userId }).where("id", "=", opp.id).execute();
    const auditRow = await sql<{ n: string }>`select count(*)::text as n from audit_logs where entity_type = 'opportunity' and entity_id = ${opp.id} and action = 'OPPORTUNITY_ASSIGNED'`.execute(trx);
    await audit(trx, actor, { action: "OPPORTUNITY_ASSIGNED", entityType: "opportunity", entityId: opp.id, before: { assignedUserId: opp.assigned_user_id }, after: { assignedUserId: input.userId } });
    if (input.userId && input.userId !== actorUserId(actor)) {
      await notifyUser(trx, input.userId, {
        kind: "opportunity.assigned",
        title: "Te asignaron una oportunidad",
        body: opp.title,
        link: `/crm/pipeline/${opp.id}`,
        entityType: "opportunity",
        entityId: opp.id,
        dedupeKey: `opportunity.assigned:${opp.id}:${input.userId}:${auditRow.rows[0]?.n ?? "0"}`,
      });
    }
    return { changed: true };
  });
}

/**
 * Avance automático por agenda: si la oportunidad está abierta y en una etapa anterior a `stageKey`, la mueve.
 * Nunca retrocede ni reabre oportunidades cerradas. Para usar dentro de la transacción de la cita.
 */
export async function advanceOpportunityForVisit(trx: Tx, actor: Actor, opportunityId: string, stageKey: "visita_programada" | "visita_realizada", reason: string): Promise<boolean> {
  const opp = await trx.selectFrom("opportunities").selectAll().where("id", "=", opportunityId).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
  if (!opp) throw notFound("Oportunidad");
  if (opp.status !== "open") return false;
  const [current, target] = await Promise.all([
    trx.selectFrom("pipeline_stages").select(["sort_order"]).where("id", "=", opp.stage_id).executeTakeFirstOrThrow(),
    trx.selectFrom("pipeline_stages").select(["id", "sort_order"]).where("pipeline_id", "=", opp.pipeline_id).where("key", "=", stageKey).where("is_active", "=", true).executeTakeFirst(),
  ]);
  if (!target || current.sort_order >= target.sort_order) return false;
  await moveInTx(trx, actor, opp, target.id, { note: reason, auto: reason });
  return true;
}
