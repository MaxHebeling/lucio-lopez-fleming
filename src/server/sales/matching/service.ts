/**
 * Coincidencias cliente ↔ propiedad sobre datos reales.
 * - En el contacto: propiedades compatibles (cálculo al leer, con el alcance del agente).
 * - En la propiedad del CRM: clientes compatibles (solo los contactos que el usuario puede ver).
 * - Match inverso (job): al publicarse o cambiar el precio de una propiedad se guardan candidatos en `property_matches`
 *   (puntaje, razones y versión del algoritmo) y se avisa, deduplicado, al agente responsable. NUNCA se contacta al
 *   cliente: no se crean mensajes, conversaciones ni envíos.
 */
import "server-only";
import { z } from "zod";
import { sql, type Database, type Executor } from "../../db";
import { audit } from "../../audit";
import { can, requirePermission, type Actor, type SystemActor } from "../../auth/actor";
import { forbidden, notFound } from "../../errors";
import { emitEvent } from "../../events";
import { notifyUser } from "../../notifications";
import { formatPrice, OPERATION_NOUN } from "../../properties/public-helpers";
import { localDate } from "../../crm/time";
import { parseFieldValue, FIELD_LABEL, type ProfileField } from "../profile/fields";
import { loadEffectiveProfiles, type EffectiveProfile } from "../profile/service";
import { contactInScopeSql, loadSalesContact, salesScope } from "../scope";
import { featureNames, loadMatchProperties } from "./properties";
import {
  DEFAULT_BUDGET_TOLERANCE_PCT,
  DEFAULT_MIN_SCORE,
  MATCH_ALGORITHM_VERSION,
  profileIsMatchable,
  scoreMatch,
  type MatchProfile,
  type MatchProperty,
  type MatchResult,
} from "./score";

export const MATCHING_FLAG = "ai_matching";

// ───────────────────────── Configuración ─────────────────────────

export async function matchSettings(db: Executor): Promise<{ tolerancePct: number; minScore: number; notify: boolean }> {
  const rows = await db.selectFrom("settings").select(["key", "value"]).where("key", "in", ["ai.matching.budget_tolerance_pct", "ai.matching.min_score", "ai.matching.notify_agents"]).execute();
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const tol = Number(get("ai.matching.budget_tolerance_pct"));
  const min = Number(get("ai.matching.min_score"));
  return {
    tolerancePct: Number.isFinite(tol) && tol >= 0 && tol <= 50 ? tol : DEFAULT_BUDGET_TOLERANCE_PCT,
    minScore: Number.isFinite(min) && min >= 0 && min <= 100 ? min : DEFAULT_MIN_SCORE,
    notify: get("ai.matching.notify_agents") !== false,
  };
}

// ───────────────────────── Perfil y propiedades → modelo del algoritmo ─────────────────────────

export function toMatchProfile(eff: EffectiveProfile): MatchProfile {
  const take = <F extends ProfileField, T>(field: F): { value: T; confirmed: boolean } | undefined => {
    const e = eff[field];
    if (!e) return undefined;
    const parsed = parseFieldValue(field, e.value);
    return parsed.ok ? { value: parsed.value as T, confirmed: e.confirmed } : undefined;
  };
  return {
    transactionType: take("transaction_type"),
    propertyTypes: take("property_types"),
    budget: take("budget"),
    locations: take("locations"),
    bedroomsMin: take("bedrooms_min"),
    bathroomsMin: take("bathrooms_min"),
    surface: take("surface"),
    features: take("features"),
  };
}

/** Qué le falta a un perfil para buscar coincidencias (texto para la UI). */
export function missingForMatching(p: MatchProfile): string[] {
  const out: string[] = [];
  if (!p.transactionType && !p.propertyTypes) out.push(`${FIELD_LABEL.transaction_type} o ${FIELD_LABEL.property_types.toLowerCase()}`);
  if (!p.budget && !p.locations) out.push(`${FIELD_LABEL.budget} o ${FIELD_LABEL.locations.toLowerCase()}`);
  return out;
}

