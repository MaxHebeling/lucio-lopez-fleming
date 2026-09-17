import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { getLeadDetail } from "@/server/leads/queries";
import { leadOwnerPhotos } from "@/server/site/owner-capture";
import { listPipelines, listStaffUsers } from "@/server/crm/lookups";
import { Alert, Badge, ButtonLink, Card, PageHeader, formatDateTime } from "@/components/ui";
import { ContactButtons } from "@/components/crm/contact-actions";
import { NotesSection } from "@/components/crm/notes-section";
import { INTEREST_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, OPP_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE } from "@/components/crm/labels";
import { logOutreachAction } from "../../_shared/actions";
import { orNotFound, requireUuid } from "../../_shared/load";
import { AssignForm, ConvertButton, FirstContactButton, PriorityForm, StatusForm } from "./lead-controls";
import { leadSalesPanels } from "@/server/sales/crm-panels";
import { NextActionsCard } from "@/components/crm/sales/sales-cards";
import { LeadQualificationCard } from "@/components/crm/sales/sales-panels";

export const metadata: Metadata = { title: "Lead" };

const PIPELINE_BY_INTEREST: Record<string, string> = { sale: "ventas", rent: "alquileres", temporary_rent: "alquileres", appraisal: "captacion", sell_my_property: "captacion" };

