import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { getOpportunityDetail } from "@/server/opportunities/queries";
import { listStaffUsers } from "@/server/crm/lookups";
import { Badge, ButtonLink, Card, PageHeader, formatDate, formatDateTime, formatMoney } from "@/components/ui";
import { ContactButtons } from "@/components/crm/contact-actions";
import { NotesSection } from "@/components/crm/notes-section";
import { APPOINTMENT_KIND_LABEL, APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE, OPERATION_LABEL, OPP_STATUS_LABEL, OPP_STATUS_TONE } from "@/components/crm/labels";
import { logOutreachAction } from "../../_shared/actions";
import { orNotFound, requireUuid } from "../../_shared/load";
import { AssignOpportunityForm, CloseButtons, EditOpportunityButton, MoveStageForm } from "../opportunity-forms";

export const metadata: Metadata = { title: "Oportunidad" };

export default async function OpportunityPage({ params }: PageProps<"/crm/pipeline/[id]">) {
  const actor = await requireStaffPage();
  const id = requireUuid((await params).id);
  const db = getDb();
  const d = await orNotFound(getOpportunityDetail(db, actor, id));
  const { opp, pipeline } = d;
  const stage = pipeline.stages.find((s) => s.id === opp.stage_id);
  const canUpdate = can(actor, "opportunities.update");
  const canAssign = can(actor, "opportunities.assign");
  const users = canAssign ? await listStaffUsers(db, actor) : [];
  const req = (opp.requirements ?? {}) as { text?: string; zones?: string; bedroomsMin?: number | null };
  const cur = opp.budget_currency ?? "USD";
  const budget = opp.budget_min || opp.budget_max ? [opp.budget_min ? formatMoney(opp.budget_min, cur) : null, opp.budget_max ? formatMoney(opp.budget_max, cur) : null].filter(Boolean).join(" – ") : "—";
  return (
    <>
      <nav aria-label="Migas" className="mb-2 text-sm">
        <Link href={`/crm/pipeline?pipeline=${pipeline.key}`} className="text-stone underline-offset-4 hover:underline">
          ← {pipeline.name}
        </Link>
      </nav>
      <PageHeader
        title={opp.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={OPP_STATUS_TONE[opp.status]}>{OPP_STATUS_LABEL[opp.status]}</Badge>
            <Badge>{stage?.name ?? "—"}</Badge>
            <span>
              {pipeline.name} · en esta etapa desde {formatDate(opp.stage_entered_at)}
            </span>
          </span>
        }
        actions={
          canUpdate ? (
            <EditOpportunityButton
              opp={{ id: opp.id, title: opp.title, operation: opp.operation, budgetMin: opp.budget_min, budgetMax: opp.budget_max, budgetCurrency: opp.budget_currency, expectedCloseDate: opp.expected_close_date, requirements: req }}
              property={d.property ? { id: d.property.id, label: `${d.property.code} · ${d.property.title}` } : null}
              canSearchProperties={can(actor, "properties.read")}
            />
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Contacto">
            <p className="mb-3 font-semibold">
              <Link href={`/crm/contactos/${d.contact.id}`} className="underline-offset-4 hover:underline">
                {d.contact.display_name}
              </Link>
            </p>
            <ContactButtons phone={d.phones[0]} entityType="contact" entityId={d.contact.id} log={logOutreachAction} size="md" />
            <div className="mt-3 flex flex-wrap gap-2">
              {can(actor, "agenda.manage") ? (
                <ButtonLink href={`/crm/agenda/nueva?oportunidad=${opp.id}&tipo=${opp.property_id ? "visit" : "call"}`} variant="secondary" size="sm">
                  Agendar {opp.property_id ? "visita" : "cita"}
                </ButtonLink>
              ) : null}
              {can(actor, "tasks.manage") ? (
                <ButtonLink href={`/crm/tareas/nueva?entidad=opportunity&id=${opp.id}`} variant="ghost" size="sm">
                  Nueva tarea
                </ButtonLink>
              ) : null}
              {d.lead ? (
                <ButtonLink href={`/crm/leads/${d.lead.id}`} variant="ghost" size="sm">
                  Ver lead de origen
                </ButtonLink>
              ) : null}
            </div>
          </Card>
          <Card title="Detalle">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-stone">Operación</dt>
                <dd>{opp.operation ? OPERATION_LABEL[opp.operation] : "—"}</dd>
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
                <dt className="text-xs text-stone">Presupuesto</dt>
                <dd>{budget}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Cierre estimado</dt>
                <dd>{formatDate(opp.expected_close_date)}</dd>
              </div>
              {opp.value_amount ? (
                <div>
                  <dt className="text-xs text-stone">Valor de cierre</dt>
                  <dd>{formatMoney(opp.value_amount, opp.value_currency ?? "USD")}</dd>
                </div>
              ) : null}
              {opp.lost_reason ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-stone">Motivo de pérdida</dt>
                  <dd>{opp.lost_reason}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-stone">Zonas</dt>
                <dd>{req.zones || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Dormitorios mínimos</dt>
                <dd>{req.bedroomsMin ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-stone">Qué busca</dt>
                <dd className="whitespace-pre-wrap break-words">{req.text || "—"}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Agenda">
            {d.appointments.length === 0 ? (
              <p className="text-sm text-stone">Sin citas vinculadas.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.appointments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/crm/agenda/${a.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {APPOINTMENT_KIND_LABEL[a.kind]} · {formatDateTime(a.starts_at)}
                    </Link>
                    <span className="flex items-center gap-2 text-stone">
                      {a.agent_name}
                      <Badge tone={APPOINTMENT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <NotesSection notes={d.notes} entityType="opportunity" entityId={opp.id} canWrite={canUpdate} idempotencyKey={randomUUID()} />
        </div>
        <div className="flex flex-col gap-4">
          {canUpdate ? (
            <Card title="Etapa">
              <div className="flex flex-col gap-4">
                <MoveStageForm opportunityId={opp.id} stageId={opp.stage_id} stages={pipeline.stages} />
                <CloseButtons opportunityId={opp.id} status={opp.status} currency={opp.budget_currency} />
              </div>
            </Card>
          ) : null}
          <Card title="Responsable">
            {canAssign ? <AssignOpportunityForm opportunityId={opp.id} assignedUserId={opp.assigned_user_id} users={users} /> : <p className="text-sm">{d.assigned?.full_name ?? "Sin asignar"}</p>}
          </Card>
          <Card title="Historial de etapas">
            <ol className="flex flex-col gap-3">
              {d.history.map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3 text-sm">
                  <span className="block font-semibold">{h.from_name ? `${h.from_name} → ${h.to_name}` : `Creada en ${h.to_name}`}</span>
                  {h.note ? <span className="block break-words text-ink-2">{h.note}</span> : null}
                  <span className="text-xs text-stone">
                    {formatDateTime(h.changed_at)}
                    {h.actor_name ? ` · ${h.actor_name}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
