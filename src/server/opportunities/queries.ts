/** Lecturas del pipeline con alcance propio/todos aplicado en la consulta. */
import { sql, type Executor } from "../db";
import { can, type Actor } from "../auth/actor";
import { opportunityScope, tryScope, agendaScope } from "../crm/access";
import { loadOpportunity } from "../crm/entities";
import { listPipelines } from "../crm/lookups";

export type BoardCard = {
  id: string;
  title: string;
  status: string;
  stageId: string;
  contactId: string;
  contactName: string;
  propertyCode: number | null;
  budgetMin: string | null;
  budgetMax: string | null;
  budgetCurrency: string | null;
  assignedName: string | null;
  stageEnteredAt: Date;
};

/** Días que las cerradas (ganadas/perdidas) siguen visibles en el tablero. */
export const CLOSED_VISIBLE_DAYS = 30;

export async function getBoard(db: Executor, actor: Actor, opts: { pipelineKey?: string; agent?: string }) {
  const scope = opportunityScope(actor);
  const pipelines = await listPipelines(db, actor);
  const pipeline = pipelines.find((p) => p.key === opts.pipelineKey) ?? pipelines[0];
  if (!pipeline) return { pipelines, pipeline: null, cards: [] as BoardCard[], scopeAll: scope.all };
  let q = db
    .selectFrom("opportunities as o")
    .innerJoin("contacts as c", "c.id", "o.contact_id")
    .leftJoin("properties as p", "p.id", "o.property_id")
    .leftJoin("users as u", "u.id", "o.assigned_user_id")
    .select([
      "o.id",
      "o.title",
      "o.status",
      "o.stage_id as stageId",
      "c.id as contactId",
      "c.display_name as contactName",
      "p.code as propertyCode",
      "o.budget_min as budgetMin",
      "o.budget_max as budgetMax",
      "o.budget_currency as budgetCurrency",
      "u.full_name as assignedName",
      "o.stage_entered_at as stageEnteredAt",
    ])
    .where("o.pipeline_id", "=", pipeline.id)
    .where("o.deleted_at", "is", null)
    .where((eb) => eb.or([eb("o.status", "in", ["open", "paused"]), eb("o.closed_at", ">", sql<Date>`now() - make_interval(days => ${CLOSED_VISIBLE_DAYS})`)]));
  if (!scope.all) q = q.where("o.assigned_user_id", "=", scope.userId);
  else if (opts.agent === "none") q = q.where("o.assigned_user_id", "is", null);
  else if (opts.agent && /^[0-9a-f-]{36}$/i.test(opts.agent)) q = q.where("o.assigned_user_id", "=", opts.agent);
  const cards = (await q.orderBy("o.stage_entered_at", "desc").limit(500).execute()) as BoardCard[];
  return { pipelines, pipeline, cards, scopeAll: scope.all };
}

export async function getOpportunityDetail(db: Executor, actor: Actor, id: string) {
  const opp = await loadOpportunity(db, actor, id);
  const agenda = tryScope(agendaScope, actor);
  const [pipeline, contact, phones, property, assigned, lead, history, notes, appointments] = await Promise.all([
    listPipelines(db, actor).then((ps) => ps.find((p) => p.id === opp.pipeline_id)!),
    db.selectFrom("contacts").select(["id", "display_name"]).where("id", "=", opp.contact_id).executeTakeFirstOrThrow(),
    db.selectFrom("contact_phones").select(["id", "phone_raw", "phone_e164", "is_whatsapp", "is_primary"]).where("contact_id", "=", opp.contact_id).orderBy("is_primary", "desc").execute(),
    opp.property_id && can(actor, "properties.read")
      ? db.selectFrom("properties").select(["id", "code", "title", "status"]).where("id", "=", opp.property_id).executeTakeFirst()
      : Promise.resolve(undefined),
    opp.assigned_user_id ? db.selectFrom("users").select(["id", "full_name"]).where("id", "=", opp.assigned_user_id).executeTakeFirst() : Promise.resolve(undefined),
    opp.lead_id ? db.selectFrom("leads").select(["id", "source_key", "created_at"]).where("id", "=", opp.lead_id).executeTakeFirst() : Promise.resolve(undefined),
    db
      .selectFrom("opportunity_stage_history as h")
      .leftJoin("pipeline_stages as f", "f.id", "h.from_stage_id")
      .innerJoin("pipeline_stages as t", "t.id", "h.to_stage_id")
      .leftJoin("users as u", "u.id", "h.changed_by")
      .select(["h.id", "f.name as from_name", "t.name as to_name", "h.note", "h.changed_at", "u.full_name as actor_name"])
      .where("h.opportunity_id", "=", opp.id)
      .orderBy("h.changed_at", "desc")
      .orderBy("h.id", "desc")
      .execute(),
    db
      .selectFrom("notes as n")
      .leftJoin("users as u", "u.id", "n.author_user_id")
      .select(["n.id", "n.body", "n.created_at", "u.full_name as author_name"])
      .where("n.entity_type", "=", "opportunity")
      .where("n.entity_id", "=", opp.id)
      .where("n.deleted_at", "is", null)
      .orderBy("n.created_at", "desc")
      .execute(),
    agenda
      ? (() => {
          let q = db
            .selectFrom("appointments as a")
            .leftJoin("users as u", "u.id", "a.assigned_user_id")
            .select(["a.id", "a.kind", "a.title", "a.starts_at", "a.status", "u.full_name as agent_name"])
            .where("a.opportunity_id", "=", opp.id);
          if (!agenda.all) q = q.where((eb) => eb.or([eb("a.assigned_user_id", "=", agenda.userId!), eb("a.created_by", "=", agenda.userId!)]));
          return q.orderBy("a.starts_at", "desc").execute();
        })()
      : Promise.resolve([]),
  ]);
  return { opp, pipeline, contact, phones, property, assigned, lead, history, notes, appointments };
}
