import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { listMyNotifications } from "@/server/account/notifications";
import { buttonClass, cx, EmptyState, formatDateTime, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { Pagination } from "@/components/crm/pagination";
import { first, pageParam } from "../_lib/params";
import { markAllReadAction, markReadAction } from "./actions";

export const metadata: Metadata = { title: "Avisos" };

export default async function NotificationsPage({ searchParams }: PageProps<"/crm/notificaciones">) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const unreadOnly = first(sp, "ver") === "no-leidas";
  const result = await listMyNotifications(getDb(), actor, { unreadOnly, page: pageParam(sp) });
  return (
    <>
      <PageHeader
        title="Avisos"
        description={result.unread ? `${result.unread} sin leer` : "Estás al día."}
        actions={
          result.unread ? (
            <ActionButton action={markAllReadAction} pendingLabel="Marcando…">
              Marcar todas como leídas
            </ActionButton>
          ) : null
        }
      />
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Filtro de avisos">
        <Link href="/crm/notificaciones" className={buttonClass(unreadOnly ? "ghost" : "secondary", "sm")} aria-current={!unreadOnly ? "page" : undefined}>
          Todas
        </Link>
        <Link href="/crm/notificaciones?ver=no-leidas" className={buttonClass(unreadOnly ? "secondary" : "ghost", "sm")} aria-current={unreadOnly ? "page" : undefined}>
          Sin leer
        </Link>
      </div>
      {result.total === 0 ? (
        <EmptyState title={unreadOnly ? "No tenés avisos sin leer" : "Todavía no hay avisos"} description="Acá llegan los avisos de leads nuevos, tareas y alertas del sistema." />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {result.items.map((n) => (
              <li key={n.id} className={cx("flex flex-col gap-2 rounded-[var(--radius-lg)] border bg-white p-4 sm:flex-row sm:items-start sm:justify-between", n.read_at ? "border-line" : "border-ink")}>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-ink">
                    {!n.read_at ? <span className="size-2 shrink-0 rounded-full bg-brick" aria-label="Sin leer" /> : null}
                    {n.link ? (
                      <Link href={n.link} className="underline-offset-4 hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </p>
                  {n.body ? <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{n.body}</p> : null}
                  <p className="mt-1 text-xs text-stone">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read_at ? (
                  <ActionButton action={markReadAction.bind(null, n.id)} variant="ghost" pendingLabel="…">
                    Marcar leída
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pathname="/crm/notificaciones" params={{ ver: unreadOnly ? "no-leidas" : undefined }} label="avisos" />
        </>
      )}
    </>
  );
}