function priceLabel(p: MatchProperty, op?: string): string {
  const o = (op ? p.operations.find((x) => x.operation === op) : null) ?? p.operations[0];
  if (!o) return "Sin precio";
  return `${formatPrice(o.amount, o.currency, o.priceHidden)} · ${OPERATION_NOUN[o.operation as keyof typeof OPERATION_NOUN] ?? o.operation}`;
}

/** Propiedades vistas en el sitio por un contacto (solo sesiones vinculadas al enviar una consulta). */
async function viewedByContact(db: Executor, contactIds: string[], propertyId?: string): Promise<Map<string, Set<string>>> {
  if (!contactIds.length) return new Map();
  const r = await sql<{ contact_id: string; property_id: string }>`
    select distinct s.contact_id, e.property_id from site_session_links s
      join site_events e on e.session_key = s.session_key
     where s.contact_id = any(${contactIds}::uuid[]) and e.property_id is not null
       and e.name in ('property_viewed', 'virtual_tour_opened', 'property_gallery_opened')
       ${propertyId ? sql`and e.property_id = ${propertyId}` : sql``}`.execute(db);
  const out = new Map<string, Set<string>>();
  for (const row of r.rows) out.set(row.contact_id, (out.get(row.contact_id) ?? new Set()).add(row.property_id));
  return out;
}

// ───────────────────────── En la ficha del contacto ─────────────────────────

export type CompatibleProperty = {
  propertyId: string;
  code: number;
  title: string;
  typeName: string;
  zoneLabel: string | null;
  price: string;
  score: number;
  matched: string[];
  consider: string[];
  unconfirmed: boolean;
  crmHref: string;
  publicHref: string;
};

export type CompatiblePropertiesResult = {
  matchable: boolean;
  missing: string[];
  items: CompatibleProperty[];
  total: number;
  dismissed: number;
  minScore: number;
  algorithmVersion: string;
};

export async function listCompatibleProperties(db: Executor, actor: Actor, contactId: string, opts: { limit?: number } = {}): Promise<CompatiblePropertiesResult> {
  const { actor: staff } = await loadSalesContact(db, actor, contactId);
  requirePermission(staff, "properties.read");
  const settings = await matchSettings(db);
  const profile = toMatchProfile((await loadEffectiveProfiles(db, staff.organizationId, [contactId])).get(contactId) ?? {});
  const base = { minScore: settings.minScore, algorithmVersion: MATCH_ALGORITHM_VERSION };
  if (!profileIsMatchable(profile)) return { ...base, matchable: false, missing: missingForMatching(profile), items: [], total: 0, dismissed: 0 };
  const [props, names, viewed, dismissedRows, inquired] = await Promise.all([
    loadMatchProperties(db, staff.organizationId, { availableOnly: true }),
    featureNames(db),
    viewedByContact(db, [contactId]),
    db.selectFrom("property_matches").select("property_id").where("contact_id", "=", contactId).where("status", "=", "dismissed").execute(),
    db.selectFrom("leads").select("property_id").where("contact_id", "=", contactId).where("property_id", "is not", null).where("deleted_at", "is", null).execute(),
  ]);
  const dismissed = new Set(dismissedRows.map((d) => d.property_id));
  const asked = new Set(inquired.map((l) => l.property_id));
  const scored = props
    .filter((p) => !dismissed.has(p.id))
    .map((p) => ({ p, r: scoreMatch(profile, p, { tolerancePct: settings.tolerancePct, featureNames: names, signals: { viewedOnSite: viewed.get(contactId)?.has(p.id), inquired: asked.has(p.id) } }) }))
    .filter((x) => x.r.eligible && x.r.score >= settings.minScore)
    .sort((a, b) => b.r.score - a.r.score || b.p.code - a.p.code);
  const limit = opts.limit ?? 12;
  return {
    ...base,
    matchable: true,
    missing: [],
    total: scored.length,
    dismissed: dismissed.size,
    items: scored.slice(0, limit).map(({ p, r }) => ({
      propertyId: p.id,
      code: p.code,
      title: p.title,
      typeName: p.typeName,
      zoneLabel: p.zoneLabel,
      price: priceLabel(p, profile.transactionType?.value),
      score: r.score,
      matched: r.matched,
      consider: r.consider,
      unconfirmed: r.unconfirmed,
      crmHref: `/crm/propiedades/${p.id}`,
      publicHref: `/propiedades/${p.slug}`,
    })),
  };
}

