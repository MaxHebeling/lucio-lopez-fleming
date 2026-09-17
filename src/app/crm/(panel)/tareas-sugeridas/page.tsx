import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { isEnabled } from "@/server/flags";
import { listSuggestions, TASK_CENTER_FLAG } from "@/server/ai/task-center/service";
import { PARAM_FOR_SOURCE, PRIORITY_LABEL, SOURCE_LABEL, SUGGESTION_SOURCES } from "@/server/ai/task-center/rules";
import { saltaToday } from "@/server/ai/management-settings";
import { Alert, Badge, EmptyState, PageHeader, cx, formatDateTime } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { flatParams } from "@/components/crm/pagination";
import { SuggestionDecisions } from "@/components/crm/management/suggestion-decisions";
import { refreshSuggestionsAction } from "../_management/actions";

export const metadata: Metadata = { title: "Tareas sugeridas" };

const PRIORITY_TONE = { high: "danger", medium: "warning", low: "neutral" } as const;
const PRIORITY_PARAM = { alta: "high", media: "medium", baja: "low" } as const;

export default async function SuggestedTasksPage({ searchParams }: PageProps<"/crm/tareas-sugeridas">) {
  const actor = await requireStaffPage();
  if (!can(actor, "tasks.manage") && !can(actor, "tasks.read_all")) redirect("/crm?sin-permiso=1");
  const db = getDb();
  if (!(await isEnabled(db, TASK_CENTER_FLAG))) notFound();
  const sp = flatParams(await searchParams);
  const now = new Date();
  const data = await listSuggestions(db, actor, sp, now);
  const f = data.filters;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { vista: data.team ? "equipo" : undefined, estado: f.estado, origen: f.origen, prioridad: f.prioridad, regla: f.regla, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/crm/tareas-sugeridas?${s}` : "/crm/tareas-sugeridas";
  };
  const returnQuery = new URLSearchParams(Object.entries({ vista: data.team ? "equipo" : undefined, origen: f.origen, prioridad: f.prioridad }).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const tab = "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold";
  const chip = (active: boolean) => cx("shrink-0 rounded-full border px-3 py-1 text-sm", active ? "border-ink bg-ink text-paper" : "border-line bg-white text-ink-2 hover:border-ink");

  return (
    <>
      <PageHeader
        title="Tareas sugeridas"
        description="Lo que conviene hacer, con prioridad, motivo y origen. Son sugerencias con reglas explicables: aceptar crea la tarea real; descartar y posponer quedan registrados. Nada se envía a clientes."
        actions={
          data.canDecide ? (
            <ActionButton action={refreshSuggestionsAction} variant="secondary" pendingLabel="Actualizando…">
              Actualizar sugerencias
            </ActionButton>
          ) : null
        }
      />

      {sp.tarea === "aceptada" ? (
        <div className="mb-4">
          <Alert tone="success">
            Listo: la tarea quedó creada (si ya existía, se usó la misma). La ves en{" "}
            <Link href={data.team ? "/crm/tareas?view=team&status=open" : "/crm/tareas?status=open"} className="font-semibold underline underline-offset-4">
              Tareas
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {data.canTeam ? (
            <nav aria-label="Vista" className="flex gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1">
              <Link href={qs({ vista: undefined })} aria-current={!data.team ? "page" : undefined} className={cx(tab, !data.team ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
                Mías
              </Link>
              <Link href={qs({ vista: "equipo" })} aria-current={data.team ? "page" : undefined} className={cx(tab, data.team ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
                Equipo
              </Link>
            </nav>
          ) : null}
          <nav aria-label="Estado" className="flex gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1">
            <Link href={qs({ estado: undefined })} aria-current={f.estado !== "pospuestas" ? "page" : undefined} className={cx(tab, f.estado !== "pospuestas" ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
              Pendientes
            </Link>
            <Link href={qs({ estado: "pospuestas" })} aria-current={f.estado === "pospuestas" ? "page" : undefined} className={cx(tab, f.estado === "pospuestas" ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
              Pospuestas
            </Link>
          </nav>
        </div>
        <nav aria-label="Origen" className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link href={qs({ origen: undefined, regla: undefined })} aria-current={!f.origen ? "page" : undefined} className={chip(!f.origen)}>
            Todos los orígenes
          </Link>
          {SUGGESTION_SOURCES.map((s) => (
            <Link key={s} href={qs({ origen: PARAM_FOR_SOURCE[s], regla: undefined })} aria-current={f.origen === PARAM_FOR_SOURCE[s] ? "page" : undefined} className={chip(f.origen === PARAM_FOR_SOURCE[s])}>
              {SOURCE_LABEL[s]}
            </Link>
          ))}
        </nav>
        <nav aria-label="Prioridad" className="flex flex-wrap gap-1">
          {(Object.keys(PRIORITY_PARAM) as Array<keyof typeof PRIORITY_PARAM>).map((p) => (
            <Link key={p} href={qs({ prioridad: f.prioridad === p ? undefined : p })} aria-current={f.prioridad === p ? "page" : undefined} className={chip(f.prioridad === p)}>
              Prioridad {PRIORITY_LABEL[PRIORITY_PARAM[p]].toLowerCase()}
            </Link>
          ))}
          {f.regla ? (
            <Link href={qs({ regla: undefined })} className={chip(true)}>
              Regla: {f.regla} · quitar
            </Link>
          ) : null}
        </nav>
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title={f.estado === "pospuestas" ? "No hay sugerencias pospuestas" : "No hay tareas sugeridas pendientes"}
          description={f.origen || f.prioridad || f.regla ? "Probá sin filtros." : "Cuando haya consultas sin responder, visitas sin cerrar, alertas o fichas para mejorar, van a aparecer acá."}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white" aria-label="Tareas sugeridas">
          {data.items.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-ink">{s.title}</p>
                <Badge tone={PRIORITY_TONE[s.priority]}>Prioridad {PRIORITY_LABEL[s.priority].toLowerCase()}</Badge>
                <Badge>{s.sourceLabel}</Badge>
                {s.status === "snoozed" && s.snoozedUntil ? <Badge tone="info">Pospuesta hasta {formatDateTime(s.snoozedUntil)}</Badge> : null}
              </div>
              <p className="text-sm text-ink-2">{s.reason}</p>
              <p className="text-xs text-stone">
                {s.link ? (
                  <Link href={s.link} className="font-semibold text-ink-2 underline underline-offset-2">
                    {s.entityLabel ?? "Abrir"}
                  </Link>
                ) : (
                  s.entityLabel
                )}
                {data.team ? ` · ${s.assignedName ?? "Sin responsable"}` : ""} · sugerida {formatDateTime(s.createdAt)}
              </p>
              {s.evidence.length ? (
                <details className="text-xs text-stone">
                  <summary className="cursor-pointer select-none">Por qué</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {s.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {data.canDecide ? <SuggestionDecisions id={s.id} title={s.title} minDate={saltaToday(now, 1)} maxDate={saltaToday(now, 90)} defaultDate={saltaToday(now, 3)} returnQuery={returnQuery} /> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
