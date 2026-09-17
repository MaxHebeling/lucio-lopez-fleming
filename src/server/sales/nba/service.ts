/**
 * Siguiente acción recomendada sobre datos reales, con el alcance del usuario. Reglas en rules.ts.
 * Decisiones (aceptar → tarea real vía el servicio de tareas; descartar; posponer) en `sales_recommendations`,
 * ancladas al CONTACTO: una decisión tomada desde el lead vale también en la ficha del contacto.
 */
import "server-only";
import { z } from "zod";
import { sql, type Database, type Executor } from "../../db";
import { audit } from "../../audit";
import { can, requirePermission, type Actor, type StaffActor, type SystemActor } from "../../auth/actor";
import { loadLead, loadOpportunity } from "../../crm/entities";
import { utcToLocalInput } from "../../crm/time";
import { conflict, notFound } from "../../errors";
import { emitEvent } from "../../events";
import { createTask } from "../../tasks/service";
import { matchSettings, toMatchProfile } from "../matching/service";
import { loadMatchPropertiesByIds } from "../matching/properties";
import { profileIsMatchable, scoreMatch } from "../matching/score";
import { loadEffectiveProfiles } from "../profile/service";
import { loadSalesContact } from "../scope";
import { loadSignalFacts } from "../signals/service";
import { computeIntentSignals } from "../signals/rules";
import { recommendNextActions, type NbaFacts, type Recommendation, type RecommendationRule } from "./rules";

export const NBA_ENTITY_TYPES = ["contact", "lead", "opportunity"] as const;
export type NbaEntityType = (typeof NBA_ENTITY_TYPES)[number];

export const nbaEntitySchema = z.object({ entityType: z.enum(NBA_ENTITY_TYPES), entityId: z.uuid() });
const RULES = ["contact_today", "first_response", "schedule_visit", "visit_followup", "send_new_options", "confirm_budget", "review_profile", "reactivate"] as const;
export const nbaDecisionSchema = nbaEntitySchema.extend({ ruleKey: z.enum(RULES), fingerprint: z.string().regex(/^[0-9a-f]{16,64}$/) });
export const nbaDismissSchema = nbaDecisionSchema.extend({ note: z.string().trim().max(300).optional() });
export const nbaSnoozeSchema = nbaDecisionSchema.extend({ days: z.union([z.literal(1), z.literal(3), z.literal(7)]) });

type Resolved = { staff: StaffActor; contactId: string; leadId: string | null; opportunityId: string | null };

async function resolveEntity(db: Executor, actor: Actor, input: z.infer<typeof nbaEntitySchema>): Promise<Resolved> {
  if (input.entityType === "lead") {
    const lead = await loadLead(db, actor, input.entityId);
    const { actor: staff } = await loadSalesContact(db, actor, lead.contact_id);
    if (lead.organization_id !== staff.organizationId) throw notFound("Lead");
    return { staff, contactId: lead.contact_id, leadId: lead.id, opportunityId: null };
  }
  if (input.entityType === "opportunity") {
    const opp = await loadOpportunity(db, actor, input.entityId);
    const { actor: staff } = await loadSalesContact(db, actor, opp.contact_id);
    if (opp.organization_id !== staff.organizationId) throw notFound("Oportunidad");
    return { staff, contactId: opp.contact_id, leadId: opp.lead_id, opportunityId: opp.id };
  }
  const { actor: staff } = await loadSalesContact(db, actor, input.entityId);
  return { staff, contactId: input.entityId, leadId: null, opportunityId: null };
}

