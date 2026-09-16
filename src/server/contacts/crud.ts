/**
 * Alta y edición manual de contactos desde el CRM.
 * Al agregar un email o teléfono se buscan coincidencias exactas con otros contactos y se registran como
 * candidatos a duplicado: la fusión la decide siempre una persona (`mergeContacts`).
 */
import { z } from "zod";
import { pgCode, pgConstraint, sql, type Database, type Tx } from "../db";
import { audit, diff } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { conflict, invalid, notFound } from "../errors";
import { addDuplicateCandidate, findExactMatches, mergeContacts, type ContactRole } from "./service";
import { cleanName, normalizeEmail, normalizePhone } from "./normalize";

export const CONTACT_ROLES = ["owner", "buyer", "prospect", "tenant", "guarantor", "supplier", "other"] as const;
export const DOCUMENT_TYPES = ["dni", "cuit", "cuil", "passport", "other"] as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const emailInput = z.object({ email: z.string().trim().max(254), label: optText(40) });
const phoneInput = z.object({ phone: z.string().trim().max(40), label: optText(40), isWhatsapp: z.boolean().optional() });

const contactBase = z.object({
  kind: z.enum(["person", "company"]),
  firstName: optText(100),
  lastName: optText(100),
  companyName: optText(200),
  documentType: z.enum(DOCUMENT_TYPES).nullable().optional(),
  documentNumber: optText(40),
  assignedUserId: z.uuid().nullable().optional(),
});

export const createContactSchema = contactBase.extend({
  kind: z.enum(["person", "company"]).default("person"),
  emails: z.array(emailInput).max(10).default([]),
  phones: z.array(phoneInput).max(10).default([]),
  roles: z.array(z.enum(CONTACT_ROLES)).max(7).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  idempotencyKey: z.string().min(8).max(200).nullable().optional(),
});
export type CreateContactInput = z.input<typeof createContactSchema>;

export const updateContactSchema = contactBase.partial();

export type DuplicateHit = { contactId: string; displayName: string; by: "email" | "phone" };

function displayNameFor(v: { kind: string; firstName?: string | null; lastName?: string | null; companyName?: string | null }): string | null {
  if (v.kind === "company") return cleanName(v.companyName);
  return cleanName([v.firstName, v.lastName].filter(Boolean).join(" "));
}

function validateDocument(actor: Actor, v: { documentType?: string | null; documentNumber?: string | null }) {
  const touches = (v.documentType !== undefined && v.documentType !== null) || (v.documentNumber !== undefined && v.documentNumber !== null);
  if (touches) requirePermission(actor, "contacts.read_private");
  if (Boolean(v.documentType) !== Boolean(v.documentNumber) && v.documentType !== undefined && v.documentNumber !== undefined) {
    throw invalid("Completá tipo y número de documento", { documentNumber: ["Tipo y número van juntos"] });
  }
}

function documentNumberClean(n: string | null | undefined): string | null | undefined {
  if (n === undefined || n === null) return n;
  return n.replace(/[\s.-]/g, "").toUpperCase();
}

async function assertStaffUser(trx: Tx, userId: string | null | undefined) {
  if (!userId) return;
  const u = await trx.selectFrom("users").select("id").where("id", "=", userId).where("kind", "=", "staff").where("is_active", "=", true).where("deleted_at", "is", null).executeTakeFirst();
  if (!u) throw invalid("Usuario asignado inválido", { assignedUserId: ["Elegí un usuario activo del equipo"] });
}

