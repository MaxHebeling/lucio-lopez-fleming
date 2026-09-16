import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { auditFilterOptions, listAuditLogs } from "@/server/audit-log/queries";
import { buttonClass, EmptyState, Field, formatDateTime, Input, PageHeader, Select } from "@/components/ui";
import { JsonView } from "@/components/crm/json-view";
import { Pagination } from "@/components/crm/pagination";
import { first, pageParam } from "../_lib/params";

export const metadata: Metadata = { title: "Auditoría" };

const KEYS = ["entityType", "entityId", "actorId", "action", "from", "to"] as const;

const ENTITY_LINK: Record<string, (id: string) => string> = {
  property: (id) => `/crm/propiedades/${id}`,
  user: (id) => `/crm/usuarios/${id}`,
  job: (id) => `/crm/sistema/jobs/${id}`,
};

export default async function AuditPage({ searchParams }: PageProps<"/crm/auditoria">) {
  const actor = await requireStaffPage("audit.read");
  const sp = await searchParams;
  const params = Object.fromEntries(KEYS.map((k) => [k, first(sp, k)])) as Record<(typeof KEYS)[number], string | undefined>;
  const db = getDb();
  const [result, options] = await Promise.all([listAuditLogs(db, actor, { ...params, page: pageParam(sp) }), auditFilterOptions(db, actor)]);
  const filtered = KEYS.some((k) => params[k]);

  return (
    <>
      <PageHeader title="Auditoría" description="Registro inmutable de las operaciones sensibles: quién, cuándo y qué cambió." />
      <form method="get" className="mb-5 grid gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Filtrar auditoría">
        <Field label="Entidad" htmlFor="a-type">
          <Select id="a-type" name="entityType" defaultValue={params.entityType ?? ""}>
            <option value="">Todas</option>
            {options.entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Id de la entidad" htmlFor="a-id">
          <Input id="a-id" name="entityId" defaultValue={params.entityId} placeholder="uuid o clave" />
        </Field>
        <Field label="Usuario" htmlFor="a-actor">
          <Select id="a-actor" name="actorId" defaultValue={params.actorId ?? ""}>
            <option value="">Todos</option>
            {options.actors.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Acción" htmlFor="a-action">
          <Select id="a-action" name="action" defaultValue={params.action ?? ""}>
            <option value="">Todas</option>
            {options.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde" htmlFor="a-from">
          <Input id="a-from" name="from" type="date" defaultValue={params.from} />
        </Field>
        <Field label="Hasta" htmlFor="a-to">
          <Input id="a-to" name="to" type="date" defaultValue={params.to} />
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <button type="submit" className={buttonClass("primary", "sm")}>
            Aplicar
          </button>
          {filtered ? (
            <Link href="/crm/auditoria" className={buttonClass("ghost", "sm")}>
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>
      {result.total === 0 ? (
        <EmptyState title={filtered ? "Sin registros para esos filtros" : "Todavía no hay registros"} />
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {result.items.map((a) => {
              const link = a.entity_id && ENTITY_LINK[a.entity_type]?.(a.entity_id);
              return (
                <li key={a.id} className="rounded-[var(--radius-lg)] border border-line bg-white px-4 py-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="min-w-0">
                        <span className="font-mono text-xs font-semibold">{a.action}</span>
                        <span className="ml-2 text-ink-2">
                          {a.entity_type}
                          {a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}
                        </span>
                      </span>
                      <span className="text-xs text-stone">
                        {formatDateTime(a.occurred_at)} · {a.actor_name ?? (a.actor_kind === "system" ? "Sistema" : a.actor_kind === "anonymous" ? "Sin sesión" : a.actor_kind)}
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <JsonView label="Antes" value={a.before} />
                        <JsonView label="Después" value={a.after} />
                      </div>
                      {a.metadata && Object.keys(a.metadata as object).length ? <JsonView label="Metadatos" value={a.metadata} /> : null}
                      <p className="text-xs text-stone">
                        {link ? (
                          <Link href={link} className="mr-3 underline underline-offset-4">
                            Ir a la entidad
                          </Link>
                        ) : null}
                        {a.entity_id ? <span className="mr-3">Id: {a.entity_id}</span> : null}
                        {a.ip ? <span className="mr-3">IP: {a.ip}</span> : null}
                        {a.request_id ? <span>Request: {a.request_id}</span> : null}
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pathname="/crm/auditoria" params={params} label="registros" />
        </>
      )}
    </>
  );
}
