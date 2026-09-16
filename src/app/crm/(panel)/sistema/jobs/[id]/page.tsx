import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getJob } from "@/server/system/jobs";
import { Badge, Card, formatDateTime, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { JsonView } from "@/components/crm/json-view";
import { JOB_STATUS } from "@/components/crm/labels";
import { retryJobAction } from "../actions";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: PageProps<"/crm/sistema/jobs/[id]">) {
  const actor = await requireStaffPage("automations.read");
  const { id } = await params;
  const job = await getJob(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const rows: Array<[string, string]> = [
    ["Intentos", `${job.attempts} de ${job.max_attempts}`],
    ["Prioridad", String(job.priority)],
    ["Timeout", `${Math.round(job.timeout_ms / 1000)} s`],
    ["Próxima ejecución", formatDateTime(job.run_at)],
    ["Creado", formatDateTime(job.created_at)],
    ["Iniciado", formatDateTime(job.started_at)],
    ["Finalizado", formatDateTime(job.finished_at)],
    ["Clave de dedupe", job.dedupe_key ?? "—"],
    ["Worker", job.locked_by ?? "—"],
  ];
  return (
    <>
      <nav aria-label="Migas de pan" className="mb-2 text-sm text-stone">
        <Link href={`/crm/sistema/jobs?status=${job.status}`} className="underline-offset-4 hover:underline">
          Jobs
        </Link>{" "}
        / {job.id.slice(0, 8)}
      </nav>
      <PageHeader
        title={job.type}
        description={<Badge tone={JOB_STATUS[job.status]?.tone}>{JOB_STATUS[job.status]?.label ?? job.status}</Badge>}
        actions={can(actor, "automations.manage") && (job.status === "dead" || job.status === "failed") ? <ActionButton action={retryJobAction.bind(null, job.id)} variant="primary" size="md" pendingLabel="Reintentando…">Reintentar ahora</ActionButton> : null}
      />
      <div className="flex flex-col gap-5">
        <Card title="Detalle">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-stone">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {job.last_error ? (
          <Card title="Último error">
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[#fbeeed] p-3 text-xs text-danger">{job.last_error}</pre>
          </Card>
        ) : null}
        <Card title="Payload">
          <JsonView value={job.payload} />
        </Card>
        <Card title="Resultado">
          <JsonView value={job.result} />
        </Card>
      </div>
    </>
  );
}
