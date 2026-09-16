"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  assignAgents,
  changePrice,
  changeStatus,
  createProperty,
  duplicateProperty,
  publishProperty,
  setOwners,
  unpublishProperty,
  updateProperty,
} from "@/server/properties/service";
import { createPropertySchema, operationInputSchema, PROPERTY_STATUSES, updatePropertySchema } from "@/server/properties/schema";
import { listLocationChildren, searchOwnerCandidates } from "@/server/properties/queries";
import { createLocation, createLocationSchema } from "@/server/properties/locations";
import { deletePropertyMedia, reorderPropertyMedia, setPropertyCover, updateMediaAltText } from "@/server/properties/media";
import { markPropertyVerified } from "@/server/migration/review";

const id = z.uuid();
const reason = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(500).nullable().optional());

export async function createPropertyAction(input: unknown) {
  return runAction("properties.create", createPropertySchema, input, async (data, actor) => {
    const r = await createProperty(getDb(), actor, data);
    return { id: r.id, code: r.code };
  });
}

export async function updatePropertyAction(propertyId: string, input: unknown) {
  const r = await runAction("properties.update", z.object({ id, data: updatePropertySchema }), { id: propertyId, data: input }, (d, actor) => updateProperty(getDb(), actor, d.id, d.data));
  if (r.ok) refresh();
  return prefixFieldErrors(r, "data.");
}

export async function changePriceAction(propertyId: string, input: unknown) {
  const schema = z.object({ id, op: operationInputSchema, reason });
  const raw = (input ?? {}) as Record<string, unknown>;
  const r = await runAction("properties.change_price", schema, { id: propertyId, op: raw, reason: raw.reason }, (d, actor) => changePrice(getDb(), actor, d.id, d.op, d.reason));
  if (r.ok) refresh();
  return prefixFieldErrors(r, "op.");
}

export async function changeStatusAction(propertyId: string, to: string, why: string | null) {
  const r = await runAction("properties.change_status", z.object({ id, to: z.enum(PROPERTY_STATUSES), reason }), { id: propertyId, to, reason: why }, (d, actor) => changeStatus(getDb(), actor, d.id, d.to, d.reason));
  if (r.ok) refresh();
  return r;
}

export async function publishAction(propertyId: string) {
  const r = await runAction("properties.publish", id, propertyId, (d, actor) => publishProperty(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function unpublishAction(propertyId: string, why: string | null) {
  const r = await runAction("properties.unpublish", z.object({ id, reason }), { id: propertyId, reason: why }, (d, actor) => unpublishProperty(getDb(), actor, d.id, d.reason));
  if (r.ok) refresh();
  return r;
}

export async function duplicateAction(propertyId: string) {
  return runAction("properties.duplicate", id, propertyId, async (d, actor) => {
    const r = await duplicateProperty(getDb(), actor, d);
    return { id: r.id, code: r.code };
  });
}

export async function assignAgentsAction(propertyId: string, leadUserId: string | null, supportUserIds: string[]) {
  const schema = z.object({ id, lead: id.nullable(), support: z.array(id).max(20) });
  const r = await runAction("properties.assign_agents", schema, { id: propertyId, lead: leadUserId || null, support: supportUserIds }, (d, actor) => assignAgents(getDb(), actor, d.id, d.lead, d.support));
  if (r.ok) refresh();
  return r;
}

const ownersSchema = z
  .array(z.object({ contactId: id, sharePct: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().gt(0, "Debe ser mayor a 0").max(100, "Máximo 100").nullable()), isPrimary: z.boolean() }))
  .max(20)
  .refine((o) => new Set(o.map((x) => x.contactId)).size === o.length, "Hay propietarios repetidos")
  .refine((o) => o.length === 0 || o.filter((x) => x.isPrimary).length === 1, "Marcá un único propietario principal");

export async function setOwnersAction(propertyId: string, owners: unknown) {
  const r = await runAction("properties.set_owners", z.object({ id, owners: ownersSchema }), { id: propertyId, owners }, (d, actor) => setOwners(getDb(), actor, d.id, d.owners));
  if (r.ok) refresh();
  return r;
}

export async function searchOwnersAction(q: string) {
  return runAction("properties.search_owners", z.string().max(120), q, (d, actor) => searchOwnerCandidates(getDb(), actor, d));
}

export async function locationChildrenAction(parentId: string | null) {
  return runAction("locations.children", id.nullable(), parentId, (d, actor) => listLocationChildren(getDb(), actor, d));
}

export async function createLocationAction(input: unknown) {
  return runAction("locations.create", createLocationSchema, input, (d, actor) => createLocation(getDb(), actor, d));
}

export async function reorderMediaAction(propertyId: string, ids: string[]) {
  const r = await runAction("properties.media.reorder", z.object({ id, ids: z.array(id).max(200) }), { id: propertyId, ids }, (d, actor) => reorderPropertyMedia(getDb(), actor, d.id, d.ids));
  if (r.ok) refresh();
  return r;
}

export async function setCoverAction(propertyId: string, mediaId: string) {
  const r = await runAction("properties.media.cover", z.object({ id, mediaId: id }), { id: propertyId, mediaId }, (d, actor) => setPropertyCover(getDb(), actor, d.id, d.mediaId));
  if (r.ok) refresh();
  return r;
}

export async function altTextAction(propertyId: string, mediaId: string, altText: string) {
  const r = await runAction("properties.media.alt", z.object({ id, mediaId: id, altText: z.string().max(1000) }), { id: propertyId, mediaId, altText }, (d, actor) => updateMediaAltText(getDb(), actor, d.id, d.mediaId, d.altText));
  if (r.ok) refresh();
  return r;
}

export async function deleteMediaAction(propertyId: string, mediaId: string) {
  const r = await runAction("properties.media.delete", z.object({ id, mediaId: id }), { id: propertyId, mediaId }, (d, actor) => deletePropertyMedia(getDb(), actor, d.id, d.mediaId));
  if (r.ok) refresh();
  return r;
}

export async function markVerifiedAction(propertyId: string) {
  const r = await runAction("migration.verify_property", id, propertyId, (d, actor) => markPropertyVerified(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

/** runAction devuelve rutas como "data.title": la UI usa el nombre del campo. */
function prefixFieldErrors<T extends { ok: boolean; fieldErrors?: Record<string, string[]> }>(r: T, prefix: string): T {
  if (r.ok || !r.fieldErrors) return r;
  const fieldErrors: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(r.fieldErrors)) fieldErrors[k.startsWith(prefix) ? k.slice(prefix.length) : k] = v;
  return { ...r, fieldErrors };
}