/** Registra candidatos a duplicado para un email/teléfono recién agregado. Devuelve los contactos coincidentes. */
async function detectDuplicates(trx: Tx, contactId: string, email: string | null, e164: string | null): Promise<DuplicateHit[]> {
  const matches = (await findExactMatches(trx, email, e164)).filter((m) => m.contactId !== contactId);
  if (!matches.length) return [];
  const names = await trx.selectFrom("contacts").select(["id", "display_name"]).where("id", "in", matches.map((m) => m.contactId)).execute();
  const hits: DuplicateHit[] = [];
  for (const m of matches) {
    await addDuplicateCandidate(trx, contactId, m.contactId, m.by === "email" ? "same_email" : "same_phone", 0.95);
    if (!hits.some((h) => h.contactId === m.contactId && h.by === m.by)) {
      hits.push({ contactId: m.contactId, by: m.by, displayName: names.find((n) => n.id === m.contactId)?.display_name ?? "" });
    }
  }
  return hits;
}

async function insertEmail(trx: Tx, contactId: string, raw: { email: string; label?: string | null }, primary: boolean, field: string) {
  const normalized = normalizeEmail(raw.email);
  if (!normalized) throw invalid("Email inválido", { [field]: ["Email inválido"] });
  const r = await trx
    .insertInto("contact_emails")
    .values({ contact_id: contactId, email: raw.email.trim(), email_normalized: normalized, label: raw.label ?? null, is_primary: primary })
    .onConflict((oc) => oc.columns(["contact_id", "email_normalized"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!r) throw conflict("El contacto ya tiene ese email");
  return normalized;
}

async function insertPhone(trx: Tx, contactId: string, raw: { phone: string; label?: string | null; isWhatsapp?: boolean }, primary: boolean, field: string) {
  const normalized = normalizePhone(raw.phone, { assumeMobile: raw.isWhatsapp, defaultAreaCode: "387" });
  if (!normalized) throw invalid("Teléfono inválido", { [field]: ["Teléfono inválido: usá código de área (ej. 387 5123456)"] });
  const existing = await trx
    .selectFrom("contact_phones")
    .select("id")
    .where("contact_id", "=", contactId)
    .where(sql<string>`right(phone_e164, 10)`, "=", normalized.e164.replace(/\D/g, "").slice(-10))
    .executeTakeFirst();
  if (existing) throw conflict("El contacto ya tiene ese teléfono");
  await trx
    .insertInto("contact_phones")
    .values({ contact_id: contactId, phone_raw: raw.phone.trim().slice(0, 40), phone_e164: normalized.e164, label: raw.label ?? null, is_whatsapp: Boolean(raw.isWhatsapp), is_primary: primary })
    .execute();
  return normalized.e164;
}

async function setTagsInternal(trx: Tx, contactId: string, names: string[]) {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  await trx.deleteFrom("contact_tags").where("contact_id", "=", contactId).execute();
  if (!clean.length) return;
  await trx.insertInto("tags").values(clean.map((name) => ({ name }))).onConflict((oc) => oc.column("name").doNothing()).execute();
  const tags = await trx.selectFrom("tags").select("id").where("name", "in", clean).execute();
  await trx.insertInto("contact_tags").values(tags.map((t) => ({ contact_id: contactId, tag_id: t.id }))).onConflict((oc) => oc.doNothing()).execute();
}

function translateDocumentConflict(e: unknown): never {
  if (pgCode(e) === "23505" && pgConstraint(e) === "contacts_document_unique") {
    throw conflict("Ya existe un contacto con ese documento");
  }
  throw e;
}

export async function createContact(db: Database, actor: Actor, raw: CreateContactInput): Promise<{ id: string; duplicates: DuplicateHit[]; replayed: boolean }> {
  requirePermission(actor, "contacts.create");
  const input = createContactSchema.parse(raw);
  validateDocument(actor, input);
  const displayName = displayNameFor(input);
  if (!displayName) {
    throw invalid("Falta el nombre", input.kind === "company" ? { companyName: ["Ingresá la razón social"] } : { firstName: ["Ingresá nombre o apellido"] });
  }
  if (input.idempotencyKey) {
    const prev = await db.selectFrom("contacts").select("id").where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (prev) return { id: prev.id, duplicates: [], replayed: true };
  }
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("contacts")
        .values({
          organization_id: actor.organizationId,
          kind: input.kind,
          first_name: input.kind === "person" ? (input.firstName ?? null) : null,
          last_name: input.kind === "person" ? (input.lastName ?? null) : null,
          company_name: input.companyName ?? null,
          display_name: displayName,
          document_type: input.documentType ?? null,
          document_number: documentNumberClean(input.documentNumber) ?? null,
          source: "manual",
          assigned_user_id: input.assignedUserId ?? null,
          created_by: actorUserId(actor),
          idempotency_key: input.idempotencyKey ?? null,
        })
        .onConflict((oc) => oc.column("idempotency_key").where("idempotency_key", "is not", null).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!row) {
        const prev = await trx.selectFrom("contacts").select("id").where("idempotency_key", "=", input.idempotencyKey!).executeTakeFirstOrThrow();
        return { id: prev.id, duplicates: [], replayed: true };
      }
      await assertStaffUser(trx, input.assignedUserId);
      const duplicates: DuplicateHit[] = [];
      for (const [i, e] of input.emails.entries()) {
        if (!e.email) continue;
        const n = await insertEmail(trx, row.id, e, i === 0, `emails.${i}.email`);
        duplicates.push(...(await detectDuplicates(trx, row.id, n, null)));
      }
      for (const [i, p] of input.phones.entries()) {
        if (!p.phone) continue;
        const n = await insertPhone(trx, row.id, p, i === 0, `phones.${i}.phone`);
        duplicates.push(...(await detectDuplicates(trx, row.id, null, n)));
      }
      for (const role of input.roles) {
        await trx.insertInto("contact_roles").values({ contact_id: row.id, role }).onConflict((oc) => oc.doNothing()).execute();
      }
      await setTagsInternal(trx, row.id, input.tags);
      await audit(trx, actor, {
        action: "CONTACT_CREATED",
        entityType: "contact",
        entityId: row.id,
        after: { displayName, kind: input.kind, roles: input.roles, tags: input.tags, emails: input.emails.length, phones: input.phones.length, hasDocument: Boolean(input.documentNumber), assignedUserId: input.assignedUserId ?? null },
        metadata: duplicates.length ? { duplicateCandidates: duplicates.map((d) => d.contactId) } : undefined,
      });
      return { id: row.id, duplicates, replayed: false };
    });
  } catch (e) {
    translateDocumentConflict(e);
  }
}