// ───────────────────────── En la propiedad del CRM ─────────────────────────

export type CompatibleClient = {
  contactId: string;
  name: string;
  score: number;
  matched: string[];
  consider: string[];
  unconfirmed: boolean;
  status: "candidate" | "dismissed" | null;
  notifiedAt: Date | null;
  href: string;
};

async function contactsWithPreferences(db: Executor, organizationId: string, scopeCond: ReturnType<typeof contactInScopeSql> | null) {
  let q = db
    .selectFrom("contacts as c")
    .select(["c.id", "c.display_name"])
    .where("c.organization_id", "=", organizationId)
    .where("c.deleted_at", "is", null)
    .where("c.merged_into_id", "is", null)
    .where((eb) => eb.exists(eb.selectFrom("client_preferences as cp").select("cp.id").whereRef("cp.contact_id", "=", "c.id").where("cp.status", "in", ["confirmed", "suggested"])));
  if (scopeCond) q = q.where(scopeCond);
  return q.execute();
}

export async function listCompatibleClients(db: Executor, actor: Actor, propertyId: string, opts: { limit?: number } = {}): Promise<{ items: CompatibleClient[]; total: number; scope: "own" | "all"; available: boolean; minScore: number; algorithmVersion: string }> {
  const { actor: staff, scope } = salesScope(actor);
  requirePermission(staff, "properties.read");
  const [prop] = await loadMatchProperties(db, staff.organizationId, { ids: [propertyId] });
  if (!prop) throw notFound("Propiedad");
  const settings = await matchSettings(db);
  const base = { scope: scope.all ? ("all" as const) : ("own" as const), minScore: settings.minScore, algorithmVersion: MATCH_ALGORITHM_VERSION };
  const available = prop.published && prop.status === "available";
  if (!available) return { ...base, items: [], total: 0, available };
  const contacts = await contactsWithPreferences(db, staff.organizationId, contactInScopeSql(scope));
  const ids = contacts.map((c) => c.id);
  const [profiles, names, viewed, stored] = await Promise.all([
    loadEffectiveProfiles(db, staff.organizationId, ids),
    featureNames(db),
    viewedByContact(db, ids, propertyId),
    ids.length ? db.selectFrom("property_matches").select(["contact_id", "status", "notified_at"]).where("property_id", "=", propertyId).where("contact_id", "in", ids).execute() : Promise.resolve([]),
  ]);
  const storedBy = new Map(stored.map((s) => [s.contact_id, s]));
  const items = contacts
    .map((c) => ({ c, r: scoreMatch(toMatchProfile(profiles.get(c.id) ?? {}), prop, { tolerancePct: settings.tolerancePct, featureNames: names, signals: { viewedOnSite: viewed.get(c.id)?.has(propertyId) } }) }))
    .filter((x) => x.r.eligible && x.r.score >= settings.minScore)
    .sort((a, b) => b.r.score - a.r.score || a.c.display_name.localeCompare(b.c.display_name, "es"))
    .map(({ c, r }) => {
      const s = storedBy.get(c.id);
      return { contactId: c.id, name: c.display_name, score: r.score, matched: r.matched, consider: r.consider, unconfirmed: r.unconfirmed, status: (s?.status === "dismissed" ? "dismissed" : s?.status === "candidate" ? "candidate" : null) as CompatibleClient["status"], notifiedAt: s?.notified_at ?? null, href: `/crm/contactos/${c.id}` };
    });
  return { ...base, available, total: items.length, items: items.slice(0, opts.limit ?? 20) };
}

