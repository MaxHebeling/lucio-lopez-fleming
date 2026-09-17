/**
 * Perfil inmobiliario del comprador (Buyer Intelligence Profile) sobre `client_preferences`.
 * - Construcción progresiva: formulario del sitio, concierge (al enviar una consulta), conversación, consulta escrita
 *   (con IA) → datos SUGERIDOS con origen y confianza. Nunca se confirman solos.
 * - El equipo confirma, rechaza o carga/corrige (queda confirmado). Todo con historial, auditoría y alcance comercial.
 * - Un cambio de preferencias recalcula coincidencias (job idempotente por contacto).
 */
import "server-only";
import { z } from "zod";
import { sql, type Database, type Executor } from "../../db";
import { audit } from "../../audit";
import { actorUserId, can, type Actor } from "../../auth/actor";
import { forbidden, invalid, notFound } from "../../errors";
import { enqueue } from "../../jobs/queue";
import { loadSalesContact } from "../scope";
import {
  FIELD_LABEL,
  PROFILE_FIELDS,
  SOURCE_LABEL,
  formatFieldValue,
  parseFieldValue,
  stableJson,
  type LocationValue,
  type PreferenceSource,
  type ProfileField,
  type ProposedItem,
} from "./fields";

export type PreferenceDTO = {
  id: string;
  field: ProfileField;
  value: unknown;
  display: string;
  source: PreferenceSource;
  sourceLabel: string;
  confidence: number;
  status: "suggested" | "confirmed" | "rejected" | "superseded";
  createdAt: Date;
  createdBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  leadId: string | null;
};

export type BuyerProfile = {
  contactId: string;
  fields: Array<{ field: ProfileField; label: string; confirmed: PreferenceDTO | null; suggested: PreferenceDTO | null }>;
  confirmedCount: number;
  suggestedCount: number;
  history: PreferenceDTO[];
  canEdit: boolean;
};

async function catalogNames(db: Executor) {
  const [types, features] = await Promise.all([db.selectFrom("property_types").select(["key", "name"]).execute(), db.selectFrom("features").select(["key", "name"]).execute()]);
  return { types: new Map(types.map((t) => [t.key, t.name])), features: new Map(features.map((f) => [f.key, f.name])) };
}

/** Claves de tipo, característica y ubicación tienen que existir de verdad. */
async function validateAgainstCatalog(db: Executor, field: ProfileField, value: unknown): Promise<string | null> {
  if (field === "property_types") {
    const keys = value as string[];
    const n = await db.selectFrom("property_types").select(sql<number>`count(*)::int`.as("n")).where("key", "in", keys).executeTakeFirstOrThrow();
    return n.n === new Set(keys).size ? null : "Hay un tipo de propiedad que no existe";
  }
  if (field === "features") {
    const keys = value as string[];
    const n = await db.selectFrom("features").select(sql<number>`count(*)::int`.as("n")).where("key", "in", keys).executeTakeFirstOrThrow();
    return n.n === new Set(keys).size ? null : "Hay una característica que no existe";
  }
  if (field === "locations") {
    for (const l of value as LocationValue[]) {
      const kinds = l.kind === "locality" ? ["locality"] : ["neighborhood", "gated_community", "zone"];
      const found = await db.selectFrom("locations").select("id").where("slug", "=", l.slug).where("kind", "in", kinds).executeTakeFirst();
      if (!found) return `La zona «${l.name}» no existe`;
    }
  }
  return null;
}

function toDTO(r: { id: string; field: string; value: unknown; source: string; confidence: string | number; status: string; created_at: Date; created_by_name: string | null; decided_by_name: string | null; decided_at: Date | null; lead_id: string | null }, names: Awaited<ReturnType<typeof catalogNames>>): PreferenceDTO {
  const field = r.field as ProfileField;
  return {
    id: r.id,
    field,
    value: r.value,
    display: formatFieldValue(field, r.value, names),
    source: r.source as PreferenceSource,
    sourceLabel: SOURCE_LABEL[r.source as PreferenceSource] ?? r.source,
    confidence: Number(r.confidence),
    status: r.status as PreferenceDTO["status"],
    createdAt: r.created_at,
    createdBy: r.created_by_name,
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at,
    leadId: r.lead_id,
  };
}

