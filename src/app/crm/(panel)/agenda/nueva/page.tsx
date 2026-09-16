import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { agendaScope } from "@/server/crm/access";
import { loadLead, loadOpportunity } from "@/server/crm/entities";
import { listStaffUsers } from "@/server/crm/lookups";
import { isLocalDate, localDate, utcToLocalInput } from "@/server/crm/time";
import { Card, PageHeader } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { UUID_RE } from "../../_shared/load";
import { NewAppointmentForm } from "../appointment-forms";

export const metadata: Metadata = { title: "Agendar" };

function nextSlot(): string {
  // Próxima media hora en hora de Salta.
  const d = new Date(Math.ceil((Date.now() + 15 * 60_000) / 1_800_000) * 1_800_000);
  return utcToLocalInput(d);
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
}

export default async function NewAppointmentPage({ searchParams }: PageProps<"/crm/agenda/nueva">) {
  const actor = await requireStaffPage("agenda.manage");
  const sp = flatParams(await searchParams);
  const db = getDb();
  const scope = agendaScope(actor);
  const uuid = (v: string | undefined) => (v && UUID_RE.test(v) ? v : null);

  // Precarga desde oportunidad / lead / contacto / propiedad, respetando alcance y permisos.
  const opp = uuid(sp.oportunidad) ? await safe(loadOpportunity(db, actor, sp.oportunidad!)) : null;
  const lead = !opp && uuid(sp.lead) ? await safe(loadLead(db, actor, sp.lead!)) : null;
  const contactId = uuid(sp.contacto) ?? opp?.contact_id ?? lead?.contact_id ?? null;
  const propertyId = uuid(sp.propiedad) ?? opp?.property_id ?? lead?.property_id ?? null;
  const contact = contactId && can(actor, "contacts.read") ? await db.selectFrom("contacts").select(["id", "display_name"]).where("id", "=", contactId).where("deleted_at", "is", null).executeTakeFirst() : undefined;
  const property = propertyId && can(actor, "properties.read") ? await db.selectFrom("properties").select(["id", "code", "title"]).where("id", "=", propertyId).where("deleted_at", "is", null).executeTakeFirst() : undefined;
  const kind = ["visit", "call", "meeting", "follow_up"].includes(sp.tipo ?? "") ? sp.tipo! : property ? "visit" : "call";
  const date = sp.fecha && isLocalDate(sp.fecha) && sp.fecha !== localDate(new Date()) ? `${sp.fecha}T10:00` : nextSlot();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Agendar" description="Visitas, llamadas, reuniones y seguimientos. Si el agente ya tiene una cita en ese horario, se avisa." />
      <Card>
        <NewAppointmentForm
          idempotencyKey={randomUUID()}
          defaultKind={kind}
          defaultStart={date}
          users={scope.all ? await listStaffUsers(db, actor) : []}
          canAssignOthers={scope.all}
          canSearchProperties={can(actor, "properties.read")}
          initialProperty={property ? { id: property.id, label: `${property.code} · ${property.title}` } : null}
          initialContact={contact ? { id: contact.id, label: contact.display_name } : null}
          opportunity={opp ? { id: opp.id, label: `Oportunidad: ${opp.title}` } : null}
          lead={lead ? { id: lead.id, label: `Lead de ${contact?.display_name ?? "contacto"}` } : null}
        />
      </Card>
    </div>
  );
}
