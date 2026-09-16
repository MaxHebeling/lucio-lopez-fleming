import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { getContactDetail } from "@/server/contacts/queries";
import { listStaffUsers } from "@/server/crm/lookups";
import { Card, PageHeader } from "@/components/ui";
import { ContactForm } from "../../contact-form";
import { updateContactAction } from "../../actions";
import { orNotFound, requireUuid } from "../../../_shared/load";

export const metadata: Metadata = { title: "Editar contacto" };

export default async function EditContactPage({ params }: PageProps<"/crm/contactos/[id]/editar">) {
  const actor = await requireStaffPage("contacts.update");
  const id = requireUuid((await params).id);
  const db = getDb();
  const detail = await orNotFound(getContactDetail(db, actor, id));
  if (detail.mergedInto !== null) redirect(`/crm/contactos/${detail.mergedInto}/editar`);
  const users = await listStaffUsers(db, actor);
  const c = detail.contact;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Editar · ${c.displayName}`} description="Emails, teléfonos, roles y etiquetas se editan desde la ficha." />
      <Card>
        <ContactForm
          mode="edit"
          action={updateContactAction}
          users={users}
          canPrivate={detail.canPrivate}
          initial={{ id: c.id, kind: c.kind, firstName: c.firstName, lastName: c.lastName, companyName: c.companyName, assignedUserId: c.assignedUserId, documentType: c.document?.type ?? null, documentNumber: c.document?.number ?? null }}
        />
      </Card>
    </div>
  );
}