// ───────────────────────── Descartar una coincidencia ─────────────────────────

export const DISMISS_REASONS = ["price", "location", "size", "type", "features", "other"] as const;
export const DISMISS_REASON_LABEL: Record<(typeof DISMISS_REASONS)[number], string> = { price: "Precio / presupuesto", location: "Ubicación", size: "Tamaño", type: "Tipo de propiedad", features: "Características", other: "Otro motivo" };
export const dismissMatchSchema = z.object({ contactId: z.uuid(), propertyId: z.uuid(), reason: z.enum(DISMISS_REASONS) });

export async function dismissMatch(db: Database, actor: Actor, raw: unknown): Promise<{ changed: boolean }> {
  const input = dismissMatchSchema.parse(raw);
  const { actor: staff } = await loadSalesContact(db, actor, input.contactId);
  if (!can(staff, "contacts.update")) throw forbidden();
  const [prop] = await loadMatchProperties(db, staff.organizationId, { ids: [input.propertyId] });
  if (!prop) throw notFound("Propiedad");
  const settings = await matchSettings(db);
  const profile = toMatchProfile((await loadEffectiveProfiles(db, staff.organizationId, [input.contactId])).get(input.contactId) ?? {});
  const r = scoreMatch(profile, prop, { tolerancePct: settings.tolerancePct });
  return db.transaction().execute(async (trx) => {
    const now = new Date();
    const res = await sql<{ id: string }>`
      insert into property_matches(organization_id, contact_id, property_id, score, reasons, algorithm_version, trigger, status, dismiss_reason, dismissed_by, dismissed_at)
      values (${staff.organizationId}, ${input.contactId}, ${input.propertyId}, ${r.score}, ${JSON.stringify({ matched: r.matched, consider: r.consider, unconfirmed: r.unconfirmed })}::jsonb,
        ${MATCH_ALGORITHM_VERSION}, 'manual', 'dismissed', ${input.reason}, ${staff.userId}, ${now})
      on conflict (contact_id, property_id) do update set status = 'dismissed', dismiss_reason = excluded.dismiss_reason,
        dismissed_by = excluded.dismissed_by, dismissed_at = excluded.dismissed_at
        where property_matches.status <> 'dismissed' or property_matches.dismiss_reason <> excluded.dismiss_reason
      returning id`.execute(trx);
    const changed = res.rows.length > 0;
    if (changed) {
      await audit(trx, staff, { action: "PROPERTY_MATCH_DISMISSED", entityType: "contact", entityId: input.contactId, after: { propertyId: input.propertyId, code: prop.code, reason: input.reason } });
      await trx.insertInto("activities").values({ entity_type: "contact", entity_id: input.contactId, kind: "match_dismissed", actor_user_id: staff.userId, summary: `Descartó la propiedad #${prop.code} (${DISMISS_REASON_LABEL[input.reason].toLowerCase()})`, metadata: JSON.stringify({ propertyId: input.propertyId, reason: input.reason }) }).execute();
    }
    return { changed };
  });
}

// ───────────────────────── Match inverso (jobs) ─────────────────────────

export type MatchTrigger = "property_published" | "price_changed" | "preferences_changed" | "manual";

async function responsibleAgents(db: Executor, contactIds: string[]): Promise<Map<string, string>> {
  if (!contactIds.length) return new Map();
  const r = await sql<{ contact_id: string; user_id: string | null }>`
    select c.id as contact_id, coalesce(
      (select u.id from users u where u.id = c.assigned_user_id and u.is_active and u.deleted_at is null and u.kind = 'staff'),
      (select l.assigned_user_id from leads l join users u on u.id = l.assigned_user_id
         where l.contact_id = c.id and l.deleted_at is null and l.status not in ('discarded', 'converted') and u.is_active and u.deleted_at is null
         order by l.created_at desc limit 1),
      (select o.assigned_user_id from opportunities o join users u on u.id = o.assigned_user_id
         where o.contact_id = c.id and o.deleted_at is null and o.status = 'open' and u.is_active and u.deleted_at is null
         order by o.created_at desc limit 1)) as user_id
    from contacts c where c.id = any(${contactIds}::uuid[])`.execute(db);
  const out = new Map<string, string>();
  for (const row of r.rows) if (row.user_id) out.set(row.contact_id, row.user_id);
  return out;
}