/** Hechos de la regla. `scopeUserId` limita leads/oportunidades a los asignados (agente sin «ver todos»). */
export async function gatherNbaFacts(db: Executor, organizationId: string, r: { contactId: string; leadId: string | null; opportunityId: string | null; scopeUserId: string | null }, now = new Date()): Promise<NbaFacts> {
  const leadQ = db
    .selectFrom("leads as l")
    .leftJoin("properties as p", "p.id", "l.property_id")
    .select(["l.id", "l.status", "l.created_at", "l.first_response_at", "p.code"])
    .where("l.contact_id", "=", r.contactId)
    .where("l.organization_id", "=", organizationId)
    .where("l.deleted_at", "is", null);
  const lead = r.leadId
    ? await leadQ.where("l.id", "=", r.leadId).executeTakeFirst()
    : await (r.scopeUserId ? leadQ.where("l.assigned_user_id", "=", r.scopeUserId) : leadQ).where("l.status", "in", ["new", "contacted", "qualified"]).orderBy("l.created_at", "desc").executeTakeFirst();
  const oppQ = db
    .selectFrom("opportunities as o")
    .innerJoin("pipeline_stages as s", "s.id", "o.stage_id")
    .select(["o.id", "o.status", "o.stage_entered_at", "s.name as stage"])
    .where("o.contact_id", "=", r.contactId)
    .where("o.organization_id", "=", organizationId)
    .where("o.deleted_at", "is", null);
  const opp = r.opportunityId
    ? await oppQ.where("o.id", "=", r.opportunityId).executeTakeFirst()
    : await (r.scopeUserId ? oppQ.where("o.assigned_user_id", "=", r.scopeUserId) : oppQ).where("o.status", "=", "open").orderBy("o.created_at", "desc").executeTakeFirst();

  const [visitReq, upcoming, lastVisit, signalFacts, profiles, dismissed, activity] = await Promise.all([
    sql<{ at: Date; code: number | null }>`
      select a.occurred_at as at, p.code from activities a left join properties p on p.id = (a.metadata->>'propertyId')::uuid
       where a.entity_type = 'contact' and a.entity_id = ${r.contactId} and a.kind = 'visit_requested'
       order by a.occurred_at desc limit 1`.execute(db),
    db.selectFrom("appointments").select(["starts_at"]).where("contact_id", "=", r.contactId).where("kind", "=", "visit").where("starts_at", ">", now).where("status", "in", ["scheduled", "confirmed", "en_route", "checked_in", "in_progress"]).orderBy("starts_at").executeTakeFirst(),
    sql<{ id: string; at: Date; has_follow_up: boolean }>`
      select a.id, coalesce(a.finished_at, a.ends_at) as at,
        (a.follow_up_task_id is not null or exists (select 1 from tasks t where t.entity_type = 'appointment' and t.entity_id = a.id)) as has_follow_up
        from appointments a where a.contact_id = ${r.contactId} and a.kind = 'visit' and a.status = 'completed'
       order by coalesce(a.finished_at, a.ends_at) desc limit 1`.execute(db),
    loadSignalFacts(db, r.contactId),
    loadEffectiveProfiles(db, organizationId, [r.contactId]),
    sql<{ code: number }>`select p.code from property_matches m join properties p on p.id = m.property_id where m.contact_id = ${r.contactId} and m.status = 'dismissed' and m.dismiss_reason = 'price'`.execute(db),
    sql<{ at: Date | null }>`
      select max(a.occurred_at) as at from activities a
       where (a.entity_type = 'contact' and a.entity_id = ${r.contactId})
          or (a.entity_type = 'lead' and a.entity_id in (select id from leads where contact_id = ${r.contactId}))
          or (a.entity_type = 'opportunity' and a.entity_id in (select id from opportunities where contact_id = ${r.contactId}))`.execute(db),
  ]);

  const eff = profiles.get(r.contactId) ?? {};
  const pending = await db.selectFrom("client_preferences").select("id").where("contact_id", "=", r.contactId).where("status", "=", "suggested").execute();
  const profile = toMatchProfile(eff);

  // Compatibles publicadas en los últimos 14 días (no descartadas).
  let newCompatible: NbaFacts["newCompatible"] = [];
  if (profileIsMatchable(profile)) {
    const recent = await sql<{ id: string }>`
      select p.id from properties p where p.organization_id = ${organizationId} and p.is_published and p.status = 'available' and not p.is_demo
        and p.deleted_at is null and p.published_at > now() - interval '14 days'
        and not exists (select 1 from property_matches m where m.contact_id = ${r.contactId} and m.property_id = p.id and m.status = 'dismissed')
      order by p.published_at desc limit 50`.execute(db);
    if (recent.rows.length) {
      const settings = await matchSettings(db);
      const props = await loadMatchPropertiesByIds(db, organizationId, recent.rows.map((x) => x.id));
      newCompatible = props
        .map((p) => ({ p, s: scoreMatch(profile, p, { tolerancePct: settings.tolerancePct }) }))
        .filter((x) => x.s.eligible && x.s.score >= settings.minScore)
        .sort((a, b) => b.s.score - a.s.score)
        .map((x) => ({ propertyId: x.p.id, code: x.p.code }));
    }
  }

  const lv = lastVisit.rows[0];
  return {
    now,
    lead: lead ? { id: lead.id, status: lead.status, createdAt: lead.created_at, firstResponseAt: lead.first_response_at, propertyCode: lead.code ?? null } : null,
    opportunity: opp ? { id: opp.id, status: opp.status, stageName: opp.stage, stageEnteredAt: opp.stage_entered_at } : null,
    visitRequest: visitReq.rows[0] ? { at: visitReq.rows[0].at, propertyCode: visitReq.rows[0].code } : null,
    upcomingVisit: upcoming ? { at: upcoming.starts_at } : null,
    lastCompletedVisit: lv ? { id: lv.id, at: lv.at, hasFollowUp: lv.has_follow_up } : null,
    signals: computeIntentSignals(signalFacts),
    profile: { budget: eff.budget ? (eff.budget.confirmed ? "confirmed" : "suggested") : "missing", pendingSuggestionIds: pending.map((p) => p.id), matchable: profileIsMatchable(profile) },
    dismissedForPrice: dismissed.rows.map((d) => d.code),
    newCompatible,
    lastActivityAt: activity.rows[0]?.at ?? null,
  };
}

