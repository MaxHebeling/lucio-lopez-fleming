/** Catálogos y búsquedas livianas para formularios del CRM (selects y buscadores). Solo lectura, con permiso. */
import { sql, type Executor } from "../db";
import { canAny, requirePermission, requireStaff, type Actor } from "../auth/actor";
import { forbidden } from "../errors";
import { normalizePhone, phoneMatchKey } from "../contacts/normalize";

export type UserOption = { id: string; fullName: string };

/** Usuarios del equipo activos (para asignar leads, oportunidades, citas y tareas). */
export async function listStaffUsers(db: Executor, actor: Actor): Promise<UserOption[]> {
  requireStaff(actor);
  const rows = await db
    .selectFrom("users")
    .select(["id", "full_name"])
    .where("kind", "=", "staff")
    .where("is_active", "=", true)
    .where("deleted_at", "is", null)
    .orderBy("full_name")
    .execute();
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
}

export async function listLeadSources(db: Executor, actor: Actor) {
  requireStaff(actor);
  return db.selectFrom("lead_sources").select(["key", "name", "channel", "is_active"]).orderBy("name").execute();
}

export type PipelineWithStages = {
  id: string;
  key: string;
  name: string;
  kind: string;
  stages: Array<{ id: string; key: string; name: string; sortOrder: number; outcome: string }>;
};

export async function listPipelines(db: Executor, actor: Actor): Promise<PipelineWithStages[]> {
  requireStaff(actor);
  const pipelines = await db.selectFrom("pipelines").select(["id", "key", "name", "kind"]).orderBy("created_at").execute();
  const stages = await db
    .selectFrom("pipeline_stages")
    .select(["id", "pipeline_id", "key", "name", "sort_order", "outcome"])
    .where("is_active", "=", true)
    .orderBy("sort_order")
    .execute();
  const order = ["sales", "rentals", "acquisition"];
  return pipelines
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((p) => ({
      ...p,
      stages: stages
        .filter((s) => s.pipeline_id === p.id)
        .map((s) => ({ id: s.id, key: s.key, name: s.name, sortOrder: s.sort_order, outcome: s.outcome })),
    }));
}

export async function listTags(db: Executor, actor: Actor) {
  requirePermission(actor, "contacts.read");
  return db.selectFrom("tags").select(["id", "name"]).orderBy("name").execute();
}

export type PropertyOption = { id: string; code: number; title: string; status: string; address: string | null };

/** Busca propiedades por código o texto (título/dirección). */
export async function searchProperties(db: Executor, actor: Actor, q: string, limit = 10): Promise<PropertyOption[]> {
  requirePermission(actor, "properties.read");
  const term = q.trim().slice(0, 100);
  let query = db
    .selectFrom("properties")
    .select(["id", "code", "title", "status", "address_street", "address_number"])
    .where("deleted_at", "is", null)
    .where("is_demo", "=", false) // la demo no se vincula a leads, oportunidades, agenda ni contratos
    .where("status", "<>", "archived");
  if (/^\d{1,9}$/.test(term)) {
    query = query.where("code", "=", Number(term));
  } else if (term.length >= 2) {
    const like = `%${term.toLowerCase()}%`;
    query = query.where(sql<boolean>`f_unaccent(lower(title || ' ' || coalesce(address_street, ''))) like f_unaccent(${like})`);
  } else {
    query = query.orderBy("updated_at", "desc");
  }
  const rows = await query.orderBy("code", "desc").limit(limit).execute();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    status: r.status,
    address: [r.address_street, r.address_number].filter(Boolean).join(" ") || null,
  }));
}

export type ContactOption = { id: string; displayName: string; email: string | null; phone: string | null };

/** Busca contactos por nombre, email o teléfono normalizado. */
export async function searchContacts(db: Executor, actor: Actor, q: string, limit = 10): Promise<ContactOption[]> {
  if (!canAny(actor, ["contacts.read"])) throw forbidden();
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  const rows = await contactSearchQuery(db, term).limit(limit).execute();
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, phone: r.phone }));
}

/** Condición de búsqueda de contactos reutilizable (listado y buscador). */
export function contactSearchCondition(term: string) {
  const like = `%${term.toLowerCase()}%`;
  const digits = term.replace(/\D/g, "");
  const phone = normalizePhone(term, { defaultAreaCode: "387" });
  const conds = [
    sql<boolean>`f_unaccent(lower(c.display_name)) like f_unaccent(${like})`,
    sql<boolean>`exists (select 1 from contact_emails ce where ce.contact_id = c.id and ce.email_normalized like ${like})`,
  ];
  if (digits.length >= 6) {
    conds.push(
      sql<boolean>`exists (select 1 from contact_phones cp where cp.contact_id = c.id and (
        regexp_replace(coalesce(cp.phone_e164, cp.phone_raw), '\\D', '', 'g') like ${`%${digits}%`}
        ${phone ? sql`or right(cp.phone_e164, 10) = ${phoneMatchKey(phone.e164)}` : sql``}))`,
    );
  }
  return sql<boolean>`(${sql.join(conds, sql` or `)})`;
}

function contactSearchQuery(db: Executor, term: string) {
  return db
    .selectFrom("contacts as c")
    .select([
      "c.id",
      "c.display_name",
      sql<string | null>`(select email from contact_emails e where e.contact_id = c.id order by is_primary desc, created_at limit 1)`.as("email"),
      sql<string | null>`(select coalesce(phone_e164, phone_raw) from contact_phones p where p.contact_id = c.id order by is_primary desc, created_at limit 1)`.as("phone"),
    ])
    .where("c.deleted_at", "is", null)
    .where("c.merged_into_id", "is", null)
    .where(contactSearchCondition(term))
    .orderBy("c.display_name");
}
