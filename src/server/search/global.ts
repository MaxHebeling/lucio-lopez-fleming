/** Búsqueda global del header: propiedades (código/título/dirección) y contactos (nombre/email/teléfono) según permisos. */
import { sql, type Database } from "../db";
import { can, requireStaff, type Actor } from "../auth/actor";
import { likePattern } from "../pagination";

export type GlobalSearchResult = {
  query: string;
  properties: Array<{ id: string; code: number; title: string; status: string; is_published: boolean; address_street: string | null }> | null;
  contacts: Array<{ id: string; display_name: string; kind: string; email: string | null }> | null;
};

export async function globalSearch(db: Database, actor: Actor, raw: string, limit = 10): Promise<GlobalSearchResult> {
  requireStaff(actor);
  const query = String(raw ?? "").trim().slice(0, 120);
  const canProps = can(actor, "properties.read");
  const canContacts = can(actor, "contacts.read");
  if (query.length < 2 && !/^\d+$/.test(query)) {
    return { query, properties: canProps ? [] : null, contacts: canContacts ? [] : null };
  }
  const pattern = likePattern(query.toLowerCase());
  const code = query.replace(/^#/, "");
  const digits = query.replace(/\D/g, "");

  const properties = canProps
    ? db
        .selectFrom("properties as p")
        .select(["p.id", "p.code", "p.title", "p.status", "p.is_published", "p.address_street"])
        .where("p.deleted_at", "is", null)
        .where((eb) =>
          eb.or([
            ...(/^\d{1,9}$/.test(code) ? [eb("p.code", "=", Number(code))] : []),
            eb(sql`f_unaccent(lower(p.title || ' ' || coalesce(p.address_street, '') || ' ' || coalesce(p.description, '')))`, "like", sql`f_unaccent(${pattern})`),
          ]),
        )
        .orderBy(sql`case when p.code::text = ${code} then 0 else 1 end`)
        .orderBy("p.updated_at", "desc")
        .limit(limit)
        .execute()
    : Promise.resolve(null);

  const contacts = canContacts
    ? db
        .selectFrom("contacts as c")
        .select(["c.id", "c.display_name", "c.kind", sql<string | null>`(select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1)`.as("email")])
        .where("c.deleted_at", "is", null)
        .where("c.merged_into_id", "is", null)
        .where((eb) =>
          eb.or([
            eb(sql`f_unaccent(lower(c.display_name))`, "like", sql`f_unaccent(${pattern})`),
            eb.exists(eb.selectFrom("contact_emails as ce").select("ce.id").whereRef("ce.contact_id", "=", "c.id").where("ce.email_normalized", "like", pattern)),
            ...(digits.length >= 6
              ? [eb.exists(eb.selectFrom("contact_phones as cp").select("cp.id").whereRef("cp.contact_id", "=", "c.id").where(sql`regexp_replace(coalesce(cp.phone_e164, cp.phone_raw), '\\D', '', 'g')`, "like", `%${digits.slice(-10)}%`))]
              : []),
          ]),
        )
        .orderBy(sql`f_unaccent(lower(c.display_name))`)
        .limit(limit)
        .execute()
    : Promise.resolve(null);

  const [p, c] = await Promise.all([properties, contacts]);
  return { query, properties: p, contacts: c };
}