export async function getBuyerProfile(db: Executor, actor: Actor, contactId: string): Promise<BuyerProfile> {
  const { actor: staff } = await loadSalesContact(db, actor, contactId);
  const [rows, names] = await Promise.all([
    db
      .selectFrom("client_preferences as p")
      .leftJoin("users as cu", "cu.id", "p.created_by")
      .leftJoin("users as du", "du.id", "p.decided_by")
      .select(["p.id", "p.field", "p.value", "p.source", "p.confidence", "p.status", "p.created_at", "p.decided_at", "p.lead_id", "cu.full_name as created_by_name", "du.full_name as decided_by_name"])
      .where("p.contact_id", "=", contactId)
      .where("p.organization_id", "=", staff.organizationId)
      .orderBy("p.created_at", "desc")
      .orderBy("p.id")
      .limit(200)
      .execute(),
    catalogNames(db),
  ]);
  const dtos = rows.map((r) => toDTO(r, names));
  const fields = PROFILE_FIELDS.map((field) => ({
    field,
    label: FIELD_LABEL[field],
    confirmed: dtos.find((d) => d.field === field && d.status === "confirmed") ?? null,
    suggested: dtos.find((d) => d.field === field && d.status === "suggested") ?? null,
  }));
  return {
    contactId,
    fields,
    confirmedCount: fields.filter((f) => f.confirmed).length,
    suggestedCount: fields.filter((f) => f.suggested).length,
    history: dtos.slice(0, 40),
    canEdit: can(staff, "contacts.update"),
  };
}

/** Recalcular coincidencias del contacto (dedupe: un job vivo por contacto). */
async function requestRematch(db: Executor, contactId: string): Promise<void> {
  await enqueue(db, { type: "sales.match_contact", payload: { contactId }, dedupeKey: `sales.match_contact:${contactId}`, maxAttempts: 3, timeoutMs: 60_000, runAt: new Date(Date.now() + 5_000) });
}

// ───────────────────────── Sugerencias (sistema) ─────────────────────────

/**
 * Propone datos SUGERIDOS (origen + confianza). Idempotente: si el mismo valor ya está confirmado o sugerido, no hace
 * nada. Una sugerencia nueva reemplaza (superseded) la pendiente anterior del mismo campo. Nunca toca lo confirmado.
 */
