/**
 * Datos de las tarjetas de ventas del CRM (contacto, lead, oportunidad, propiedad). Cada panel respeta el flag
 * `ai_matching` y el alcance del usuario: si el rol no tiene alcance comercial, el panel no se muestra (null).
 */
import "server-only";
import type { Executor } from "../db";
import { can, type Actor } from "../auth/actor";
import { AppError } from "../errors";
import { isEnabled } from "../flags";
import { listCompatibleClients, listCompatibleProperties } from "./matching/service";
import { getNextActions, type NbaEntityType } from "./nba/service";
import { getBuyerProfile } from "./profile/service";
import { getLeadQualification } from "./qualification/service";
import { getIntentSignals } from "./signals/service";

async function hidden<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "not_found" || e.code === "unauthenticated")) return null;
    throw e;
  }
}

export type ProfileOptions = {
  types: Array<{ key: string; name: string }>;
  locations: Array<{ kind: "locality" | "area"; slug: string; name: string; localitySlug: string | null }>;
  features: Array<{ key: string; name: string; group: string }>;
};

export async function profileOptions(db: Executor): Promise<ProfileOptions> {
  const [types, locs, features] = await Promise.all([
    db.selectFrom("property_types").select(["key", "name"]).where("is_active", "=", true).orderBy("sort_order").execute(),
    db.selectFrom("locations as l").leftJoin("locations as p", "p.id", "l.parent_id").select(["l.kind", "l.slug", "l.name", "p.slug as parent_slug", "p.name as parent_name", "p.kind as parent_kind"]).where("l.kind", "in", ["locality", "neighborhood", "gated_community", "zone"]).orderBy("l.name").execute(),
    db.selectFrom("features").select(["key", "name", "grp"]).orderBy("grp").orderBy("sort_order").orderBy("name").execute(),
  ]);
  const seen = new Set<string>();
  const locations: ProfileOptions["locations"] = [];
  for (const l of locs) {
    const isArea = l.kind !== "locality";
    if (isArea && l.parent_name && l.name.localeCompare(l.parent_name, "es", { sensitivity: "base" }) === 0) continue;
    const entry = { kind: isArea ? ("area" as const) : ("locality" as const), slug: l.slug, name: isArea && l.parent_name ? `${l.name}, ${l.parent_name}` : l.name, localitySlug: isArea && l.parent_kind === "locality" ? (l.parent_slug ?? null) : null };
    const k = `${entry.kind}:${entry.slug}:${entry.localitySlug}`;
    if (seen.has(k)) continue;
    seen.add(k);
    locations.push(entry);
  }
  return { types, locations, features: features.map((f) => ({ key: f.key, name: f.name, group: f.grp })) };
}

export async function contactSalesPanels(db: Executor, actor: Actor, contactId: string) {
  if (!(await isEnabled(db, "ai_matching"))) return null;
  const profile = await hidden(() => getBuyerProfile(db, actor, contactId));
  if (!profile) return null;
  const [options, compatible, signals, next] = await Promise.all([
    profile.canEdit ? profileOptions(db) : Promise.resolve(null),
    can(actor, "properties.read") ? hidden(() => listCompatibleProperties(db, actor, contactId)) : Promise.resolve(null),
    hidden(() => getIntentSignals(db, actor, contactId)),
    hidden(() => getNextActions(db, actor, { entityType: "contact", entityId: contactId })),
  ]);
  return { profile, options, compatible, signals, next };
}

export async function nextActionsPanel(db: Executor, actor: Actor, entityType: NbaEntityType, entityId: string) {
  if (!(await isEnabled(db, "ai_matching"))) return null;
  return hidden(() => getNextActions(db, actor, { entityType, entityId }));
}

export async function leadSalesPanels(db: Executor, actor: Actor, leadId: string) {
  if (!(await isEnabled(db, "ai_matching"))) return null;
  const [qualification, next] = await Promise.all([hidden(() => getLeadQualification(db, actor, leadId)), hidden(() => getNextActions(db, actor, { entityType: "lead", entityId: leadId }))]);
  return qualification || next ? { qualification, next } : null;
}

export async function propertyClientsPanel(db: Executor, actor: Actor, propertyId: string) {
  if (!(await isEnabled(db, "ai_matching"))) return null;
  return hidden(() => listCompatibleClients(db, actor, propertyId));
}