export type NextActionItem = Recommendation & { entityType: NbaEntityType; entityId: string };

async function decisions(db: Executor, contactId: string, now: Date) {
  const rows = await db.selectFrom("sales_recommendations").select(["rule_key", "fingerprint", "status", "snoozed_until", "task_id"]).where("entity_type", "=", "contact").where("entity_id", "=", contactId).execute();
  return (r: Recommendation) => {
    const d = rows.find((x) => x.rule_key === r.ruleKey && x.fingerprint === r.fingerprint);
    if (!d || d.status === "open") return false;
    if (d.status === "snoozed") return Boolean(d.snoozed_until && d.snoozed_until > now);
    return true;
  };
}

export async function getNextActions(db: Executor, actor: Actor, raw: unknown, now = new Date()): Promise<{ items: NextActionItem[]; canAccept: boolean; canDecide: boolean }> {
  const input = nbaEntitySchema.parse(raw);
  const r = await resolveEntity(db, actor, input);
  const scope = can(r.staff, "leads.read_all") ? null : r.staff.userId;
  const facts = await gatherNbaFacts(db, r.staff.organizationId, { contactId: r.contactId, leadId: r.leadId, opportunityId: r.opportunityId, scopeUserId: scope }, now);
  const decided = await decisions(db, r.contactId, now);
  const items = recommendNextActions(facts, 5)
    .filter((x) => !decided(x))
    .slice(0, 3)
    .map((x) => ({ ...x, entityType: input.entityType, entityId: input.entityId }));
  return { items, canAccept: can(r.staff, "tasks.manage"), canDecide: can(r.staff, "contacts.update") || can(r.staff, "leads.update") };
}

async function findCurrent(db: Executor, actor: Actor, input: z.infer<typeof nbaDecisionSchema>, now: Date) {
  const r = await resolveEntity(db, actor, input);
  const scope = can(r.staff, "leads.read_all") ? null : r.staff.userId;
  const facts = await gatherNbaFacts(db, r.staff.organizationId, { contactId: r.contactId, leadId: r.leadId, opportunityId: r.opportunityId, scopeUserId: scope }, now);
  const rec = recommendNextActions(facts, 10).find((x) => x.ruleKey === input.ruleKey && x.fingerprint === input.fingerprint) ?? null;
  return { r, rec };
}

