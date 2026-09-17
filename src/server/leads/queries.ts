/** Lecturas de leads con alcance aplicado en la consulta (nunca filtrado en la UI). */
import { z } from "zod";
import { sql, type Executor } from "../db";
import { leadScope } from "../crm/access";
import { loadLead } from "../crm/entities";
import { isLocalDate, localDayRange } from "../crm/time";
import { can, type Actor } from "../auth/actor";
import { LEAD_PRIORITIES, LEAD_STATUSES } from "./service";

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const leadFiltersSchema = z.object({
  status: z.preprocess(emptyToUndef, z.enum([...LEAD_STATUSES, "open"]).optional()),
  source: z.preprocess(emptyToUndef, z.string().regex(/^[a-z0-9_]{2,40}$/).optional()),
  assigned: z.preprocess(emptyToUndef, z.union([z.literal("me"), z.literal("none"), z.uuid()]).optional()),
  priority: z.preprocess(emptyToUndef, z.enum(LEAD_PRIORITIES).optional()),
  unanswered: z.preprocess((v) => v === "1" || v === true, z.boolean()).optional(),
  property: z.preprocess(emptyToUndef, z.string().regex(/^\d{1,9}$/).optional()),
  from: z.preprocess(emptyToUndef, z.string().refine(isLocalDate).optional()),
  to: z.preprocess(emptyToUndef, z.string().refine(isLocalDate).optional()),
  q: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
  page: z.preprocess((v) => (v ? Number(v) : 1), z.number().int().min(1).max(10_000)).optional(),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

export const LEADS_PAGE_SIZE = 30;

export async function listLeads(db: Executor, actor: Actor, raw: unknown) {
  const scope = leadScope(actor);
  const parsed = leadFiltersSchema.safeParse(raw);
  const f: LeadFilters = parsed.success ? parsed.data : {};
  let q = db
    .selectFrom("leads as l")
    .innerJoin("contacts as c", "c.id", "l.contact_id")
    .innerJoin("lead_sources as s", "s.key", "l.source_key")
    .leftJoin("properties as p", "p.id", "l.property_id")
    .leftJoin("users as u", "u.id", "l.assigned_user_id")
    .where("l.deleted_at", "is", null);
  if (!scope.all) q = q.where("l.assigned_user_id", "=", scope.userId);
  if (f.status === "open") q = q.where("l.status", "in", ["new", "contacted", "qualified"]);
  else if (f.status) q = q.where("l.status", "=", f.status);
  if (f.source) q = q.where("l.source_key", "=", f.source);
  if (f.assigned === "me") q = q.where("l.assigned_user_id", "=", scope.userId);
  else if (f.assigned === "none") q = q.where("l.assigned_user_id", "is", null);
  else if (f.assigned) q = q.where("l.assigned_user_id", "=", f.assigned);
  if (f.priority) q = q.where("l.priority", "=", f.priority);
  if (f.unanswered) q = q.where("l.first_response_at", "is", null).where("l.status", "not in", ["converted", "discarded", "unqualified"]);
  if (f.property) q = q.where("p.code", "=", Number(f.property));
  if (f.from) q = q.where("l.created_at", ">=", localDayRange(f.from).from);
  if (f.to) q = q.where("l.created_at", "<", localDayRange(f.to).to);
  if (f.q) {
    const like = `%${f.q.toLowerCase()}%`;
    q = q.where(sql<boolean>`f_unaccent(lower(c.display_name)) like f_unaccent(${like})`);
  }
  const page = f.page ?? 1;
  const [rows, total] = await Promise.all([
    q
      .select([
        "l.id",
        "l.status",
        "l.priority",
        "l.created_at",
        "l.first_response_at",
        "l.operation_interest",
        "l.message",
        "c.id as contact_id",
        "c.display_name as contact_name",
        "s.name as source_name",
        "p.code as property_code",
        "p.title as property_title",
        "u.full_name as assigned_name",
      ])
      .orderBy(sql`case when l.status = 'new' then 0 else 1 end`)
      .orderBy("l.created_at", "desc")
      .limit(LEADS_PAGE_SIZE)
      .offset((page - 1) * LEADS_PAGE_SIZE)
      .execute(),
    q.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirst(),
  ]);
  return { rows, total: Number(total?.n ?? 0), page, pageSize: LEADS_PAGE_SIZE, filters: f, scopeAll: scope.all };
}

export async function getLeadDetail(db: Executor, actor: Actor, id: string) {
  const lead = await loadLead(db, actor, id);
  const [contact, emails, phones, source, property, assigned, conversation, opportunity, activities, notes] = await Promise.all([
    db.selectFrom("contacts").select(["id", "display_name", "kind"]).where("id", "=", lead.contact_id).executeTakeFirstOrThrow(),
    db.selectFrom("contact_emails").select(["id", "email", "is_primary"]).where("contact_id", "=", lead.contact_id).orderBy("is_primary", "desc").execute(),
    db.selectFrom("contact_phones").select(["id", "phone_raw", "phone_e164", "is_whatsapp", "is_primary"]).where("contact_id", "=", lead.contact_id).orderBy("is_primary", "desc").execute(),
    db.selectFrom("lead_sources").select(["key", "name", "channel"]).where("key", "=", lead.source_key).executeTakeFirst(),
    lead.property_id && can(actor, "properties.read")
      ? db.selectFrom("properties").select(["id", "code", "title", "status"]).where("id", "=", lead.property_id).executeTakeFirst()
      : Promise.resolve(undefined),
    lead.assigned_user_id ? db.selectFrom("users").select(["id", "full_name"]).where("id", "=", lead.assigned_user_id).executeTakeFirst() : Promise.resolve(undefined),
    lead.conversation_id ? db.selectFrom("conversations").select(["id", "channel", "mode"]).where("id", "=", lead.conversation_id).executeTakeFirst() : Promise.resolve(undefined),
    db.selectFrom("opportunities").select(["id", "title", "status"]).where("lead_id", "=", lead.id).where("deleted_at", "is", null).executeTakeFirst(),
    db
      .selectFrom("activities as a")
      .leftJoin("users as u", "u.id", "a.actor_user_id")
      .select(["a.id", "a.kind", "a.summary", "a.occurred_at", "u.full_name as actor_name"])
      .where("a.entity_type", "=", "lead")
      .where("a.entity_id", "=", lead.id)
      .orderBy("a.occurred_at", "desc")
      .limit(50)
      .execute(),
    db
      .selectFrom("notes as n")
      .leftJoin("users as u", "u.id", "n.author_user_id")
      .select(["n.id", "n.body", "n.created_at", "u.full_name as author_name"])
      .where("n.entity_type", "=", "lead")
      .where("n.entity_id", "=", lead.id)
      .where("n.deleted_at", "is", null)
      .orderBy("n.created_at", "desc")
      .execute(),
  ]);
  return { lead, contact, emails, phones, source, property, assigned, conversation, opportunity, activities, notes };
}