export async function proposePreferences(
  trx: Executor,
  input: { organizationId: string; contactId: string; source: PreferenceSource; items: ProposedItem[]; leadId?: string | null; createdBy?: string | null },
): Promise<{ proposed: string[] }> {
  const proposed: string[] = [];
  for (const item of input.items) {
    if (item.field === "notes") continue; // las notas solo las escribe el equipo
    const parsed = parseFieldValue(item.field, item.value);
    if (!parsed.ok) continue;
    if (await validateAgainstCatalog(trx, item.field, parsed.value)) continue;
    const current = await trx
      .selectFrom("client_preferences")
      .select(["id", "value", "status"])
      .where("contact_id", "=", input.contactId)
      .where("field", "=", item.field)
      .where("status", "in", ["suggested", "confirmed", "rejected"])
      .orderBy("created_at", "desc")
      .execute();
    const same = (v: unknown) => stableJson(v) === stableJson(parsed.value);
    // Mismo valor ya confirmado, ya sugerido o rechazado antes por el equipo: no se vuelve a proponer.
    if (current.some((c) => same(c.value))) continue;
    await trx.updateTable("client_preferences").set({ status: "superseded" }).where("contact_id", "=", input.contactId).where("field", "=", item.field).where("status", "=", "suggested").execute();
    const row = await trx
      .insertInto("client_preferences")
      .values({
        organization_id: input.organizationId,
        contact_id: input.contactId,
        field: item.field,
        value: JSON.stringify(parsed.value),
        source: input.source,
        confidence: Math.max(0, Math.min(0.95, Math.round(item.confidence * 100) / 100)),
        status: "suggested",
        lead_id: input.leadId ?? null,
        created_by: input.createdBy ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    proposed.push(row.id);
  }
  if (proposed.length) {
    await trx
      .insertInto("activities")
      .values({ entity_type: "contact", entity_id: input.contactId, kind: "profile_suggested", summary: `Datos sugeridos para el perfil (${SOURCE_LABEL[input.source]})`, metadata: JSON.stringify({ count: proposed.length, source: input.source, leadId: input.leadId ?? null }) })
      .execute();
  }
  return { proposed };
}

// ───────────────────────── Acciones del equipo ─────────────────────────

export const setPreferenceSchema = z.object({ contactId: z.uuid(), field: z.enum(PROFILE_FIELDS), value: z.unknown() });
export const decidePreferenceSchema = z.object({ preferenceId: z.uuid() });
export const clearPreferenceSchema = z.object({ contactId: z.uuid(), field: z.enum(PROFILE_FIELDS) });

/** Carga o corrige un dato: queda CONFIRMADO (lo cargó una persona del equipo). */
export async function setPreference(db: Database, actor: Actor, raw: unknown): Promise<{ id: string; changed: boolean }> {
  const input = setPreferenceSchema.parse(raw);
  const { actor: staff } = await loadSalesContact(db, actor, input.contactId);
  if (!can(staff, "contacts.update")) throw forbidden();
  const parsed = parseFieldValue(input.field, input.value);
  if (!parsed.ok) throw invalid(parsed.error, { value: [parsed.error] });
  const catalogError = await validateAgainstCatalog(db, input.field, parsed.value);
  if (catalogError) throw invalid(catalogError, { value: [catalogError] });
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`client_preferences:${input.contactId}:${input.field}`}))`.execute(trx);
    const current = await trx.selectFrom("client_preferences").select(["id", "value"]).where("contact_id", "=", input.contactId).where("field", "=", input.field).where("status", "=", "confirmed").executeTakeFirst();
    if (current && stableJson(current.value) === stableJson(parsed.value)) return { id: current.id, changed: false };
    const now = new Date();
    await trx.updateTable("client_preferences").set({ status: "superseded" }).where("contact_id", "=", input.contactId).where("field", "=", input.field).where("status", "in", ["confirmed", "suggested"]).execute();
    const row = await trx
      .insertInto("client_preferences")
      .values({
        organization_id: staff.organizationId,
        contact_id: input.contactId,
        field: input.field,
        value: JSON.stringify(parsed.value),
        source: "agent",
        confidence: 1,
        status: "confirmed",
        created_by: staff.userId,
        decided_by: staff.userId,
        decided_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    // Auditoría sin el valor de las notas (texto libre); el resto son datos de búsqueda.
    await audit(trx, staff, {
      action: "CLIENT_PREFERENCE_SET",
      entityType: "contact",
      entityId: input.contactId,
      before: current ? { field: input.field, value: input.field === "notes" ? "[texto]" : current.value } : null,
      after: { field: input.field, value: input.field === "notes" ? "[texto]" : parsed.value },
    });
    await requestRematch(trx, input.contactId);
    return { id: row.id, changed: true };
  });
}

async function decide(db: Database, actor: Actor, raw: unknown, to: "confirmed" | "rejected"): Promise<{ changed: boolean }> {
  const input = decidePreferenceSchema.parse(raw);
  const pref = await db.selectFrom("client_preferences").select(["id", "contact_id", "field", "status", "value"]).where("id", "=", input.preferenceId).executeTakeFirst();
  if (!pref) throw notFound("Dato del perfil");
  const { actor: staff } = await loadSalesContact(db, actor, pref.contact_id);
  if (!can(staff, "contacts.update")) throw forbidden();
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`client_preferences:${pref.contact_id}:${pref.field}`}))`.execute(trx);
    const locked = await trx.selectFrom("client_preferences").select(["status"]).where("id", "=", pref.id).forUpdate().executeTakeFirstOrThrow();
    if (locked.status !== "suggested") return { changed: false };
    const now = new Date();
    if (to === "confirmed") {
      await trx.updateTable("client_preferences").set({ status: "superseded" }).where("contact_id", "=", pref.contact_id).where("field", "=", pref.field).where("status", "=", "confirmed").execute();
    }
    await trx.updateTable("client_preferences").set({ status: to, decided_by: staff.userId, decided_at: now }).where("id", "=", pref.id).execute();
    await audit(trx, staff, { action: to === "confirmed" ? "CLIENT_PREFERENCE_CONFIRMED" : "CLIENT_PREFERENCE_REJECTED", entityType: "contact", entityId: pref.contact_id, after: { field: pref.field, preferenceId: pref.id } });
    if (to === "confirmed") await requestRematch(trx, pref.contact_id);
    return { changed: true };
  });
}

