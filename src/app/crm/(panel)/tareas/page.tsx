import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { taskScope } from "@/server/crm/access";
import { localDate } from "@/server/crm/time";
import { listTasks, taskEntityLink } from "@/server/tasks/service";
import { listStaffUsers } from "@/server/crm/lookups";
import { Badge, ButtonLink, EmptyState, PageHeader, Select, buttonClass, cx, formatDateTime } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-form";
import { PRIORITY_LABEL, PRIORITY_TONE, TASK_KIND_LABEL, TASK_STATUS_LABEL } from "@/components/crm/labels";
import { flatParams } from "@/components/crm/pagination";
import { isPast, requireScope } from "../_shared/load";
import { cancelTaskAction, completeTaskAction, reopenTaskAction } from "./actions";

export const metadata: Metadata = { title: "Tareas" };

const STATUS_TABS = [
  ["today", "Hoy y vencidas"],
  ["overdue", "Vencidas"],
  ["open", "Pendientes"],
  ["done", "Hechas"],
  ["cancelled", "Canceladas"],
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/crm/tareas">) {
  const actor = await requireStaffPage();
  // Alcance resuelto en el servidor (propio o de todos); sin permiso se vuelve al tablero.
  requireScope(taskScope, actor);
  const sp = flatParams(await searchParams);
  const db = getDb();
  const today = localDate(new Date());
  const data = await listTasks(db, actor, { ...sp, status: sp.status ?? "today" }, today);
  const users = data.scopeAll && data.view === "team" ? await listStaffUsers(db, actor) : [];
  const canManage = can(actor, "tasks.manage");
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: data.view, status: data.status, assignee: sp.assignee, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/crm/tareas?${p.toString()}`;
  };
  return (
    <>
      <PageHeader title="Tareas" description={data.view === "team" ? "Tareas del equipo" : "Tus tareas"} actions={canManage ? <ButtonLink href="/crm/tareas/nueva">Nueva tarea</ButtonLink> : null} />
      <div className="mb-4 flex flex-col gap-3">
        {data.scopeAll && canManage ? (
          <nav aria-label="Vista" className="flex gap-1 self-start rounded-[var(--radius-md)] border border-line bg-white p-1">
            {[
              ["mine", "Mías"],
              ["team", "Equipo"],
            ].map(([v, l]) => (
              <Link key={v} href={qs({ view: v, assignee: undefined })} aria-current={data.view === v ? "page" : undefined} className={cx("rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold", data.view === v ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
                {l}
              </Link>
            ))}
          </nav>
        ) : null}
        <nav aria-label="Estado" className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {STATUS_TABS.map(([v, l]) => (
            <Link key={v} href={qs({ status: v })} aria-current={data.status === v ? "page" : undefined} className={cx("shrink-0 rounded-full border px-3 py-1 text-sm", data.status === v ? "border-ink bg-ink text-paper" : "border-line bg-white text-ink-2 hover:border-ink")}>
              {l}
            </Link>
          ))}
        </nav>
        {data.view === "team" ? (
          <form method="get" className="flex items-end gap-2" aria-label="Filtrar por responsable">
            <input type="hidden" name="view" value="team" />
            <input type="hidden" name="status" value={data.status} />
            <div className="flex flex-col gap-1">
              <label htmlFor="assignee" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                Responsable
              </label>
              <Select id="assignee" name="assignee" defaultValue={sp.assignee ?? ""} className="w-56">
                <option value="">Todos</option>
                <option value="none">Sin asignar</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </div>
            <button type="submit" className={buttonClass("secondary", "md")}>
              Filtrar
            </button>
          </form>
        ) : null}
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="No hay tareas acá" description={data.status === "today" ? "No tenés tareas para hoy ni vencidas." : undefined} />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
          {data.rows.map((t) => {
            const overdue = t.status === "open" && isPast(t.due_at);
            const link = taskEntityLink(t.entity_type, t.entity_id);
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className={cx("font-semibold", t.status !== "open" && "text-stone line-through")}>{t.title}</span>
                    <Badge>{TASK_KIND_LABEL[t.kind] ?? t.kind}</Badge>
                    {t.priority !== "normal" ? <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge> : null}
                    {t.status !== "open" ? <Badge>{TASK_STATUS_LABEL[t.status]}</Badge> : null}
                  </p>
                  {t.description ? <p className="mt-0.5 break-words text-sm text-ink-2">{t.description}</p> : null}
                  <p className="mt-0.5 text-xs text-stone">
                    <span className={overdue ? "font-semibold text-danger" : undefined}>{t.due_at ? `${overdue ? "Venció" : "Vence"} ${formatDateTime(t.due_at)}` : "Sin vencimiento"}</span>
                    {link && t.entity_label ? (
                      <>
                        {" · "}
                        <Link href={link} className="underline underline-offset-2">
                          {t.entity_label}
                        </Link>
                      </>
                    ) : null}
                    {data.view === "team" ? ` · ${t.assigned_name ?? "Sin asignar"}` : ""}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {t.status === "open" ? (
                      <>
                        <ActionButton action={completeTaskAction} input={{ taskId: t.id }} variant="primary" pendingLabel="Guardando…">
                          Completar
                        </ActionButton>
                        <ActionButton action={cancelTaskAction} input={{ taskId: t.id }} variant="ghost" confirm="¿Cancelar esta tarea?" pendingLabel="Cancelando…">
                          Cancelar
                        </ActionButton>
                      </>
                    ) : (
                      <ActionButton action={reopenTaskAction} input={{ taskId: t.id }} variant="ghost" pendingLabel="Reabriendo…">
                        Reabrir
                      </ActionButton>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
