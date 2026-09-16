/**
 * Contactos únicos. Toda captura (web, WhatsApp, portales, importación, carga manual) pasa por
 * `resolveContactForCapture`: coincidencia exacta de email o teléfono normalizado → mismo contacto;
 * coincidencias ambiguas → se crea uno nuevo y se registra un candidato a duplicado para revisión humana.
 */
import { sql, type Database, type Executor, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { conflict, invalid, notFound } from "../errors";
import { cleanName, normalizeEmail, normalizePhone, phoneMatchKey, splitName } from "./normalize";

export type ContactRole = "owner" | "buyer" | "prospect" | "tenant" | "guarantor" | "supplier" | "other";

export type CaptureContactInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneIsWhatsapp?: boolean;
  source: string;
  role?: ContactRole;
};

export type ContactMatch = { contactId: string; by: "email" | "phone" };

export async function findExactMatches(db: Executor, email: string | null, e164: string | null): Promise<ContactMatch[]> {
  const matches: ContactMatch[] = [];
  if (email) {
    const rows = await db
      .selectFrom("contact_emails as ce")
      .innerJoin("contacts as c", "c.id", "ce.contact_id")
      .select("c.id")
      .where("ce.email_normalized", "=", email)
      .where("c.deleted_at", "is", null)
      .where("c.merged_into_id", "is", null)
      .execute();
    for (const r of rows) matches.push({ contactId: r.id, by: "email" });
  }
  if (e164) {
    const rows = await db
      .selectFrom("contact_phones as cp")
      .innerJoin("contacts as c", "c.id", "cp.contact_id")
      .select("c.id")
      .where(sql<string>`right(cp.phone_e164, 10)`, "=", phoneMatchKey(e164))
      .where("c.deleted_at", "is", null)
      .where("c.merged_into_id", "is", null)
      .execute();
    for (const r of rows) matches.push({ contactId: r.id, by: "phone" });
  }
  return matches;
}

/**
 * Devuelve el contacto a usar para una captura (creándolo si hace falta). Debe llamarse dentro de una transacción.
 * Serializa capturas concurrentes del mismo email/teléfono con un advisory lock transaccional.
 */
