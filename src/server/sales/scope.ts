/**
 * Alcance comercial de un contacto (perfil, coincidencias, señales, siguiente acción).
 * - `leads.read_all`: todos los contactos de SU organización.
 * - `leads.read_own`: los contactos que tiene asignados, o con un lead u oportunidad asignados a él.
 * Además hace falta `contacts.read`. Fuera de alcance = 404 (no se revela existencia).
 */
import "server-only";
import { sql, type Executor } from "../db";
import { requirePermission, requireStaff, type Actor, type StaffActor } from "../auth/actor";
import { leadScope, type Scope } from "../crm/access";
import { notFound } from "../errors";

export type SalesContact = { id: string; organization_id: string; display_name: string; assigned_user_id: string | null };

export function salesScope(actor: Actor): { actor: StaffActor; scope: Scope } {
  requireStaff(actor);
  requirePermission(actor, "contacts.read");
  return { actor, scope: leadScope(actor) };
}

/** Condición SQL (alias de contacto `c`) para limitar listas al alcance del actor. */
export function contactInScopeSql(scope: Scope, alias = "c") {
  if (scope.all) return sql<boolean>`true`;
  const me = scope.userId;
  const c = sql.ref(alias);
  return sql<boolean>`(${sql.ref(`${alias}.assigned_user_id`)} = ${me}
    or exists (select 1 from leads l where l.contact_id = ${c}.id and l.assigned_user_id = ${me} and l.deleted_at is null)
    or exists (select 1 from opportunities o where o.contact_id = ${c}.id and o.assigned_user_id = ${me} and o.deleted_at is null))`;
}

export async function loadSalesContact(db: Executor, actor: Actor, contactId: string): Promise<{ actor: StaffActor; scope: Scope; contact: SalesContact }> {
  const s = salesScope(actor);
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) throw notFound("Contacto");
  const row = await db
    .selectFrom("contacts as c")
    .select(["c.id", "c.organization_id", "c.display_name", "c.assigned_user_id"])
    .where("c.id", "=", contactId)
    .where("c.organization_id", "=", s.actor.organizationId)
    .where("c.deleted_at", "is", null)
    .where("c.merged_into_id", "is", null)
    .where(contactInScopeSql(s.scope))
    .executeTakeFirst();
  if (!row) throw notFound("Contacto");
  return { ...s, contact: row };
}
