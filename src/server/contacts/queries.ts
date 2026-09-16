/** Lecturas de contactos: listado con búsqueda/filtros, ficha, timeline y revisión de duplicados. */
import { z } from "zod";
import { sql, type Executor } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { agendaScope, leadScope, opportunityScope, tryScope } from "../crm/access";
import { contactSearchCondition } from "../crm/lookups";
import { CONTACT_ROLES } from "./crud";

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const contactFiltersSchema = z.object({
  q: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
  role: z.preprocess(emptyToUndef, z.enum(CONTACT_ROLES).optional()),
  tag: z.preprocess(emptyToUndef, z.uuid().optional()),
  assigned: z.preprocess(emptyToUndef, z.union([z.literal("me"), z.literal("none"), z.uuid()]).optional()),
  page: z.preprocess((v) => (v ? Number(v) : 1), z.number().int().min(1).max(10_000)).optional(),
});

export const CONTACTS_PAGE_SIZE = 30;

export async function listContacts(db: Executor, actor: Actor, raw: unknown) {
  requirePermission(actor, "contacts.read");
  const parsed = contactFiltersSchema.safeParse(raw);
  const f = parsed.success ? parsed.data : {};
  let q = db.selectFrom("contacts as c").leftJoin("users as u", "u.id", "c.assigned_user_id").where("c.deleted_at", "is", null).where("c.merged_into_id", "is", null);
  if (f.q && f.q.length >= 2) q = q.where(contactSearchCondition(f.q));
  if (f.role) q = q.where(sql<boolean>`exists (select 1 from contact_roles r where r.contact_id = c.id and r.role = ${f.role})`);
  if (f.tag) q = q.where(sql<boolean>`exists (select 1 from contact_tags t where t.contact_id = c.id and t.tag_id = ${f.tag})`);
  if (f.assigned === "me") q = q.where("c.assigned_user_id", "=", actor.kind === "staff" ? actor.userId : null);
  else if (f.assigned === "none") q = q.where("c.assigned_user_id", "is", null);
  else if (f.assigned) q = q.where("c.assigned_user_id", "=", f.assigned);
  const page = f.page ?? 1;
  const [rows, total] = await Promise.all([
    q
      .select([
        "c.id",
        "c.display_name",
        "c.kind",
        "c.updated_at",
        "u.full_name as assigned_name",
        sql<string | null>`(select email from contact_emails e where e.contact_id = c.id order by is_primary desc, created_at limit 1)`.as("email"),
        sql<string | null>`(select coalesce(phone_e164, phone_raw) from contact_phones p where p.contact_id = c.id order by is_primary desc, created_at limit 1)`.as("phone"),
        sql<string[]>`coalesce((select array_agg(role order by role) from contact_roles r where r.contact_id = c.id), '{}')`.as("roles"),
        sql<string[]>`coalesce((select array_agg(t.name order by t.name) from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id), '{}')`.as("tags"),
      ])
      .orderBy("c.updated_at", "desc")
      .limit(CONTACTS_PAGE_SIZE)
      .offset((page - 1) * CONTACTS_PAGE_SIZE)
      .execute(),
    q.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirst(),
  ]);
  return { rows, total: Number(total?.n ?? 0), page, pageSize: CONTACTS_PAGE_SIZE, filters: f };
}

