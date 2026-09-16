import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listAutomationRuns, listAutomations } from "@/server/system/automations";
import { Badge, buttonClass, Card, cx, EmptyState, formatDateTime, PageHeader, Table } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { JsonView } from "@/components/crm/json-view";
import { first } from "../_lib/params";
import { setAutomationEnabledAction } from "./actions";

export const metadata: Metadata = { title: "Automatizaciones" };

const RUN_STATUS: Record<string, { label: string; tone: "success" | "danger" | "neutral" | "info" }> = {
  succeeded: { label: "OK", tone: "success" },
  failed: { label: "Falló", tone: "danger" },
  skipped: { label: "Omitida", tone: "neutral" },
  running: { label: "En curso", tone: "info" },
};

export default async function AutomationsPage({ searchParams }: PageProps<"/crm/automatizaciones">) {
  const actor = await requireStaffPage("automations.read");
  const sp = await searchParams;
  const runStatus = first(sp, "runs") === "todas" ? undefined : "failed";
  const db = getDb();
  const [autos, runs] = await Promise.all([listAutomations(db, actor), listAutomationRuns(db, actor, { status: runStatus, limit: 50 })]);
  const manage = can(actor, "automations.manage");

  return (
    <>
      <PageHeader title="Automatizaciones" description="Reglas EVENTO → CONDICIONES → ACCIONES. Desactivar una regla no borra su historial." />
      <div className="flex flex-col gap-5">
        {autos.length === 0 ? (
          <EmptyState title="No hay automatizaciones definidas" />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {autos.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{a.name}</p>
                    <p className="font-mono text-xs text-stone">
                      {a.key} · v{a.version}
                    </p>
                  </div>
                  <Badge tone={a.is_enabled ? "success" : "neutral"}>{a.is_enabled ? "Activa" : "Desactivada"}</Badge>
                </div>
                {a.description ? <p className="text-sm text-ink-2">{a.description}</p> : null}
                <p className="text-xs text-stone">
                  Evento: <span className="font-mono">{a.trigger_event}</span> · Últimos 7 días: {a.runs_7d} ejecuciones
                  {a.failed_7d ? <span className="text-danger">, {a.failed_7d} con error</span> : null} · Última: {a.last_run_at ? formatDateTime(a.last_run_at) : "nunca"}
                </p>
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-ink-2">Ver condiciones y acciones</summary>
                  <div className="mt-2 grid gap-2">
                    <JsonView label="Condiciones" value={a.conditions} />
                    <JsonView label="Acciones" value={a.actions} />
                  </div>
                </details>
                {manage ? (
                  <div>
                    <ActionButton
                      action={setAutomationEnabledAction.bind(null, a.id, !a.is_enabled)}
                      variant={a.is_enabled ? "secondary" : "primary"}
                      confirm={a.is_enabled ? `¿Desactivar "${a.name}"? Los eventos nuevos no la dispararán.` : undefined}
                      pendingLabel="Guardando…"
                    >
                      {a.is_enabled ? "Desactivar" : "Activar"}
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Card
          title={runStatus ? "Ejecuciones con error" : "Últimas ejecuciones"}
          actions={
            <span className="flex gap-1">
              <Link href="/crm/automatizaciones" className={cx(buttonClass(runStatus ? "secondary" : "ghost", "sm"))} aria-current={runStatus ? "page" : undefined}>
                Con error
              </Link>
              <Link href="/crm/automatizaciones?runs=todas" className={cx(buttonClass(runStatus ? "ghost" : "secondary", "sm"))} aria-current={!runStatus ? "page" : undefined}>
                Todas
              </Link>
            </span>
          }
        >
          {runs.length === 0 ? (
            <p className="text-sm text-stone">{runStatus ? "No hay ejecuciones con error." : "Todavía no se ejecutó ninguna automatización."}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Automatización</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Error</th>
                  <th scope="col">Inicio</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="text-sm">{r.automation_name}</td>
                    <td className="font-mono text-xs">
                      {r.event_type}
                      <span className="block text-stone">
                        {r.aggregate_type} {r.aggregate_id.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                      {r.attempt > 1 ? <span className="block text-xs text-stone">intento {r.attempt}</span> : null}
                    </td>
                    <td className="max-w-md text-xs text-danger">{r.error ?? <span className="text-stone">—</span>}</td>
                    <td className="whitespace-nowrap text-xs text-stone">{formatDateTime(r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {runStatus && runs.length ? (
            <p className="mt-3 text-xs text-stone">
              Los reintentos se hacen desde{" "}
              <Link href="/crm/sistema/jobs?status=dead&type=automation.run" className="underline underline-offset-4">
                Jobs
              </Link>
              .
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