async function lockContact(trx: Tx, id: string) {
  const c = await trx.selectFrom("contacts").selectAll().where("id", "=", id).where("deleted_at", "is", null).where("merged_into_id", "is", null).forUpdate().executeTakeFirst();
  if (!c) throw notFound("Contacto");
  return c;
}

export async function updateContact(db: Database, actor: Actor, id: string, raw: z.input<typeof updateContactSchema>): Promise<void> {
  requirePermission(actor, "contacts.update");
  const input = updateContactSchema.parse(raw);
  validateDocument(actor, input);
  try {
    await db.transaction().execute(async (trx) => {
      const c = await lockContact(trx, id);
      const kind = input.kind ?? c.kind;
      const merged = {
        kind,
        firstName: input.firstName !== undefined ? input.firstName : c.first_name,
        lastName: input.lastName !== undefined ? input.lastName : c.last_name,
        companyName: input.companyName !== undefined ? input.companyName : c.company_name,
      };
      const displayName = displayNameFor(merged);
      if (!displayName) throw invalid("Falta el nombre", kind === "company" ? { companyName: ["Ingresá la razón social"] } : { firstName: ["Ingresá nombre o apellido"] });
      if (input.assignedUserId !== undefined) await assertStaffUser(trx, input.assignedUserId);
      const next: Record<string, unknown> = {
        kind,
        first_name: kind === "person" ? merged.firstName : null,
        last_name: kind === "person" ? merged.lastName : null,
        company_name: merged.companyName,
        display_name: displayName,
      };
      if (input.assignedUserId !== undefined) next.assigned_user_id = input.assignedUserId;
      if (input.documentType !== undefined) next.document_type = input.documentType;
      if (input.documentNumber !== undefined) next.document_number = documentNumberClean(input.documentNumber);
      const changes = diff(c as unknown as Record<string, unknown>, next);
      if (!Object.keys(changes.after).length) return;
      await trx.updateTable("contacts").set(changes.after as never).where("id", "=", id).execute();
      // El documento no se copia en claro a la auditoría: solo se registra que cambió.
      const redact = (o: Record<string, unknown>) => ("document_number" in o ? { ...o, document_number: o.document_number ? "[privado]" : null } : o);
      await audit(trx, actor, { action: "CONTACT_UPDATED", entityType: "contact", entityId: id, before: redact(changes.before), after: redact(changes.after) });
    });
  } catch (e) {
    translateDocumentConflict(e);
  }
}

