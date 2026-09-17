import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { leadScope } from "@/server/crm/access";
import { listLeads } from "@/server/leads/queries";
import { listLeadSources, listStaffUsers } from "@/server/crm/lookups";
import { Badge, ButtonLink, EmptyState, Input, PageHeader, Select, buttonClass, formatDateTime } from "@/components/ui";
import { INTEREST_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE } from "@/components/crm/labels";
import { Pagination, flatParams } from "@/components/crm/pagination";
import { requireScope } from "../_shared/load";
import { isEnabled } from "@/server/flags";
import { openProposalsForContacts } from "@/server/sales/nba/service";

export const metadata: Metadata = { title: "Leads" };

function waiting(from: Date): string {
  const min = Math.max(0, Math.round((Date.now() - from.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} días`;
}

export default async function LeadsPage({ searchParams }: PageProps<"/crm/leads">) {
  const actor = await requireStaffPage();
  // Alcance resuelto en el servidor (propio o de todos); sin permiso se vuelve al tablero.
  requireScope(leadScope, actor);
  const sp = flatParams(await searchParams);
  const db = getDb();
  const [result, sources, users, matchingOn] = await Promise.all([listLeads(db, actor, sp), listLeadSources(db, actor), listStaffUsers(db, actor), isEnabled(db, "ai_matching")]);
  // Sugerencia registrada al calificar cada consulta (solo contactos de las filas visibles, ya filtradas por alcance).
  const proposals = matchingOn ? await openProposalsForContacts(db, actor.organizationId, [...new Set(result.rows.map((r) => r.contact_id))]) : new Map();
  const f = result.filters;
  const hasFilters = Boolean(f.status || f.source || f.assigned || f.priority || f.unanswered || f.property || f.from || f.to || f.q);
  return (
    <>
      <PageHeader
        title="Leads"
        description={`${result.total} ${result.total === 1 ? "lead" : "leads"}${result.scopeAll ? "" : " asignados a vos"}${hasFilters ? " con estos filtros" : ""}`}
        actions={can(actor, "leads.create") ? <ButtonLink href="/crm/leads/nuevo">Nuevo lead</ButtonLink> : null}
      />
      <details className="mb-5 rounded-[var(--radius-lg)] border border-line bg-white" open={hasFilters}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Filtros{hasFilters ? " (activos)" : ""}</summary>
        <form method="get" role="search" aria-label="Filtrar leads" className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Filter label="Nombre" id="q">
            <Input id="q" name="q" type="search" defaultValue={f.q ?? ""} placeholder="Nombre del contacto" />
          </Filter>
          <Filter label="Estado" id="status">
            <Select id="status" name="status" defaultValue={f.status ?? ""}>
              <option value="">Todos</option>
              <option value="open">Abiertos (nuevo, contactado, calificado)</option>
              {Object.entries(LEAD_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Filter>
          <Filter label="Fuente" id="source">
            <Select id="source" name="source" defaultValue={f.source ?? ""}>
              <option value="">Todas</option>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Filter>
          <Filter label="Prioridad" id="priority">
            <Select id="priority" name="priority" defaultValue={f.priority ?? ""}>
              <option value="">Todas</option>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Filter>
          {result.scopeAll ? (
            <Filter label="Asignado" id="assigned">
              <Select id="assigned" name="assigned" defaultValue={f.assigned ?? ""}>
                <option value="">Cualquiera</option>
                <option value="me">A mí</option>
                <option value="none">Sin asignar</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </Filter>
          ) : null}
          <Filter label="Código de propiedad" id="property">
            <Input id="property" name="property" inputMode="numeric" pattern="[0-9]*" defaultValue={f.property ?? ""} placeholder="Ej. 3021" />
          </Filter>
          <Filter label="Desde" id="from">
            <Input id="from" name="from" type="date" defaultValue={f.from ?? ""} />
          </Filter>
          <Filter label="Hasta" id="to">
            <Input id="to" name="to" type="date" defaultValue={f.to ?? ""} />
          </Filter>
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-2">
            <input type="checkbox" name="unanswered" value="1" defaultChecked={Boolean(f.unanswered)} className="size-4 accent-[var(--ink)]" />
            Solo sin responder
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-2 lg:justify-end">
            <button type="submit" className={buttonClass("primary", "md")}>
              Aplicar
            </button>
            {hasFilters ? (
              <Link href="/crm/leads" className={buttonClass("ghost", "md")}>
                Limpiar
              </Link>
            ) : null}
          </div>
        </form>
      </details>

      {result.rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No hay leads con esos filtros" : "No hay leads"}
          description={result.scopeAll ? "Las consultas de la web, WhatsApp, portales y cargas manuales aparecen acá." : "Cuando te asignen un lead, aparece acá."}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
          {result.rows.map((l) => {
            const unanswered = !l.first_response_at && ["new", "contacted", "qualified"].includes(l.status);
            return (
              <li key={l.id}>
                <Link href={`/crm/leads/${l.id}`} className="grid gap-1 px-4 py-3 hover:bg-paper md:grid-cols-[2fr_1.5fr_1.5fr_1fr] md:items-center md:gap-4">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold text-ink">{l.contact_name}</span>
                      <Badge tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status] ?? l.status}</Badge>
                      {l.priority !== "normal" ? <Badge tone={PRIORITY_TONE[l.priority]}>{PRIORITY_LABEL[l.priority]}</Badge> : null}
                    </span>
                    {l.message ? <span className="mt-0.5 block truncate text-sm text-stone">{l.message}</span> : null}
                    {proposals.get(l.contact_id) ? (
                      <span className="mt-0.5 block truncate text-xs font-semibold text-ink-2">
                        Siguiente acción sugerida: {proposals.get(l.contact_id)!.title}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-ink-2">
                    {l.source_name}
                    {l.operation_interest ? ` · ${INTEREST_LABEL[l.operation_interest] ?? ""}` : ""}
                    {l.property_code ? <span className="block text-stone">Prop. {l.property_code}</span> : null}
                  </span>
                  <span className="text-sm text-stone">{l.assigned_name ?? "Sin asignar"}</span>
                  <span className="text-xs md:text-right">
                    <span className="block text-stone">{formatDateTime(l.created_at)}</span>
                    {unanswered ? <span className="font-semibold text-danger">Sin responder · {waiting(l.created_at)}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination basePath="/crm/leads" params={sp} page={result.page} pageSize={result.pageSize} total={result.total} />
    </>
  );
}

function Filter({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}
