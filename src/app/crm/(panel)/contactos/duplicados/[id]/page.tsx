import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { getDuplicateComparison } from "@/server/contacts/queries";
import { Alert, Badge, Card, PageHeader, formatDate } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-form";
import { CONTACT_ROLE_LABEL, DOCUMENT_TYPE_LABEL, DUPLICATE_REASON_LABEL } from "@/components/crm/labels";
import { dismissDuplicateAction, mergeDuplicateAction } from "../../actions";
import { orNotFound, requireUuid } from "../../../_shared/load";

export const metadata: Metadata = { title: "Revisar duplicado" };

type Side = NonNullable<Awaited<ReturnType<typeof getDuplicateComparison>>["a"]>;

export default async function DuplicatePage({ params }: PageProps<"/crm/contactos/duplicados/[id]">) {
  const actor = await requireStaffPage("contacts.merge");
  const id = requireUuid((await params).id);
  const { candidate, a, b } = await orNotFound(getDuplicateComparison(getDb(), actor, id));
  const resolved = candidate.status !== "open";
  return (
    <>
      <nav aria-label="Migas" className="mb-2 text-sm">
        <Link href="/crm/contactos/duplicados" className="text-stone underline-offset-4 hover:underline">
          ← Duplicados
        </Link>
      </nav>
      <PageHeader title="Revisar posible duplicado" description={<Badge tone="warning">{DUPLICATE_REASON_LABEL[candidate.reason] ?? candidate.reason}</Badge>} />
      {resolved || !a || !b ? (
        <Alert tone="info">Este par ya fue revisado{candidate.status === "merged" ? " (fusionado)" : candidate.status === "dismissed" ? " (descartado)" : ""}.</Alert>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-2">
            Al fusionar, leads, oportunidades, citas, notas, emails y teléfonos del otro contacto pasan al que conservás. El otro queda marcado como fusionado (no se borra) y la operación queda auditada.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {[a, b].map((side, i) => {
              const other = i === 0 ? b : a;
              return (
                <Card key={side.contact.id} title={i === 0 ? "Contacto A" : "Contacto B"}>
                  <SideView side={side} />
                  <div className="mt-4 border-t border-line pt-4">
                    <ActionButton
                      action={mergeDuplicateAction}
                      input={{ candidateId: candidate.id, keepId: side.contact.id }}
                      variant="primary"
                      size="md"
                      pendingLabel="Fusionando…"
                      confirm={`¿Conservar “${side.contact.displayName}” y fusionar en él a “${other.contact.displayName}”? No se puede deshacer desde el CRM.`}
                    >
                      Conservar este y fusionar
                    </ActionButton>
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-4">
            <ActionButton action={dismissDuplicateAction} input={{ candidateId: candidate.id }} variant="secondary" size="md" pendingLabel="Descartando…">
              No son la misma persona
            </ActionButton>
          </div>
        </>
      )}
    </>
  );
}

function SideView({ side }: { side: Side }) {
  const c = side.contact;
  return (
    <dl className="grid gap-2 text-sm">
      <div>
        <dt className="text-xs text-stone">Nombre</dt>
        <dd className="font-semibold">
          <Link href={`/crm/contactos/${c.id}`} className="underline-offset-4 hover:underline">
            {c.displayName}
          </Link>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-stone">Teléfonos</dt>
        <dd>{side.phones.map((p) => p.phone_e164 ?? p.phone_raw).join(", ") || "—"}</dd>
      </div>
      <div>
        <dt className="text-xs text-stone">Emails</dt>
        <dd className="break-all">{side.emails.map((e) => e.email).join(", ") || "—"}</dd>
      </div>
      <div>
        <dt className="text-xs text-stone">Roles</dt>
        <dd>{side.roles.map((r) => CONTACT_ROLE_LABEL[r] ?? r).join(", ") || "—"}</dd>
      </div>
      <div>
        <dt className="text-xs text-stone">Documento</dt>
        <dd>{c.document ? (c.document.number ? `${DOCUMENT_TYPE_LABEL[c.document.type ?? ""] ?? ""} ${c.document.number}` : "—") : c.hasDocument ? "Cargado (sin permiso para verlo)" : "—"}</dd>
      </div>
      <div>
        <dt className="text-xs text-stone">Alta</dt>
        <dd>
          {formatDate(c.createdAt)} · origen {c.sourceName}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-stone">Vinculado</dt>
        <dd>
          {side.counts.leads} leads · {side.counts.opportunities} oportunidades · {side.counts.appointments} citas · {side.counts.owned} propiedades · {side.notes.length} notas
        </dd>
      </div>
    </dl>
  );
}
