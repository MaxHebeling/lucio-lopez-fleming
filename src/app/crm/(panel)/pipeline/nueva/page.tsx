import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listPipelines, listStaffUsers } from "@/server/crm/lookups";
import { Card, PageHeader } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { UUID_RE } from "../../_shared/load";
import { NewOpportunityForm } from "../opportunity-forms";

export const metadata: Metadata = { title: "Nueva oportunidad" };

export default async function NewOpportunityPage({ searchParams }: PageProps<"/crm/pipeline/nueva">) {
  const actor = await requireStaffPage("opportunities.update");
  const sp = flatParams(await searchParams);
  const db = getDb();
  let initialContact = null;
  if (sp.contacto && UUID_RE.test(sp.contacto) && can(actor, "contacts.read")) {
    const c = await db.selectFrom("contacts").select(["id", "display_name"]).where("id", "=", sp.contacto).where("deleted_at", "is", null).executeTakeFirst();
    if (c) initialContact = { id: c.id, label: c.display_name };
  }
  const canAssign = can(actor, "opportunities.assign");
  const [pipelines, users] = await Promise.all([listPipelines(db, actor), canAssign ? listStaffUsers(db, actor) : Promise.resolve([])]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nueva oportunidad" description="Para convertir un lead, usá “Convertir en oportunidad” desde su ficha." />
      <Card>
        <NewOpportunityForm
          idempotencyKey={randomUUID()}
          pipelines={pipelines.map((p) => ({ key: p.key, name: p.name }))}
          initialContact={initialContact}
          users={users}
          canAssign={canAssign}
          canSearchProperties={can(actor, "properties.read")}
        />
      </Card>
    </div>
  );
}