export async function resolveContactForCapture(
  trx: Tx,
  actor: Actor,
  input: CaptureContactInput,
): Promise<{ contactId: string; created: boolean }> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone, { assumeMobile: input.phoneIsWhatsapp, defaultAreaCode: "387" });
  const name = cleanName(input.name);
  if (!email && !phone && !name) throw invalid("Se necesita al menos nombre, email o teléfono");

  const lockKeys = [email, phone ? phoneMatchKey(phone.e164) : null].filter(Boolean) as string[];
  for (const k of lockKeys.sort()) {
    await sql`select pg_advisory_xact_lock(hashtext(${`contact:${k}`}))`.execute(trx);
  }

  const matches = await findExactMatches(trx, email, phone?.e164 ?? null);
  const distinct = [...new Set(matches.map((m) => m.contactId))];

  let contactId: string;
  let created = false;
  if (distinct.length === 1) {
    contactId = distinct[0]!;
  } else {
    const { first, last } = splitName(name ?? "");
    const row = await trx
      .insertInto("contacts")
      .values({
        organization_id: actor.organizationId,
        kind: "person",
        first_name: name ? first : null,
        last_name: name ? last : null,
        display_name: name ?? email ?? phone?.e164 ?? "Sin nombre",
        source: input.source,
        created_by: actorUserId(actor),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    contactId = row.id;
    created = true;
    // Coincide con más de un contacto existente: no se adivina, se deja para revisión.
    for (const other of distinct) {
      await addDuplicateCandidate(trx, contactId, other, matches.find((m) => m.contactId === other)!.by === "email" ? "same_email" : "same_phone", 0.9);
    }
    await audit(trx, actor, { action: "CONTACT_CREATED", entityType: "contact", entityId: contactId, after: { source: input.source, via: "capture" } });
  }

  if (email) {
    await trx
      .insertInto("contact_emails")
      .values({ contact_id: contactId, email: input.email!.trim(), email_normalized: email, is_primary: created })
      .onConflict((oc) => oc.columns(["contact_id", "email_normalized"]).doNothing())
      .execute();
  }
  if (phone) {
    const existing = await trx
      .selectFrom("contact_phones")
      .select(["id", "is_whatsapp"])
      .where("contact_id", "=", contactId)
      .where(sql<string>`right(phone_e164, 10)`, "=", phoneMatchKey(phone.e164))
      .executeTakeFirst();
    if (!existing) {
      await trx
        .insertInto("contact_phones")
        .values({ contact_id: contactId, phone_raw: input.phone!.trim().slice(0, 40), phone_e164: phone.e164, is_whatsapp: Boolean(input.phoneIsWhatsapp), is_primary: created })
        .execute();
    } else if (input.phoneIsWhatsapp && !existing.is_whatsapp) {
      await trx.updateTable("contact_phones").set({ is_whatsapp: true, phone_e164: phone.e164 }).where("id", "=", existing.id).execute();
    }
  }
  if (!created && name) {
    // Completa el nombre si el contacto solo tenía email/teléfono como nombre visible.
    await trx
      .updateTable("contacts")
      .set({ display_name: name, first_name: splitName(name).first, last_name: splitName(name).last })
      .where("id", "=", contactId)
      .where((eb) => eb.or([eb("display_name", "=", email ?? ""), eb("display_name", "=", phone?.e164 ?? ""), eb("display_name", "=", "Sin nombre")]))
      .execute();
  }
  if (input.role) await addContactRole(trx, contactId, input.role);
  return { contactId, created };
}

export async function addContactRole(db: Executor, contactId: string, role: ContactRole): Promise<void> {
  await db.insertInto("contact_roles").values({ contact_id: contactId, role }).onConflict((oc) => oc.doNothing()).execute();
}

export async function addDuplicateCandidate(
  db: Executor,
  a: string,
  b: string,
  reason: "same_email" | "same_phone" | "similar_name_and_phone" | "same_document",
  score: number,
): Promise<void> {
  if (a === b) return;
  const [x, y] = a < b ? [a, b] : [b, a];
  await db
    .insertInto("contact_duplicate_candidates")
    .values({ contact_a: x, contact_b: y, reason, score: score.toFixed(3) })
    .onConflict((oc) => oc.columns(["contact_a", "contact_b"]).doNothing())
    .execute();
}

/**
 * Fusión manual: todo lo del contacto `mergeId` pasa a `keepId`; `mergeId` queda marcado (no se borra).
 * Operación sensible: permiso contacts.merge, transacción única y auditoría con el detalle movido.
 */
export async function mergeContacts(db: Database, actor: Actor, keepId: string, mergeId: string): Promise<void> {
  requirePermission(actor, "contacts.merge");
  if (keepId === mergeId) throw invalid("No se puede fusionar un contacto consigo mismo");
  await db.transaction().execute(async (trx) => {
    const both = await trx
      .selectFrom("contacts")
      .select(["id", "display_name", "merged_into_id", "deleted_at"])
      .where("id", "in", [keepId, mergeId])
      .forUpdate()
      .execute();
    if (both.length !== 2) throw notFound("Contacto");
    if (both.some((c) => c.merged_into_id || c.deleted_at)) throw conflict("Uno de los contactos ya fue fusionado o eliminado");

    const moved: Record<string, number> = {};
    const move = async (label: string, q: Promise<{ numUpdatedRows: bigint }>) => {
      moved[label] = Number((await q).numUpdatedRows);
    };
    // Emails/teléfonos: se mueven los que no existen en el destino
    await sql`insert into contact_emails(contact_id, email, email_normalized, label)
      select ${keepId}, email, email_normalized, label from contact_emails where contact_id = ${mergeId}
      on conflict (contact_id, email_normalized) do nothing`.execute(trx);
    await sql`insert into contact_phones(contact_id, phone_raw, phone_e164, label, is_whatsapp)
      select ${keepId}, p.phone_raw, p.phone_e164, p.label, p.is_whatsapp from contact_phones p where p.contact_id = ${mergeId}
      and not exists (select 1 from contact_phones k where k.contact_id = ${keepId} and right(k.phone_e164,10) = right(p.phone_e164,10))`.execute(trx);
    await sql`insert into contact_roles(contact_id, role) select ${keepId}, role from contact_roles where contact_id = ${mergeId} on conflict do nothing`.execute(trx);
    await sql`insert into contact_tags(contact_id, tag_id) select ${keepId}, tag_id from contact_tags where contact_id = ${mergeId} on conflict do nothing`.execute(trx);
    await move("leads", trx.updateTable("leads").set({ contact_id: keepId }).where("contact_id", "=", mergeId).executeTakeFirst());
    await move("opportunities", trx.updateTable("opportunities").set({ contact_id: keepId }).where("contact_id", "=", mergeId).executeTakeFirst());
    await move("appointments", trx.updateTable("appointments").set({ contact_id: keepId }).where("contact_id", "=", mergeId).executeTakeFirst());
    await move("conversations", trx.updateTable("conversations").set({ contact_id: keepId }).where("contact_id", "=", mergeId).executeTakeFirst());
    await move("notes", trx.updateTable("notes").set({ entity_id: keepId }).where("entity_type", "=", "contact").where("entity_id", "=", mergeId).executeTakeFirst());
    await move("tasks", trx.updateTable("tasks").set({ entity_id: keepId }).where("entity_type", "=", "contact").where("entity_id", "=", mergeId).executeTakeFirst());
    await sql`insert into property_owners(property_id, contact_id, share_pct, is_primary, since, until)
      select property_id, ${keepId}, share_pct, is_primary, since, until from property_owners where contact_id = ${mergeId}
      on conflict (property_id, contact_id) do nothing`.execute(trx);
    await trx.deleteFrom("property_owners").where("contact_id", "=", mergeId).execute();
    await sql`insert into rental_contract_parties(contract_id, contact_id, role, share_pct)
      select contract_id, ${keepId}, role, share_pct from rental_contract_parties where contact_id = ${mergeId}
      on conflict do nothing`.execute(trx);
    await trx.deleteFrom("rental_contract_parties").where("contact_id", "=", mergeId).execute();
    await move("settlements", trx.updateTable("owner_settlements").set({ owner_contact_id: keepId }).where("owner_contact_id", "=", mergeId).executeTakeFirst());
    await move("owner_reports", trx.updateTable("owner_reports").set({ owner_contact_id: keepId }).where("owner_contact_id", "=", mergeId).executeTakeFirst());
    // Un usuario del portal vinculado al contacto fusionado pasa al que se conserva (si este no tiene uno)
    const keepUser = await trx.selectFrom("users").select("id").where("contact_id", "=", keepId).where("deleted_at", "is", null).executeTakeFirst();
    if (!keepUser) await trx.updateTable("users").set({ contact_id: keepId }).where("contact_id", "=", mergeId).execute();

    await trx.updateTable("contacts").set({ merged_into_id: keepId, deleted_at: new Date() }).where("id", "=", mergeId).execute();
    await trx
      .updateTable("contact_duplicate_candidates")
      .set({ status: "merged", resolved_by: actorUserId(actor), resolved_at: new Date() })
      .where((eb) => eb.or([eb("contact_a", "in", [keepId, mergeId]), eb("contact_b", "in", [keepId, mergeId])]))
      .where("status", "=", "open")
      .execute();
    await audit(trx, actor, {
      action: "CONTACTS_MERGED",
      entityType: "contact",
      entityId: keepId,
      before: { merged: both.find((c) => c.id === mergeId) },
      after: { keepId, mergeId, moved },
    });
  });
}
