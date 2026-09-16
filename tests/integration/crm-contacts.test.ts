import { describe, expect, it } from "vitest";
import { addContactEmail, addContactPhone, createContact, dismissDuplicateCandidate, mergeDuplicateCandidate, removeContactPhone, setContactRoles, setContactTags, updateContact } from "@/server/contacts/crud";
import { getContactDetail, getContactTimeline, getDuplicateComparison, listContacts, listDuplicateCandidates } from "@/server/contacts/queries";
import { addNote } from "@/server/notes/service";
import { logOutreach } from "@/server/activities/outreach";
import { captureLead } from "@/server/leads/capture";
import { AppError } from "@/server/errors";
import { createStaff, testDb } from "../helpers/db";
import { key, uniqueEmail, uniquePhone } from "../helpers/crm";

describe("contactos: alta, edición y búsqueda", () => {
  it("crea con email/teléfono normalizados, roles y etiquetas; auditado e idempotente", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const email = uniqueEmail("marta");
    const k = key();
    const input = { firstName: "Marta", lastName: "Díaz", emails: [{ email: email.toUpperCase() }], phones: [{ phone: "0387 15 4123987", isWhatsapp: true }], roles: ["buyer" as const], tags: ["Inversor"], idempotencyKey: k };
    const r = await createContact(db, agent, input);
    const again = await createContact(db, agent, input);
    expect(again).toMatchObject({ id: r.id, replayed: true });
    const detail = await getContactDetail(db, agent, r.id);
    if (detail.mergedInto) throw new Error("no debería estar fusionado");
    expect(detail.contact.displayName).toBe("Marta Díaz");
    expect(detail.emails[0]).toMatchObject({ is_primary: true });
    expect(detail.phones[0]?.phone_e164).toBe("+5493874123987");
    expect(detail.roles).toEqual(["buyer"]);
    expect(detail.tags.map((t) => t.name)).toEqual(["Inversor"]);
    const audits = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", r.id).execute();
    expect(audits.map((a) => a.action)).toEqual(["CONTACT_CREATED"]);

    // Búsqueda por nombre sin tildes, email y teléfono en otro formato
    for (const q of ["marta diaz", email.slice(0, 10), "+54 9 387 412-3987", "4123987"]) {
      const list = await listContacts(db, agent, { q });
      expect(list.rows.map((x) => x.id), q).toContain(r.id);
    }
    const byRole = await listContacts(db, agent, { role: "owner" });
    expect(byRole.rows.map((x) => x.id)).not.toContain(r.id);
  });

  it("email o teléfono de otro contacto → candidato a duplicado, nunca fusión automática", async () => {
    const db = testDb();
    const admin = await createStaff(db, ["administrador"]);
    const phone = uniquePhone();
    const email = uniqueEmail("dup");
    const a = await captureLead(db, { kind: "anonymous", organizationId: admin.organizationId }, { name: "Jorge Ruiz", phone, email, sourceKey: "web_contact" });
    const b = await createContact(db, admin, { firstName: "Jorge", lastName: "R.", phones: [{ phone: `+54 9 ${phone}` }], idempotencyKey: key() });
    expect(b.duplicates).toEqual([expect.objectContaining({ contactId: a.contactId, by: "phone" })]);
    const c = await createContact(db, admin, { firstName: "Otro", idempotencyKey: key() });
    const added = await addContactEmail(db, admin, c.id, { email });
    expect(added.duplicates.map((d) => d.contactId)).toEqual([a.contactId]);

    const open = await listDuplicateCandidates(db, admin);
    const pairB = open.find((d) => [d.a_id, d.b_id].includes(b.id))!;
    const pairC = open.find((d) => [d.a_id, d.b_id].includes(c.id))!;
    expect(pairB.reason).toBe("same_phone");
    expect(pairC.reason).toBe("same_email");
    // Siguen siendo contactos distintos
    const contacts = await db.selectFrom("contacts").select("merged_into_id").where("id", "in", [a.contactId, b.id, c.id]).execute();
    expect(contacts.every((x) => x.merged_into_id === null)).toBe(true);

    const cmp = await getDuplicateComparison(db, admin, pairB.id);
    expect(cmp.a && cmp.b).toBeTruthy();

    // Agente no revisa duplicados
    const agent = await createStaff(db, ["agente"]);
    await expect(dismissDuplicateCandidate(db, agent, pairC.id)).rejects.toThrow(/permiso/);
    await dismissDuplicateCandidate(db, admin, pairC.id);
    await expect(dismissDuplicateCandidate(db, admin, pairC.id)).rejects.toThrow(/ya fue revisado/);

    await expect(mergeDuplicateCandidate(db, admin, pairB.id, c.id)).rejects.toThrow(/uno de los dos/);
    await mergeDuplicateCandidate(db, admin, pairB.id, a.contactId);
    const merged = await getContactDetail(db, admin, b.id);
    expect(merged.mergedInto).toBe(a.contactId);
    const lead = await db.selectFrom("leads").select("contact_id").where("id", "=", a.leadId).executeTakeFirstOrThrow();
    expect(lead.contact_id).toBe(a.contactId);
  });

  it("documento: solo con contacts.read_private (lectura y escritura) y sin copiarlo a la auditoría", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const rentals = await createStaff(db, ["alquileres"]);
    await expect(createContact(db, agent, { firstName: "Ana", documentType: "dni", documentNumber: "30111222", idempotencyKey: key() })).rejects.toThrow(/permiso/);
    const r = await createContact(db, rentals, { firstName: "Ana", lastName: "Paz", documentType: "dni", documentNumber: "30.111.222", idempotencyKey: key() });
    const forAgent = await getContactDetail(db, agent, r.id);
    const forRentals = await getContactDetail(db, rentals, r.id);
    if (forAgent.mergedInto || forRentals.mergedInto) throw new Error();
    expect(forAgent.contact.document).toBeNull();
    expect(forRentals.contact.document).toEqual({ type: "dni", number: "30111222" });
    await expect(createContact(db, rentals, { firstName: "Clon", documentType: "dni", documentNumber: "30111222", idempotencyKey: key() })).rejects.toThrow(/ya existe un contacto con ese documento/i);
    await updateContact(db, rentals, r.id, { documentType: "dni", documentNumber: "30111223" });
    const audit = await db.selectFrom("audit_logs").select(["after"]).where("entity_id", "=", r.id).where("action", "=", "CONTACT_UPDATED").executeTakeFirstOrThrow();
    expect(JSON.stringify(audit.after)).not.toContain("30111223");
    await expect(updateContact(db, agent, r.id, { documentNumber: "1" })).rejects.toThrow(/permiso/);
  });

  it("edición, roles, etiquetas, teléfonos, notas y timeline con permisos", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const readonly = await createStaff(db, ["solo_lectura"]);
    const r = await createContact(db, agent, { kind: "company", companyName: "Constructora Norte SRL", idempotencyKey: key() });
    await expect(updateContact(db, readonly, r.id, { companyName: "X" })).rejects.toBeInstanceOf(AppError);
    await updateContact(db, agent, r.id, { companyName: "Constructora del Norte SRL" });
    await setContactRoles(db, agent, r.id, ["supplier", "owner"]);
    await setContactTags(db, agent, r.id, ["Obra", "Proveedor"]);
    const { duplicates } = await addContactPhone(db, agent, r.id, { phone: uniquePhone(), isWhatsapp: false });
    expect(duplicates).toEqual([]);
    await expect(addContactPhone(db, agent, r.id, { phone: "abc" })).rejects.toThrow(/Teléfono inválido/);
    const noteKey = key();
    await addNote(db, agent, { entityType: "contact", entityId: r.id, body: "Pidió presupuesto de mantenimiento", idempotencyKey: noteKey });
    await addNote(db, agent, { entityType: "contact", entityId: r.id, body: "Pidió presupuesto de mantenimiento", idempotencyKey: noteKey });
    await expect(addNote(db, readonly, { entityType: "contact", entityId: r.id, body: "x" })).rejects.toThrow(/permiso/);
    expect(await logOutreach(db, agent, { entityType: "contact", entityId: r.id, channel: "whatsapp" })).toEqual({ logged: true });
    expect(await logOutreach(db, agent, { entityType: "contact", entityId: r.id, channel: "whatsapp" })).toEqual({ logged: false });

    const detail = await getContactDetail(db, agent, r.id);
    if (detail.mergedInto) throw new Error();
    expect(detail.contact.displayName).toBe("Constructora del Norte SRL");
    expect(detail.roles.sort()).toEqual(["owner", "supplier"]);
    expect(detail.notes).toHaveLength(1);
    await removeContactPhone(db, agent, r.id, detail.phones[0]!.id);
    const timeline = await getContactTimeline(db, agent, r.id);
    expect(timeline.map((t) => t.title)).toContain("WhatsApp abierto desde el CRM");
    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", r.id).orderBy("id").execute()).map((a) => a.action);
    expect(actions).toEqual(["CONTACT_CREATED", "CONTACT_UPDATED", "CONTACT_ROLES_CHANGED", "CONTACT_TAGS_CHANGED", "CONTACT_PHONE_ADDED", "NOTE_ADDED", "OUTREACH_LOGGED", "CONTACT_PHONE_REMOVED"]);
  });
});
