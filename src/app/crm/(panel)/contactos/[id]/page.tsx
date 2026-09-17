import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { getContactDetail, getContactTimeline } from "@/server/contacts/queries";
import { Alert, Badge, ButtonLink, Card, PageHeader, formatDate, formatDateTime } from "@/components/ui";
import { CONTACT_ROLE_LABEL, DOCUMENT_TYPE_LABEL } from "@/components/crm/labels";
import { ContactButtons } from "@/components/crm/contact-actions";
import { telHref, waHref } from "@/components/crm/phone-links";
import { NotesSection } from "@/components/crm/notes-section";
import { logOutreachAction } from "../../_shared/actions";
import { orNotFound, requireUuid } from "../../_shared/load";
import { AddEmailButton, AddPhoneButton, RemoveEmailButton, RemovePhoneButton, RolesTagsButton } from "./contact-editors";

export const metadata: Metadata = { title: "Contacto" };

const KIND_LABEL: Record<string, string> = { activity: "Actividad", lead: "Lead", opportunity: "Oportunidad", appointment: "Agenda", property: "Propiedad" };

export default async function ContactPage({ params }: PageProps<"/crm/contactos/[id]">) {
  const actor = await requireStaffPage("contacts.read");
  const id = requireUuid((await params).id);
  const db = getDb();
  const detail = await orNotFound(getContactDetail(db, actor, id));
  if (detail.mergedInto !== null) redirect(`/crm/contactos/${detail.mergedInto}`);
  const timeline = await getContactTimeline(db, actor, id);
  const { contact: c, emails, phones, roles, tags, notes, assigned, openDuplicates } = detail;
  const canUpdate = can(actor, "contacts.update");
  const primaryPhone = phones[0];
  return (
    <>
      <nav aria-label="Migas" className="mb-2 text-sm">
        <Link href="/crm/contactos" className="text-stone underline-offset-4 hover:underline">
          ← Contactos
        </Link>
      </nav>
      <PageHeader
        title={c.displayName}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {c.kind === "company" ? <Badge tone="info">Empresa</Badge> : null}
            {roles.map((r) => (
              <Badge key={r}>{CONTACT_ROLE_LABEL[r] ?? r}</Badge>
            ))}
            <span>{assigned ? `Responsable: ${assigned.full_name}` : "Sin responsable"}</span>
          </span>
        }
        actions={canUpdate ? <ButtonLink href={`/crm/contactos/${c.id}/editar`} variant="secondary">Editar</ButtonLink> : null}
      />

      {openDuplicates.length > 0 ? (
        <div className="mb-4">
          <Alert tone="warning">
            Este contacto tiene {openDuplicates.length} posible{openDuplicates.length > 1 ? "s" : ""} duplicado{openDuplicates.length > 1 ? "s" : ""} para revisar.{" "}
            {can(actor, "contacts.merge") ? (
              <Link href={`/crm/contactos/duplicados/${openDuplicates[0]!.id}`} className="font-semibold underline">
                Revisar
              </Link>
            ) : (
              "Avisá a administración."
            )}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <Card title="Acciones rápidas" className="lg:hidden">
            <QuickActions contactId={c.id} primaryPhone={primaryPhone} actorCan={(p) => can(actor, p)} />
          </Card>

          <Card title="Datos de contacto">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone">Teléfonos</h3>
                  {canUpdate ? <AddPhoneButton contactId={c.id} /> : null}
                </div>
                {phones.length === 0 ? <p className="text-sm text-stone">Sin teléfonos</p> : null}
                <ul className="flex flex-col gap-2">
                  {phones.map((p) => {
                    const wa = waHref(p);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          <a href={telHref(p)} className="font-semibold underline-offset-4 hover:underline">
                            {p.phone_e164 ?? p.phone_raw}
                          </a>
                          {p.label ? <span className="text-stone"> · {p.label}</span> : null}
                          {p.is_whatsapp ? <Badge tone="success" className="ml-1.5">WhatsApp</Badge> : null}
                          {p.is_primary ? <Badge className="ml-1.5">Principal</Badge> : null}
                        </span>
                        <span className="flex items-center gap-1">
                          {wa ? (
                            <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-paper-2">
                              Abrir WhatsApp
                            </a>
                          ) : null}
                          {canUpdate ? <RemovePhoneButton contactId={c.id} phoneId={p.id} /> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone">Emails</h3>
                  {canUpdate ? <AddEmailButton contactId={c.id} /> : null}
                </div>
                {emails.length === 0 ? <p className="text-sm text-stone">Sin emails</p> : null}
                <ul className="flex flex-col gap-2">
                  {emails.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 break-all">
                        <a href={`mailto:${e.email}`} className="font-semibold underline-offset-4 hover:underline">
                          {e.email}
                        </a>
                        {e.is_primary ? <Badge className="ml-1.5">Principal</Badge> : null}
                      </span>
                      {canUpdate ? <RemoveEmailButton contactId={c.id} emailId={e.id} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-stone">Origen</dt>
                <dd>{c.sourceName}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Alta</dt>
                <dd>{formatDate(c.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone">Documento</dt>
                <dd>{c.document ? (c.document.number ? `${DOCUMENT_TYPE_LABEL[c.document.type ?? ""] ?? ""} ${c.document.number}` : "—") : c.hasDocument ? "Cargado (sin permiso para verlo)" : "—"}</dd>
              </div>
            </dl>
          </Card>

          <NotesSection notes={notes} entityType="contact" entityId={c.id} canWrite={canUpdate} idempotencyKey={randomUUID()} />

          <Card title="Historial">
            {timeline.length === 0 ? (
              <p className="text-sm text-stone">Sin movimientos todavía.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {timeline.map((t) => (
                  <li key={t.key} className="border-l-2 border-line pl-3">
                    <p className="text-xs text-stone">
                      {KIND_LABEL[t.kind]} · {formatDateTime(t.at)}
                      {t.actor ? ` · ${t.actor}` : ""}
                    </p>
                    <p className="text-sm font-semibold text-ink">
                      {t.href ? (
                        <Link href={t.href} className="underline-offset-4 hover:underline">
                          {t.title}
                        </Link>
                      ) : (
                        t.title
                      )}
                    </p>
                    {t.detail ? <p className="break-words text-sm text-ink-2">{t.detail}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:order-2">
          <Card title="Acciones rápidas" className="hidden lg:block">
            <QuickActions contactId={c.id} primaryPhone={primaryPhone} actorCan={(p) => can(actor, p)} />
          </Card>
          <Card title="Roles y etiquetas" actions={canUpdate ? <RolesTagsButton contactId={c.id} roles={roles} tags={tags.map((t) => t.name)} /> : null}>
            <div className="flex flex-wrap gap-1.5">
              {roles.length === 0 && tags.length === 0 ? <p className="text-sm text-stone">Sin roles ni etiquetas</p> : null}
              {roles.map((r) => (
                <Badge key={r}>{CONTACT_ROLE_LABEL[r] ?? r}</Badge>
              ))}
              {tags.map((t) => (
                <Link key={t.id} href={`/crm/contactos?tag=${t.id}`}>
                  <Badge tone="info">{t.name}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function QuickActions({ contactId, primaryPhone, actorCan }: { contactId: string; primaryPhone: { phone_e164: string | null; phone_raw: string; is_whatsapp: boolean } | undefined; actorCan: (p: string) => boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <ContactButtons phone={primaryPhone} entityType="contact" entityId={contactId} log={logOutreachAction} size="md" />
      <div className="flex flex-wrap gap-2">
        {actorCan("agenda.manage") ? (
          <ButtonLink href={`/crm/agenda/nueva?contacto=${contactId}`} variant="secondary" size="sm">
            Agendar
          </ButtonLink>
        ) : null}
        {actorCan("opportunities.update") ? (
          <ButtonLink href={`/crm/pipeline/nueva?contacto=${contactId}`} variant="secondary" size="sm">
            Nueva oportunidad
          </ButtonLink>
        ) : null}
        {actorCan("tasks.manage") ? (
          <ButtonLink href={`/crm/tareas/nueva?entidad=contact&id=${contactId}`} variant="secondary" size="sm">
            Nueva tarea
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