export async function addContactEmail(db: Database, actor: Actor, contactId: string, raw: { email: string; label?: string | null }): Promise<{ duplicates: DuplicateHit[] }> {
  requirePermission(actor, "contacts.update");
  const input = emailInput.parse(raw);
  return db.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    const hasPrimary = await trx.selectFrom("contact_emails").select("id").where("contact_id", "=", contactId).where("is_primary", "=", true).executeTakeFirst();
    const normalized = await insertEmail(trx, contactId, input, !hasPrimary, "email");
    const duplicates = await detectDuplicates(trx, contactId, normalized, null);
    await audit(trx, actor, { action: "CONTACT_EMAIL_ADDED", entityType: "contact", entityId: contactId, after: { email: normalized }, metadata: duplicates.length ? { duplicateCandidates: duplicates.map((d) => d.contactId) } : undefined });
    return { duplicates };
  });
}

export async function addContactPhone(db: Database, actor: Actor, contactId: string, raw: { phone: string; label?: string | null; isWhatsapp?: boolean }): Promise<{ duplicates: DuplicateHit[] }> {
  requirePermission(actor, "contacts.update");
  const input = phoneInput.parse(raw);
  return db.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    const hasPrimary = await trx.selectFrom("contact_phones").select("id").where("contact_id", "=", contactId).where("is_primary", "=", true).executeTakeFirst();
    const e164 = await insertPhone(trx, contactId, input, !hasPrimary, "phone");
    const duplicates = await detectDuplicates(trx, contactId, null, e164);
    await audit(trx, actor, { action: "CONTACT_PHONE_ADDED", entityType: "contact", entityId: contactId, after: { phone: e164, isWhatsapp: Boolean(input.isWhatsapp) }, metadata: duplicates.length ? { duplicateCandidates: duplicates.map((d) => d.contactId) } : undefined });
    return { duplicates };
  });
}

export async function removeContactEmail(db: Database, actor: Actor, contactId: string, emailId: string): Promise<void> {
  requirePermission(actor, "contacts.update");
  await db.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    const row = await trx.deleteFrom("contact_emails").where("id", "=", emailId).where("contact_id", "=", contactId).returning(["email_normalized", "is_primary"]).executeTakeFirst();
    if (!row) throw notFound("Email");
    if (row.is_primary) {
      await sql`update contact_emails set is_primary = true where id = (select id from contact_emails where contact_id = ${contactId} order by created_at limit 1)`.execute(trx);
    }
    await audit(trx, actor, { action: "CONTACT_EMAIL_REMOVED", entityType: "contact", entityId: contactId, before: { email: row.email_normalized } });
  });
}

export async function removeContactPhone(db: Database, actor: Actor, contactId: string, phoneId: string): Promise<void> {
  requirePermission(actor, "contacts.update");
  await db.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    const row = await trx.deleteFrom("contact_phones").where("id", "=", phoneId).where("contact_id", "=", contactId).returning(["phone_e164", "phone_raw", "is_primary"]).executeTakeFirst();
    if (!row) throw notFound("Teléfono");
    if (row.is_primary) {
      await sql`update contact_phones set is_primary = true where id = (select id from contact_phones where contact_id = ${contactId} order by created_at limit 1)`.execute(trx);
    }
    await audit(trx, actor, { action: "CONTACT_PHONE_REMOVED", entityType: "contact", entityId: contactId, before: { phone: row.phone_e164 ?? row.phone_raw } });
  });
}

