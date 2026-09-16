"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  addContactEmail,
  addContactPhone,
  createContact,
  createContactSchema,
  dismissDuplicateCandidate,
  mergeDuplicateCandidate,
  removeContactEmail,
  removeContactPhone,
  setContactRoles,
  setContactTags,
  updateContactSchema,
  updateContact,
  CONTACT_ROLES,
} from "@/server/contacts/crud";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const nullable = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === undefined || v === "" ? null : v;
};
const splitTags = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export async function createContactAction(fd: FormData) {
  const r = await runAction(
    "contacts.create",
    createContactSchema,
    {
      kind: str(fd, "kind") ?? "person",
      firstName: str(fd, "firstName"),
      lastName: str(fd, "lastName"),
      companyName: str(fd, "companyName"),
      documentType: nullable(fd, "documentType"),
      documentNumber: str(fd, "documentNumber"),
      assignedUserId: nullable(fd, "assignedUserId"),
      emails: str(fd, "email") ? [{ email: str(fd, "email")! }] : [],
      phones: str(fd, "phone") ? [{ phone: str(fd, "phone")!, isWhatsapp: fd.get("phoneIsWhatsapp") === "on" }] : [],
      roles: fd.getAll("roles"),
      tags: splitTags(str(fd, "tags")),
      idempotencyKey: str(fd, "idempotencyKey"),
    },
    (data, actor) => createContact(getDb(), actor, data),
  );
  if (!r.ok) return r;
  redirect(`/crm/contactos/${r.data.id}`);
}

export async function updateContactAction(fd: FormData) {
  const id = z.uuid().safeParse(str(fd, "contactId"));
  if (!id.success) return { ok: false as const, error: "Contacto inválido" };
  const input: Record<string, unknown> = {
    kind: str(fd, "kind"),
    firstName: str(fd, "firstName") ?? "",
    lastName: str(fd, "lastName") ?? "",
    companyName: str(fd, "companyName") ?? "",
    assignedUserId: nullable(fd, "assignedUserId"),
  };
  // El documento solo viaja si el formulario lo mostró (permiso contacts.read_private).
  if (fd.has("documentNumber")) {
    input.documentType = nullable(fd, "documentType");
    input.documentNumber = nullable(fd, "documentNumber");
  }
  const r = await runAction("contacts.update", updateContactSchema, input, (data, actor) => updateContact(getDb(), actor, id.data, data));
  if (!r.ok) return r;
  redirect(`/crm/contactos/${id.data}`);
}

const idSchema = z.object({ contactId: z.uuid() });

export async function addEmailAction(fd: FormData) {
  const r = await runAction(
    "contacts.add_email",
    idSchema.extend({ email: z.string().trim().min(3, "Ingresá un email").max(254) }),
    { contactId: str(fd, "contactId"), email: str(fd, "email") ?? "" },
    (d, actor) => addContactEmail(getDb(), actor, d.contactId, { email: d.email }),
  );
  if (r.ok) refresh();
  return r;
}

export async function addPhoneAction(fd: FormData) {
  const r = await runAction(
    "contacts.add_phone",
    idSchema.extend({ phone: z.string().trim().min(6, "Ingresá un teléfono").max(40), isWhatsapp: z.boolean(), label: z.string().trim().max(40).optional() }),
    { contactId: str(fd, "contactId"), phone: str(fd, "phone") ?? "", isWhatsapp: fd.get("isWhatsapp") === "on", label: str(fd, "label") },
    (d, actor) => addContactPhone(getDb(), actor, d.contactId, { phone: d.phone, isWhatsapp: d.isWhatsapp, label: d.label || null }),
  );
  if (r.ok) refresh();
  return r;
}

export async function removeEmailAction(input: { contactId: string; emailId: string }) {
  const r = await runAction("contacts.remove_email", idSchema.extend({ emailId: z.uuid() }), input, (d, actor) => removeContactEmail(getDb(), actor, d.contactId, d.emailId));
  if (r.ok) refresh();
  return r;
}

export async function removePhoneAction(input: { contactId: string; phoneId: string }) {
  const r = await runAction("contacts.remove_phone", idSchema.extend({ phoneId: z.uuid() }), input, (d, actor) => removeContactPhone(getDb(), actor, d.contactId, d.phoneId));
  if (r.ok) refresh();
  return r;
}

export async function setRolesAndTagsAction(fd: FormData) {
  const r = await runAction(
    "contacts.set_roles_tags",
    idSchema.extend({ roles: z.array(z.enum(CONTACT_ROLES)), tags: z.array(z.string().trim().min(1).max(60, "Cada etiqueta: máximo 60 caracteres")).max(20, "Máximo 20 etiquetas") }),
    { contactId: str(fd, "contactId"), roles: fd.getAll("roles"), tags: splitTags(str(fd, "tags")) },
    async (d, actor) => {
      await setContactRoles(getDb(), actor, d.contactId, d.roles);
      await setContactTags(getDb(), actor, d.contactId, d.tags);
    },
  );
  if (r.ok) refresh();
  return r;
}

export async function dismissDuplicateAction(input: { candidateId: string }) {
  const r = await runAction("contacts.dismiss_duplicate", z.object({ candidateId: z.uuid() }), input, (d, actor) => dismissDuplicateCandidate(getDb(), actor, d.candidateId));
  if (!r.ok) return r;
  redirect("/crm/contactos/duplicados");
}

export async function mergeDuplicateAction(input: { candidateId: string; keepId: string }) {
  const r = await runAction("contacts.merge_duplicate", z.object({ candidateId: z.uuid(), keepId: z.uuid() }), input, (d, actor) => mergeDuplicateCandidate(getDb(), actor, d.candidateId, d.keepId));
  if (!r.ok) return r;
  redirect(`/crm/contactos/${r.data.keepId}`);
}