async function upsertDecision(
  db: Executor,
  staff: StaffActor,
  contactId: string,
  rec: Recommendation,
  d: { status: "accepted" | "dismissed" | "snoozed"; taskId?: string | null; snoozedUntil?: Date | null; note?: string | null },
): Promise<string> {
  const now = new Date();
  const row = await sql<{ id: string }>`
    insert into sales_recommendations(organization_id, contact_id, entity_type, entity_id, rule_key, fingerprint, priority, title, reason, evidence,
      status, snoozed_until, dismiss_note, task_id, decided_by, decided_at)
    values (${staff.organizationId}, ${contactId}, 'contact', ${contactId}, ${rec.ruleKey}, ${rec.fingerprint}, ${rec.priority}, ${rec.title},
      ${rec.reason.slice(0, 500)}, ${JSON.stringify(rec.evidence.slice(0, 10))}::jsonb, ${d.status}, ${d.snoozedUntil ?? null}, ${d.note ?? null},
      ${d.taskId ?? null}, ${staff.userId}, ${now})
    on conflict (entity_type, entity_id, rule_key, fingerprint) do update set status = excluded.status, snoozed_until = excluded.snoozed_until,
      dismiss_note = excluded.dismiss_note, task_id = coalesce(excluded.task_id, sales_recommendations.task_id),
      decided_by = excluded.decided_by, decided_at = excluded.decided_at
    returning id`.execute(db);
  return row.rows[0]!.id;
}

/** Aceptar: crea la tarea real (servicio de tareas, idempotente por recomendación) y registra la decisión. */
export async function acceptRecommendation(db: Database, actor: Actor, raw: unknown, now = new Date()): Promise<{ taskId: string; replayed: boolean }> {
  const input = nbaDecisionSchema.parse(raw);
  requirePermission(actor, "tasks.manage");
  const { r, rec } = await findCurrent(db, actor, input, now);
  const existing = await db.selectFrom("sales_recommendations").select(["task_id", "status"]).where("entity_type", "=", "contact").where("entity_id", "=", r.contactId).where("rule_key", "=", input.ruleKey).where("fingerprint", "=", input.fingerprint).executeTakeFirst();
  if (existing?.status === "accepted" && existing.task_id) return { taskId: existing.task_id, replayed: true };
  if (!rec) throw conflict("Esta recomendación ya no aplica: la situación del cliente cambió. Actualizá la página.");
  const task = await createTask(db, r.staff, {
    title: rec.task.title,
    description: `Siguiente acción recomendada: ${rec.reason}`,
    kind: rec.task.kind,
    priority: rec.task.priority,
    dueAt: utcToLocalInput(new Date(now.getTime() + rec.task.dueInHours * 3_600_000)),
    entityType: input.entityType,
    entityId: input.entityId,
    idempotencyKey: `nba:${r.contactId}:${input.ruleKey}:${input.fingerprint}`,
  });
  await db.transaction().execute(async (trx) => {
    const id = await upsertDecision(trx, r.staff, r.contactId, rec, { status: "accepted", taskId: task.id });
    await audit(trx, r.staff, { action: "RECOMMENDATION_ACCEPTED", entityType: input.entityType, entityId: input.entityId, after: { rule: rec.ruleKey, taskId: task.id } });
    await emitEvent(trx, r.staff, { type: "recommendation.accepted", aggregateType: "sales_recommendation", aggregateId: id, payload: { rule: rec.ruleKey, contactId: r.contactId, entityType: input.entityType, taskId: task.id }, dedupeKey: `recommendation.accepted:${id}` });
  });
  return { taskId: task.id, replayed: task.replayed };
}

export async function dismissRecommendation(db: Database, actor: Actor, raw: unknown, now = new Date()): Promise<{ changed: boolean }> {
  const input = nbaDismissSchema.parse(raw);
  const { r, rec } = await findCurrent(db, actor, input, now);
  if (!rec) return { changed: false };
  await db.transaction().execute(async (trx) => {
    const id = await upsertDecision(trx, r.staff, r.contactId, rec, { status: "dismissed", note: input.note ?? null });
    await audit(trx, r.staff, { action: "RECOMMENDATION_DISMISSED", entityType: input.entityType, entityId: input.entityId, after: { rule: rec.ruleKey, withNote: Boolean(input.note) } });
    await emitEvent(trx, r.staff, { type: "recommendation.dismissed", aggregateType: "sales_recommendation", aggregateId: id, payload: { rule: rec.ruleKey, contactId: r.contactId, snoozed: false }, dedupeKey: `recommendation.dismissed:${id}:${now.toISOString()}` });
  });
  return { changed: true };
}

