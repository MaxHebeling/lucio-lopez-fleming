import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { userFormOptions } from "@/server/users/queries";
import { Alert, Card, PageHeader } from "@/components/ui";
import { InviteForm } from "../user-forms";

export const metadata: Metadata = { title: "Invitar usuario" };

export default async function InvitePage() {
  const actor = await requireStaffPage("users.manage");
  const options = await userFormOptions(getDb(), actor);
  return (
    <>
      <PageHeader title="Invitar usuario" description="La persona recibe por email un link (válido 72 horas) para definir su contraseña." />
      <div className="mb-4">
        <Alert tone="info">El email queda en la cola de envíos. Si el envío de emails todavía no está activo (integración de email / flag outbound_email), la invitación se enviará cuando se active.</Alert>
      </div>
      <Card>
        <InviteForm roles={options.roles} branches={options.branches} />
      </Card>
    </>
  );
}