function reasonsJson(r: MatchResult): string {
  return JSON.stringify({ matched: r.matched.slice(0, 12), consider: r.consider.slice(0, 12), unconfirmed: r.unconfirmed });
}

/**
 * Candidatos para una propiedad (publicación o cambio de precio). Idempotente: re-ejecutarlo no duplica filas ni avisos
 * (upsert por contacto+propiedad, aviso con dedupe por propiedad+motivo+día y agente). Respeta descartes previos.
 */
export async function computeMatchesForProperty(db: Database, system: SystemActor, propertyId: string, trigger: MatchTrigger, eventId?: string | null): Promise<{ candidates: number; newCandidates: number; notified: number; stale: number }> {
  const prop = await db.selectFrom("properties").select(["id", "organization_id", "code"]).where("id", "=", propertyId).where("deleted_at", "is", null).executeTakeFirst();
  if (!prop) return { candidates: 0, newCandidates: 0, notified: 0, stale: 0 };
  const orgId = prop.organization_id;
  const [full] = await loadMatchProperties(db, orgId, { ids: [propertyId] });
  const settings = await matchSettings(db);
  const contacts = await contactsWithPreferences(db, orgId, null);
  const profiles = await loadEffectiveProfiles(db, orgId, contacts.map((c) => c.id));
  const names = await featureNames(db);
  const eligible = full
    ? contacts
        .map((c) => ({ c, r: scoreMatch(toMatchProfile(profiles.get(c.id) ?? {}), full, { tolerancePct: settings.tolerancePct, featureNames: names }) }))
        .filter((x) => x.r.eligible && x.r.score >= settings.minScore)
    : [];

  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`property_matches:${propertyId}`}))`.execute(trx);
    const before = await trx.selectFrom("property_matches").select(["contact_id", "status"]).where("property_id", "=", propertyId).execute();
    const prevStatus = new Map(before.map((b) => [b.contact_id, b.status]));
    const now = new Date();
    for (const { c, r } of eligible) {
      await sql`
        insert into property_matches(organization_id, contact_id, property_id, score, reasons, algorithm_version, trigger, status, computed_at)
        values (${orgId}, ${c.id}, ${propertyId}, ${r.score}, ${reasonsJson(r)}::jsonb, ${MATCH_ALGORITHM_VERSION}, ${trigger}, 'candidate', ${now})
        on conflict (contact_id, property_id) do update set score = excluded.score, reasons = excluded.reasons,
          algorithm_version = excluded.algorithm_version, trigger = excluded.trigger, computed_at = excluded.computed_at,
          status = case when property_matches.status = 'dismissed' then 'dismissed' else 'candidate' end`.execute(trx);
    }
    const eligibleIds = new Set(eligible.map((e) => e.c.id));
    const staleIds = before.filter((b) => b.status === "candidate" && !eligibleIds.has(b.contact_id)).map((b) => b.contact_id);
    if (staleIds.length) await trx.updateTable("property_matches").set({ status: "stale", computed_at: now }).where("property_id", "=", propertyId).where("contact_id", "in", staleIds).execute();

    const fresh = eligible.filter((e) => prevStatus.get(e.c.id) !== "candidate" && prevStatus.get(e.c.id) !== "dismissed");
    let notified = 0;
    if (settings.notify && fresh.length) {
      const agents = await responsibleAgents(trx, fresh.map((f) => f.c.id));
      const byAgent = new Map<string, string[]>();
      for (const f of fresh) {
        const u = agents.get(f.c.id);
        if (u) byAgent.set(u, [...(byAgent.get(u) ?? []), f.c.id]);
      }
      const day = localDate(now);
      for (const [userId, ids] of byAgent) {
        const n = ids.length;
        await notifyUser(trx, userId, {
          kind: "sales.match",
          title: `${n} ${n === 1 ? "cliente compatible" : "clientes compatibles"} con la propiedad #${prop.code}`,
          body: trigger === "price_changed" ? "Cambió el precio: revisá la coincidencia estimada antes de contactar." : "Se publicó: revisá la coincidencia estimada antes de contactar.",
          link: `/crm/propiedades/${propertyId}#clientes-compatibles`,
          entityType: "property",
          entityId: propertyId,
          dedupeKey: `sales.match:${propertyId}:${trigger}:${day}`,
        });
        await trx.updateTable("property_matches").set({ notified_user_id: userId, notified_at: now }).where("property_id", "=", propertyId).where("contact_id", "in", ids).where("notified_at", "is", null).execute();
        notified += n;
      }
    }
    await emitEvent(trx, system, {
      type: "match.candidates_computed",
      aggregateType: "property",
      aggregateId: propertyId,
      payload: { trigger, candidates: eligible.length, newCandidates: fresh.length, stale: staleIds.length, algorithmVersion: MATCH_ALGORITHM_VERSION },
      dedupeKey: `match.candidates_computed:${propertyId}:${trigger}:${eventId ?? now.toISOString()}`,
    });
    return { candidates: eligible.length, newCandidates: fresh.length, notified, stale: staleIds.length };
  });
}

