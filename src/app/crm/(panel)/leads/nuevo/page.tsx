import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listStaffUsers } from "@/server/crm/lookups";
import { Card, PageHeader } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { UUID_RE } from "../../_shared/load";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = { title: "Nuevo lead" };

export default async function NewLeadPage({ searchParams }: PageProps<"/crm/leads/nuevo">) {
  const actor = await requireStaffPage("leads.create");
  const sp = flatParams(await searchParams);
  const db = getDb();
  const canProps = can(actor, "properties.read");
  let initialProperty = null;
  if (canProps && sp.propiedad && UUID_RE.test(sp.propiedad)) {
    const p = await db.selectFrom("properties").select(["id", "code", "title"]).where("id", "=", sp.propiedad).where("deleted_at", "is", null).executeTakeFirst();
    if (p) initialProperty = { id: p.id, label: `${p.code} · ${p.title}` };
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nuevo lead" description="Para consultas por teléfono u oficina. Si el teléfono o email ya existe, se usa el mismo contacto." />
      <Card>
        <LeadForm idempotencyKey={randomUUID()} users={await listStaffUsers(db, actor)} canAssign={can(actor, "leads.assign")} canSearchProperties={canProps} initialProperty={initialProperty} />
      </Card>
    </div>
  );
}