export default async function LeadPage({ params }: PageProps<"/crm/leads/[id]">) {
  const actor = await requireStaffPage();
  const id = requireUuid((await params).id);
  const db = getDb();
  // Fuera de alcance (lead ajeno sin leads.read_all) → 404.
  const d = await orNotFound(getLeadDetail(db, actor, id));
  const { lead } = d;
  const canUpdate = can(actor, "leads.update");
  const [users, pipelines, sales, ownerPhotos] = await Promise.all([can(actor, "leads.assign") ? listStaffUsers(db, actor) : Promise.resolve([]), listPipelines(db, actor), leadSalesPanels(db, actor, id), leadOwnerPhotos(db, lead.id)]);
  const utmEntries = Object.entries((lead.utm ?? {}) as Record<string, string>);
  return (
    <>
      <nav aria-label="Migas" className="mb-2 text-sm">
        <Link href="/crm/leads" className="text-stone underline-offset-4 hover:underline">
          ← Leads
        </Link>
      </nav>
      <PageHeader
        title={d.contact.display_name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status] ?? lead.status}</Badge>
            <Badge tone={PRIORITY_TONE[lead.priority]}>Prioridad {PRIORITY_LABEL[lead.priority]?.toLowerCase()}</Badge>
            <span>
              {d.source?.name ?? lead.source_key} · {formatDateTime(lead.created_at)}
            </span>
          </span>
        }
        actions={
          <ButtonLink href={`/crm/contactos/${d.contact.id}`} variant="secondary">
            Ver contacto
          </ButtonLink>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Contactar">
            <div className="flex flex-col gap-3">
              <ContactButtons phone={d.phones[0]} entityType="lead" entityId={lead.id} log={logOutreachAction} size="md" />
              {d.emails[0] ? (
                <a href={`mailto:${d.emails[0].email}`} className="break-all text-sm underline-offset-4 hover:underline">
                  {d.emails[0].email}
                </a>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {canUpdate && !lead.first_response_at ? <FirstContactButton leadId={lead.id} /> : null}
                {d.opportunity ? (
                  <ButtonLink href={`/crm/pipeline/${d.opportunity.id}`} variant="secondary">
                    Oportunidad ({OPP_STATUS_LABEL[d.opportunity.status]})
                  </ButtonLink>
                ) : canUpdate && can(actor, "opportunities.update") && lead.status !== "discarded" ? (
                  <ConvertButton leadId={lead.id} idempotencyKey={randomUUID()} defaultPipeline={PIPELINE_BY_INTEREST[lead.operation_interest ?? ""] ?? "ventas"} pipelines={pipelines} />
                ) : null}
                {can(actor, "agenda.manage") ? (
                  <ButtonLink href={`/crm/agenda/nueva?lead=${lead.id}${lead.property_id ? "&tipo=visit" : ""}`} variant="secondary">
                    Agendar
                  </ButtonLink>
                ) : null}
                {can(actor, "tasks.manage") ? (
                  <ButtonLink href={`/crm/tareas/nueva?entidad=lead&id=${lead.id}`} variant="ghost">
                    Nueva tarea
                  </ButtonLink>
                ) : null}
              </div>
              <p className="text-sm text-stone">
                {lead.first_response_at ? `Primer contacto: ${formatDateTime(lead.first_response_at)}` : "Todavía sin primer contacto registrado."}
              </p>
            </div>
          </Card>

          {lead.submitted_email || lead.submitted_phone ? (
            <Alert tone="warning">
              <p className="font-semibold">Datos de contacto enviados sin verificar</p>
              <p className="mt-1">
                Esta consulta llegó por un canal no verificado con datos que no están en la ficha de {d.contact.display_name}. Pueden ser de otra
                persona: confirmalos antes de usarlos o de agregarlos al contacto.
              </p>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {lead.submitted_email ? (
                  <div>
                    <dt className="text-xs">Email enviado</dt>
                    <dd className="break-all">{lead.submitted_email}</dd>
                  </div>
                ) : null}
                {lead.submitted_phone ? (
                  <div>
                    <dt className="text-xs">Teléfono enviado</dt>
                    <dd>{lead.submitted_phone}</dd>
                  </div>
                ) : null}
              </dl>
            </Alert>
          ) : null}

          {sales?.next ? <NextActionsCard items={sales.next.items} canAccept={sales.next.canAccept} canDecide={sales.next.canDecide} /> : null}
          {sales?.qualification ? <LeadQualificationCard summary={sales.qualification} contactHref={`/crm/contactos/${d.contact.id}`} /> : null}

          <Card title="Consulta">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-stone">Mensaje</dt>
                <dd className="whitespace-pre-wrap break-words">{lead.message || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Busca</dt>
                <dd>{lead.operation_interest ? INTEREST_LABEL[lead.operation_interest] : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Propiedad</dt>
                <dd>
                  {d.property ? (
                    <Link href={`/crm/propiedades/${d.property.id}`} className="underline-offset-4 hover:underline">
                      {d.property.code} · {d.property.title}
                    </Link>
                  ) : lead.property_id ? (
                    "Vinculada (sin permiso para verla)"
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Conversación</dt>
                <dd>
                  {d.conversation ? (
                    <Link href={`/crm/conversaciones/${d.conversation.id}`} className="underline-offset-4 hover:underline">
                      Ver conversación ({d.conversation.channel})
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone">UTM</dt>
                <dd className="break-all">{utmEntries.length ? utmEntries.map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</dd>
              </div>
            </dl>
          </Card>

          {ownerPhotos.length ? (
            <Card title="Fotos enviadas por el propietario">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ownerPhotos.map((ph, i) => (
                  <li key={ph.fileId}>
                    <a href={`/api/files/${ph.fileId}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[var(--radius-md)] border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element -- archivo privado servido con autorización (el optimizador no manda la sesión) */}
                      <img src={`/api/files/${ph.fileId}`} alt={`Foto ${i + 1} enviada por el propietario`} width={ph.width ?? undefined} height={ph.height ?? undefined} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <NotesSection notes={d.notes} entityType="lead" entityId={lead.id} canWrite={canUpdate} idempotencyKey={randomUUID()} />

          <Card title="Actividad">
            {d.activities.length === 0 ? (
              <p className="text-sm text-stone">Sin actividad registrada.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {d.activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-line pl-3 text-sm">
                    <span className="block">{a.summary}</span>
                    <span className="text-xs text-stone">
                      {formatDateTime(a.occurred_at)}
                      {a.actor_name ? ` · ${a.actor_name}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Gestión">
            <div className="flex flex-col gap-4">
              {canUpdate && lead.status !== "converted" ? <StatusForm leadId={lead.id} status={lead.status} /> : null}
              {canUpdate ? <PriorityForm leadId={lead.id} priority={lead.priority} /> : null}
              {can(actor, "leads.assign") ? (
                <AssignForm leadId={lead.id} assignedUserId={lead.assigned_user_id} users={users} />
              ) : (
                <p className="text-sm">
                  <span className="text-xs text-stone">Asignado a</span>
                  <span className="block">{d.assigned?.full_name ?? "Sin asignar"}</span>
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