export async function setContactRoles(db: Database, actor: Actor, contactId: string, rawRoles: unknown): Promise<void> {
  requirePermission(actor, "contacts.update");
  const roles = [...new Set(z.array(z.enum(CONTACT_ROLES)).max(7).parse(rawRoles))] as ContactRole[];
  await db.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    const before = (await trx.selectFrom("contact_roles").select("role").where("contact_id", "=", contactId).execute()).map((r) => r.role).sort();
    if (JSON.stringify(before) === JSON.stringify([...roles].sort())) return;
    await trx.deleteFrom("contact_roles").where("contact_id", "=", contactId).execute();
    if (roles.length) await trx.insertInto("contact_roles").values(roles.map((role) => ({ contact_id: contactId, role }))).execute();
    await audit(trx, actor, { action: "CONTACT_ROLES_CHANGED", entityType: "contact", entityId: contactId, before: { roles: before }, after: { roles: [...roles].sort() } });
  });
}

export async function setContactTags(db: Database, actor: Actor, contactId: string, rawTags: unknown): Promise<void> {
  requirePermission(actor, "contacts.update");
  const tags = z.array(z.string().trim().min(1).max(60)).max(20).parse(rawTags);
  await db.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    const before = (await trx.selectFrom("contact_tags as ct").innerJoin("tags as t", "t.id", "ct.tag_id").select("t.name").where("ct.contact_id", "=", contactId).execute()).map((r) => r.name).sort();
    const after = [...new Set(tags)].sort();
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await setTagsInternal(trx, contactId, after);
    await audit(trx, actor, { action: "CONTACT_TAGS_CHANGED", entityType: "contact", entityId: contactId, before: { tags: before }, after: { tags: after } });
  });
}

/** Revisión de duplicados: descartar (no son la misma persona). */
export async function dismissDuplicateCandidate(db: Database, actor: Actor, candidateId: string): Promise<void> {
  requirePermission(actor, "contacts.merge");
  await db.transaction().execute(async (trx) => {
    const c = await trx.selectFrom("contact_duplicate_candidates").selectAll().where("id", "=", candidateId).forUpdate().executeTakeFirst();
    if (!c) throw notFound("Candidato a duplicado");
    if (c.status !== "open") throw conflict("Este par ya fue revisado");
    await trx.updateTable("contact_duplicate_candidates").set({ status: "dismissed", resolved_by: actorUserId(actor), resolved_at: new Date() }).where("id", "=", candidateId).execute();
    await audit(trx, actor, { action: "CONTACT_DUPLICATE_DISMISSED", entityType: "contact", entityId: c.contact_a, after: { candidateId, contactA: c.contact_a, contactB: c.contact_b, reason: c.reason } });
  });
}

/** Revisión de duplicados: fusionar conservando `keepId` (uno de los dos del par). */
export async function mergeDuplicateCandidate(db: Database, actor: Actor, candidateId: string, keepId: string): Promise<{ keepId: string }> {
  requirePermission(actor, "contacts.merge");
  const c = await db.selectFrom("contact_duplicate_candidates").selectAll().where("id", "=", candidateId).executeTakeFirst();
  if (!c) throw notFound("Candidato a duplicado");
  if (c.status !== "open") throw conflict("Este par ya fue revisado");
  if (keepId !== c.contact_a && keepId !== c.contact_b) throw invalid("El contacto a conservar debe ser uno de los dos del par");
  const mergeId = keepId === c.contact_a ? c.contact_b : c.contact_a;
  await mergeContacts(db, actor, keepId, mergeId);
  return { keepId };
}