/** Recalcula las coincidencias guardadas de un contacto (tras cambiar sus preferencias). Sin avisos: lo cambió el equipo. */
export async function computeMatchesForContact(db: Database, contactId: string): Promise<{ candidates: number; stale: number }> {
  const contact = await db.selectFrom("contacts").select(["id", "organization_id"]).where("id", "=", contactId).where("deleted_at", "is", null).executeTakeFirst();
  if (!contact) return { candidates: 0, stale: 0 };
  const settings = await matchSettings(db);
  const profile = toMatchProfile((await loadEffectiveProfiles(db, contact.organization_id, [contactId])).get(contactId) ?? {});
  const props = profileIsMatchable(profile) ? await loadMatchProperties(db, contact.organization_id, { availableOnly: true }) : [];
  const names = await featureNames(db);
  const eligible = props.map((p) => ({ p, r: scoreMatch(profile, p, { tolerancePct: settings.tolerancePct, featureNames: names }) })).filter((x) => x.r.eligible && x.r.score >= settings.minScore);
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`property_matches:contact:${contactId}`}))`.execute(trx);
    const now = new Date();
    for (const { p, r } of eligible) {
      await sql`
        insert into property_matches(organization_id, contact_id, property_id, score, reasons, algorithm_version, trigger, status, computed_at)
        values (${contact.organization_id}, ${contactId}, ${p.id}, ${r.score}, ${reasonsJson(r)}::jsonb, ${MATCH_ALGORITHM_VERSION}, 'preferences_changed', 'candidate', ${now})
        on conflict (contact_id, property_id) do update set score = excluded.score, reasons = excluded.reasons,
          algorithm_version = excluded.algorithm_version, trigger = excluded.trigger, computed_at = excluded.computed_at,
          status = case when property_matches.status = 'dismissed' then 'dismissed' else 'candidate' end`.execute(trx);
    }
    const keep = eligible.map((e) => e.p.id);
    let q = trx.updateTable("property_matches").set({ status: "stale", computed_at: now }).where("contact_id", "=", contactId).where("status", "=", "candidate");
    if (keep.length) q = q.where("property_id", "not in", keep);
    const stale = await q.executeTakeFirst();
    return { candidates: eligible.length, stale: Number(stale.numUpdatedRows) };
  });
}
