import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { agendaScope } from "@/server/crm/access";
import { getAppointmentDetail } from "@/server/agenda/queries";
import { listStaffUsers } from "@/server/crm/lookups";
import { utcToLocalInput } from "@/server/crm/time";
import { Badge, Card, PageHeader, formatDateTime } from "@/components/ui";
import { ContactButtons } from "@/components/crm/contact-actions";
import { NotesSection } from "@/components/crm/notes-section";
import { APPOINTMENT_KIND_LABEL, APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from "@/components/crm/labels";
import { logOutreachAction } from "../../_shared/actions";
import { isPast, orNotFound, requireUuid } from "../../_shared/load";
import { AppointmentActions } from "../appointment-forms";

export const metadata: Metadata = { title: "Cita" };

export default async function AppointmentPage({ params }: PageProps<"/crm/agenda/[id]">) {
  const actor = await requireStaffPage();
  const id = requireUuid((await params).id);
  const db = getDb();
  const d = await orNotFound(getAppointmentDetail(db, actor, id));
  const a = d.appointment;
  const canManage = can(actor, "agenda.manage");
  const scopeAll = agendaScope(actor).all;
  const users = canManage && scopeAll ? await listStaffUsers(db, actor) : [];
  const localStart = utcToLocalInput(a.starts_at);
  return (
    <>
      <nav aria-label="Migas" className="mb-2 text-sm">
        <Link href={`/crm/agenda?fecha=${localStart.slice(0, 10)}`} className="text-stone underline-offset-4 hover:underline">
          ← Agenda
        </Link>
      </nav>
      <PageHeader
        title={a.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{APPOINTMENT_KIND_LABEL[a.kind]}</Badge>
            <Badge tone={APPOINTMENT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
            <span>
              {formatDateTime(a.starts_at)} – {utcToLocalInput(a.ends_at).slice(11)} · {d.agent.full_name}
            </span>
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {canManage ? (
            <Card title="Acciones">
              <AppointmentActions
                id={a.id}
                status={a.status}
                started={isPast(a.starts_at)}
                startLocal={localStart}
                durationMinutes={Math.round((a.ends_at.getTime() - a.starts_at.getTime()) / 60_000)}
                users={users}
                assignedUserId={a.assigned_user_id}
                canAssignOthers={scopeAll}
              />
            </Card>
          ) : null}
          <Card title="Detalle">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-stone">Contacto</dt>
                <dd>
                  {d.contact ? (
                    <Link href={`/crm/contactos/${d.contact.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {d.contact.display_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Propiedad</dt>
                <dd>
                  {d.property ? (
                    <Link href={`/crm/propiedades/${d.property.id}`} className="underline-offset-4 hover:underline">
                      {d.property.code} · {d.property.title}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Lugar</dt>
                <dd>{a.location ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Oportunidad</dt>
                <dd>
                  {d.opportunity ? (
                    <Link href={`/crm/pipeline/${d.opportunity.id}`} className="underline-offset-4 hover:underline">
                      {d.opportunity.title}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {a.notes ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-stone">Notas de la cita</dt>
                  <dd className="whitespace-pre-wrap break-words">{a.notes}</dd>
                </div>
              ) : null}
              {a.result ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-stone">Resultado</dt>
                  <dd className="whitespace-pre-wrap break-words">{a.result}</dd>
                </div>
              ) : null}
              {a.cancel_reason ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-stone">Motivo de cancelación</dt>
                  <dd>{a.cancel_reason}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <NotesSection notes={d.notes} entityType="appointment" entityId={a.id} canWrite={canManage} idempotencyKey={randomUUID()} />
        </div>
        <div className="order-first flex flex-col gap-4 lg:order-none">
          {d.contact ? (
            <Card title="Contactar">
              <ContactButtons phone={d.phones[0]} entityType="contact" entityId={d.contact.id} log={logOutreachAction} size="md" />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
