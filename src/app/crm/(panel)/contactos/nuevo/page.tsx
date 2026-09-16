import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listStaffUsers } from "@/server/crm/lookups";
import { Card, PageHeader } from "@/components/ui";
import { ContactForm } from "../contact-form";
import { createContactAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo contacto" };

export default async function NewContactPage() {
  const actor = await requireStaffPage("contacts.create");
  const users = await listStaffUsers(getDb(), actor);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nuevo contacto" description="Si el email o teléfono ya existe en otro contacto, queda marcado para revisar duplicados." />
      <Card>
        <ContactForm mode="create" action={createContactAction} users={users} canPrivate={can(actor, "contacts.read_private")} idempotencyKey={randomUUID()} />
      </Card>
    </div>
  );
}