export const confirmPreference = (db: Database, actor: Actor, raw: unknown) => decide(db, actor, raw, "confirmed");
export const rejectPreference = (db: Database, actor: Actor, raw: unknown) => decide(db, actor, raw, "rejected");

/** Quita un dato confirmado (queda en el historial). */
export async function clearPreference(db: Database, actor: Actor, raw: unknown): Promise<{ changed: boolean }> {
  const input = clearPreferenceSchema.parse(raw);
  const { actor: staff } = await loadSalesContact(db, actor, input.contactId);
  if (!can(staff, "contacts.update")) throw forbidden();
  return db.transaction().execute(async (trx) => {
    const r = await trx.updateTable("client_preferences").set({ status: "superseded" }).where("contact_id", "=", input.contactId).where("field", "=", input.field).where("status", "=", "confirmed").executeTakeFirst();
    const changed = Number(r.numUpdatedRows) > 0;
    if (changed) {
      await audit(trx, staff, { action: "CLIENT_PREFERENCE_CLEARED", entityType: "contact", entityId: input.contactId, after: { field: input.field } });
      await requestRematch(trx, input.contactId);
    }
    return { changed };
  });
}

// ───────────────────────── Perfil efectivo (para coincidencias y siguiente acción) ─────────────────────────

export type EffectiveValue<T> = { value: T; confirmed: boolean; source: PreferenceSource };
export type EffectiveProfile = Partial<{ [F in ProfileField]: EffectiveValue<unknown> }>;

/** Confirmado si existe; si no, la sugerencia pendiente (marcada como no confirmada). Sin control de alcance: uso interno. */
export async function loadEffectiveProfiles(db: Executor, organizationId: string, contactIds?: string[]): Promise<Map<string, EffectiveProfile>> {
  if (contactIds && contactIds.length === 0) return new Map();
  let q = db
    .selectFrom("client_preferences")
    .select(["contact_id", "field", "value", "status", "source"])
    .where("organization_id", "=", organizationId)
    .where("status", "in", ["confirmed", "suggested"]);
  if (contactIds) q = q.where("contact_id", "in", contactIds);
  const rows = await q.execute();
  const out = new Map<string, EffectiveProfile>();
  for (const r of rows) {
    const p = out.get(r.contact_id) ?? {};
    const field = r.field as ProfileField;
    const existing = p[field];
    if (!existing || (!existing.confirmed && r.status === "confirmed")) p[field] = { value: r.value, confirmed: r.status === "confirmed", source: r.source as PreferenceSource };
    out.set(r.contact_id, p);
  }
  return out;
}