export async function getContactDetail(db: Executor, actor: Actor, id: string) {
  requirePermission(actor, "contacts.read");
  const c = await db.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
  if (!c) throw notFound("Contacto");
  if (c.merged_into_id) return { mergedInto: c.merged_into_id } as const;
  if (c.deleted_at) throw notFound("Contacto");
  const canPrivate = can(actor, "contacts.read_private");
  const [emails, phones, roles, tags, notes, assigned, openDuplicates, source] = await Promise.all([
    db.selectFrom("contact_emails").select(["id", "email", "label", "is_primary"]).where("contact_id", "=", id).orderBy("is_primary", "desc").orderBy("created_at").execute(),
    db.selectFrom("contact_phones").select(["id", "phone_raw", "phone_e164", "label", "is_whatsapp", "is_primary"]).where("contact_id", "=", id).orderBy("is_primary", "desc").orderBy("created_at").execute(),
    db.selectFrom("contact_roles").select("role").where("contact_id", "=", id).execute(),
    db.selectFrom("contact_tags as ct").innerJoin("tags as t", "t.id", "ct.tag_id").select(["t.id", "t.name"]).where("ct.contact_id", "=", id).orderBy("t.name").execute(),
    db
      .selectFrom("notes as n")
      .leftJoin("users as u", "u.id", "n.author_user_id")
      .select(["n.id", "n.body", "n.created_at", "u.full_name as author_name"])
      .where("n.entity_type", "=", "contact")
      .where("n.entity_id", "=", id)
      .where("n.deleted_at", "is", null)
      .orderBy("n.created_at", "desc")
      .execute(),
    c.assigned_user_id ? db.selectFrom("users").select(["id", "full_name"]).where("id", "=", c.assigned_user_id).executeTakeFirst() : Promise.resolve(undefined),
    db
      .selectFrom("contact_duplicate_candidates")
      .select(["id", "reason"])
      .where("status", "=", "open")
      .where((eb) => eb.or([eb("contact_a", "=", id), eb("contact_b", "=", id)]))
      .execute(),
    db.selectFrom("lead_sources").select("name").where("key", "=", c.source).executeTakeFirst(),
  ]);
  return {
    mergedInto: null,
    contact: {
      id: c.id,
      kind: c.kind,
      firstName: c.first_name,
      lastName: c.last_name,
      companyName: c.company_name,
      displayName: c.display_name,
      source: c.source,
      sourceName: source?.name ?? (c.source === "manual" ? "Carga manual" : c.source),
      assignedUserId: c.assigned_user_id,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      // Dato sensible: solo con contacts.read_private.
      document: canPrivate ? { type: c.document_type, number: c.document_number } : null,
      hasDocument: Boolean(c.document_number),
    },
    canPrivate,
    emails,
    phones,
    roles: roles.map((r) => r.role),
    tags,
    notes,
    assigned,
    openDuplicates,
  };
}

export type TimelineItem = {
  key: string;
  at: Date;
  kind: "activity" | "lead" | "opportunity" | "appointment" | "property";
  title: string;
  detail: string | null;
  href: string | null;
  actor: string | null;
};

