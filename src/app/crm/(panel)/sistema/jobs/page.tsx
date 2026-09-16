import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { jobCounts, jobTypes, listJobs, JOB_STATUSES } from "@/server/system/jobs";
import { Badge, buttonClass, cx, EmptyState, Field, formatDateTime, PageHeader, Select, Table } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { JOB_STATUS } from "@/components/crm/labels";
import { PaginationBar } from "@/components/crm/pagination";
import { first, pageParam } from "../../_lib/params";
import { retryJobAction } from "./actions";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: PageProps<"/crm/sistema/jobs">) {
  const actor = await requireStaffPage("automations.read");
  const sp = await searchParams;
  const statusParam = first(sp, "status");
  const status = (JOB_STATUSES as readonly string[]).includes(statusParam ?? "") ? statusParam! : "dead";
  const type = first(sp, "type");
  const db = getDb();
  const [counts, types, result] = await Promise.all([jobCounts(db, actor), jobTypes(db, actor), listJobs(db, actor, { status, type, page: pageParam(sp) })]);
  const canRetry = can(actor, "automations.manage") && (status === "dead" || status === "failed");

  return (
    <>
      <PageHeader title="Jobs" description="Cola de tareas en segundo plano: envíos, sincronizaciones y automatizaciones." />
      <nav aria-label="Estados" className="mb-4 flex flex-wrap gap-2">
        {JOB_STATUSES.map((s) => (
          <Link key={s} href={`/crm/sistema/jobs?status=${s}${type ? `&type=${encodeURIComponent(type)}` : ""}`} aria-current={s === status ? "page" : undefined} className={cx(buttonClass(s === status ? "primary" : "secondary", "sm"), "gap-2")}>
            {JOB_STATUS[s]?.label ?? s}
            <span className="tabular-nums opacity-80">{counts[s]}</span>
          </Link>
        ))}
      </nav>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="status" value={status} />
        <Field label="Tipo" htmlFor="j-type">
          <Select id="j-type" name="type" defaultValue={type ?? ""}>
            <option value="">Todos</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" className={buttonClass("secondary", "md")}>
          Filtrar
        </button>
      </form>
      {result.total === 0 ? (
        <EmptyState title={`No hay jobs ${JOB_STATUS[status]?.label.toLowerCase() ?? status}`} description={status === "dead" ? "Ninguna tarea agotó sus reintentos." : undefined} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Intentos</th>
                <th scope="col">Último error</th>
                <th scope="col">Actualizado</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/crm/sistema/jobs/${j.id}`} className="font-mono text-xs font-semibold underline-offset-4 hover:underline">
                      {j.type}
                    </Link>
                    <span className="mt-1 block">
                      <Badge tone={JOB_STATUS[j.status]?.tone}>{JOB_STATUS[j.status]?.label ?? j.status}</Badge>
                    </span>
                  </td>
                  <td className="tabular-nums">
                    {j.attempts}/{j.max_attempts}
                  </td>
                  <td className="max-w-md text-xs text-danger">{j.last_error ? <span className="line-clamp-3 break-words">{j.last_error}</span> : <span className="text-stone">—</span>}</td>
                  <td className="whitespace-nowrap text-xs text-stone">
                    {formatDateTime(j.updated_at)}
                    {j.status === "failed" || j.status === "queued" ? <span className="block">Próximo: {formatDateTime(j.run_at)}</span> : null}
                  </td>
                  <td>{canRetry ? <ActionButton action={retryJobAction.bind(null, j.id)} pendingLabel="…">Reintentar</ActionButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} pathname="/crm/sistema/jobs" params={{ status, type }} label="jobs" />
        </>
      )}
    </>
  );
}