export async function snoozeRecommendation(db: Database, actor: Actor, raw: unknown, now = new Date()): Promise<{ until: Date }> {
  const input = nbaSnoozeSchema.parse(raw);
  const { r, rec } = await findCurrent(db, actor, input, now);
  if (!rec) throw conflict("Esta recomendación ya no aplica. Actualizá la página.");
  const until = new Date(now.getTime() + input.days * 86_400_000);
  await db.transaction().execute(async (trx) => {
    const id = await upsertDecision(trx, r.staff, r.contactId, rec, { status: "snoozed", snoozedUntil: until });
    await audit(trx, r.staff, { action: "RECOMMENDATION_SNOOZED", entityType: input.entityType, entityId: input.entityId, after: { rule: rec.ruleKey, until: until.toISOString() } });
    await emitEvent(trx, r.staff, { type: "recommendation.dismissed", aggregateType: "sales_recommendation", aggregateId: id, payload: { rule: rec.ruleKey, contactId: r.contactId, snoozed: true, until: until.toISOString() }, dedupeKey: `recommendation.snoozed:${id}:${now.toISOString()}` });
  });
  return { until };
}

/**
 * Bandeja de leads: la propuesta abierta de mayor prioridad que registró el sistema al calificar cada consulta (sin
 * decisión todavía). Es la foto al llegar el lead; el detalle recalcula con los hechos actuales.
 */
export async function openProposalsForContacts(db: Executor, organizationId: string, contactIds: string[]): Promise<Map<string, { title: string; priority: "high" | "medium" | "low" }>> {
  if (!contactIds.length) return new Map();
  const rows = await db
    .selectFrom("sales_recommendations")
    .select(["contact_id", "title", "priority", "created_at"])
    .where("organization_id", "=", organizationId)
    .where("contact_id", "in", contactIds)
    .where("status", "=", "open")
    .orderBy(sql`case priority when 'high' then 0 when 'medium' then 1 else 2 end`)
    .orderBy("created_at", "desc")
    .execute();
  const out = new Map<string, { title: string; priority: "high" | "medium" | "low" }>();
  for (const r of rows) if (!out.has(r.contact_id)) out.set(r.contact_id, { title: r.title, priority: r.priority as "high" | "medium" | "low" });
  return out;
}

/** Job (lead.created): deja registradas las propuestas del sistema (`open`) y emite recommendation.created. */
export async function proposeRecommendations(db: Database, system: SystemActor, input: { organizationId: string; contactId: string; leadId: string | null }, now = new Date()): Promise<RecommendationRule[]> {
  const facts = await gatherNbaFacts(db, input.organizationId, { contactId: input.contactId, leadId: input.leadId, opportunityId: null, scopeUserId: null }, now);
  const recs = recommendNextActions(facts, 3);
  const created: RecommendationRule[] = [];
  await db.transaction().execute(async (trx) => {
    for (const rec of recs) {
      const row = await sql<{ id: string }>`
        insert into sales_recommendations(organization_id, contact_id, entity_type, entity_id, rule_key, fingerprint, priority, title, reason, evidence, status)
        values (${input.organizationId}, ${input.contactId}, 'contact', ${input.contactId}, ${rec.ruleKey}, ${rec.fingerprint}, ${rec.priority}, ${rec.title},
          ${rec.reason.slice(0, 500)}, ${JSON.stringify(rec.evidence.slice(0, 10))}::jsonb, 'open')
        on conflict (entity_type, entity_id, rule_key, fingerprint) do nothing
        returning id`.execute(trx);
      if (!row.rows[0]) continue;
      created.push(rec.ruleKey);
      await emitEvent(trx, system, { type: "recommendation.created", aggregateType: "sales_recommendation", aggregateId: row.rows[0].id, payload: { rule: rec.ruleKey, priority: rec.priority, contactId: input.contactId, leadId: input.leadId }, dedupeKey: `recommendation.created:${row.rows[0].id}` });
    }
  });
  return created;
}