/** Timeline del contacto: actividades + leads + oportunidades + citas + propiedades de las que es propietario (según permisos). */
export async function getContactTimeline(db: Executor, actor: Actor, id: string): Promise<TimelineItem[]> {
  requirePermission(actor, "contacts.read");
  const items: TimelineItem[] = [];
  const activities = await db
    .selectFrom("activities as a")
    .leftJoin("users as u", "u.id", "a.actor_user_id")
    .select(["a.id", "a.kind", "a.summary", "a.occurred_at", "u.full_name as actor_name"])
    .where("a.entity_type", "=", "contact")
    .where("a.entity_id", "=", id)
    .orderBy("a.occurred_at", "desc")
    .limit(100)
    .execute();
  for (const a of activities) items.push({ key: `act-${a.id}`, at: a.occurred_at, kind: "activity", title: a.summary, detail: null, href: null, actor: a.actor_name });

  const ls = tryScope(leadScope, actor);
  if (ls) {
    let q = db
      .selectFrom("leads as l")
      .innerJoin("lead_sources as s", "s.key", "l.source_key")
      .select(["l.id", "l.status", "l.created_at", "l.message", "s.name as source_name"])
      .where("l.contact_id", "=", id)
      .where("l.deleted_at", "is", null);
    if (!ls.all) q = q.where("l.assigned_user_id", "=", ls.userId);
    for (const l of await q.orderBy("l.created_at", "desc").limit(50).execute()) {
      items.push({ key: `lead-${l.id}`, at: l.created_at, kind: "lead", title: `Lead · ${l.source_name}`, detail: l.message ? l.message.slice(0, 200) : null, href: `/crm/leads/${l.id}`, actor: null });
    }
  }
  const os = tryScope(opportunityScope, actor);
  if (os) {
    let q = db
      .selectFrom("opportunities as o")
      .innerJoin("pipeline_stages as st", "st.id", "o.stage_id")
      .select(["o.id", "o.title", "o.created_at", "st.name as stage_name"])
      .where("o.contact_id", "=", id)
      .where("o.deleted_at", "is", null);
    if (!os.all) q = q.where("o.assigned_user_id", "=", os.userId);
    for (const o of await q.orderBy("o.created_at", "desc").limit(50).execute()) {
      items.push({ key: `opp-${o.id}`, at: o.created_at, kind: "opportunity", title: `Oportunidad · ${o.title}`, detail: `Etapa: ${o.stage_name}`, href: `/crm/pipeline/${o.id}`, actor: null });
    }
  }
  const as = tryScope(agendaScope, actor);
  if (as) {
    let q = db
      .selectFrom("appointments as a")
      .innerJoin("users as u", "u.id", "a.assigned_user_id")
      .select(["a.id", "a.title", "a.starts_at", "a.status", "a.result", "u.full_name as agent_name"])
      .where("a.contact_id", "=", id);
    if (!as.all) q = q.where((eb) => eb.or([eb("a.assigned_user_id", "=", as.userId!), eb("a.created_by", "=", as.userId!)]));
    for (const a of await q.orderBy("a.starts_at", "desc").limit(50).execute()) {
      items.push({ key: `apt-${a.id}`, at: a.starts_at, kind: "appointment", title: a.title, detail: a.result ?? null, href: `/crm/agenda/${a.id}`, actor: a.agent_name });
    }
  }
  if (can(actor, "properties.read_private")) {
    const owned = await db
      .selectFrom("property_owners as po")
      .innerJoin("properties as p", "p.id", "po.property_id")
      .select(["p.id", "p.code", "p.title", "po.created_at", "po.share_pct"])
      .where("po.contact_id", "=", id)
      .where("p.deleted_at", "is", null)
      .execute();
    for (const p of owned) {
      items.push({ key: `prop-${p.id}`, at: p.created_at, kind: "property", title: `Propietario · Prop. ${p.code} ${p.title}`, detail: p.share_pct ? `Participación ${Number(p.share_pct)}%` : null, href: `/crm/propiedades/${p.id}`, actor: null });
    }
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export async function listDuplicateCandidates(db: Executor, actor: Actor) {
  requirePermission(actor, "contacts.merge");
  return db
    .selectFrom("contact_duplicate_candidates as d")
    .innerJoin("contacts as a", "a.id", "d.contact_a")
    .innerJoin("contacts as b", "b.id", "d.contact_b")
    .select(["d.id", "d.reason", "d.score", "d.created_at", "a.id as a_id", "a.display_name as a_name", "b.id as b_id", "b.display_name as b_name"])
    .where("d.status", "=", "open")
    .where("a.deleted_at", "is", null)
    .where("b.deleted_at", "is", null)
    .orderBy("d.created_at", "desc")
    .limit(200)
    .execute();
}

export async function getDuplicateComparison(db: Executor, actor: Actor, candidateId: string) {
  requirePermission(actor, "contacts.merge");
  const d = await db.selectFrom("contact_duplicate_candidates").selectAll().where("id", "=", candidateId).executeTakeFirst();
  if (!d) throw notFound("Candidato a duplicado");
  const side = async (contactId: string) => {
    const detail = await getContactDetail(db, actor, contactId).catch((e) => {
      if (e instanceof Error && e.name === "AppError") return null;
      throw e;
    });
    if (!detail || detail.mergedInto !== null) return null;
    const counts = await sql<{ leads: number; opportunities: number; appointments: number; owned: number }>`
      select (select count(*)::int from leads where contact_id = ${contactId} and deleted_at is null) as leads,
             (select count(*)::int from opportunities where contact_id = ${contactId} and deleted_at is null) as opportunities,
             (select count(*)::int from appointments where contact_id = ${contactId}) as appointments,
             (select count(*)::int from property_owners where contact_id = ${contactId}) as owned`.execute(db);
    return { ...detail, counts: counts.rows[0]! };
  };
  const [a, b] = await Promise.all([side(d.contact_a), side(d.contact_b)]);
  return { candidate: d, a, b };
}
