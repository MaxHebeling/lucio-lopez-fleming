import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { opportunityScope } from "@/server/crm/access";
import { CLOSED_VISIBLE_DAYS, getBoard } from "@/server/opportunities/queries";
import { listStaffUsers } from "@/server/crm/lookups";
import { ButtonLink, EmptyState, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { requireScope } from "../_shared/load";
import { Board } from "./board";
import { moveStageAction } from "./actions";
import { ListLimitNotice } from "@/components/crm/list-limit-notice";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: PageProps<"/crm/pipeline">) {
  const actor = await requireStaffPage();
  // Alcance resuelto en el servidor (propio o de todos); sin permiso se vuelve al tablero.
  requireScope(opportunityScope, actor);
  const sp = flatParams(await searchParams);
  const db = getDb();
  const board = await getBoard(db, actor, { pipelineKey: sp.pipeline, agent: sp.agente });
  const users = board.scopeAll ? await listStaffUsers(db, actor) : [];
  const total = board.cards.length;
  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`${total} ${total === 1 ? "oportunidad" : "oportunidades"}${board.scopeAll ? "" : " a tu cargo"} · las cerradas se ven ${CLOSED_VISIBLE_DAYS} días`}
        actions={can(actor, "opportunities.update") ? <ButtonLink href="/crm/pipeline/nueva">Nueva oportunidad</ButtonLink> : null}
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Pipelines" className="flex flex-wrap gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1">
          {board.pipelines.map((p) => (
            <Link
              key={p.key}
              href={`/crm/pipeline?pipeline=${p.key}${sp.agente ? `&agente=${sp.agente}` : ""}`}
              aria-current={board.pipeline?.key === p.key ? "page" : undefined}
              className={cx("rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold", board.pipeline?.key === p.key ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}
            >
              {p.name}
            </Link>
          ))}
        </nav>
        {board.scopeAll ? (
          <form method="get" className="flex items-end gap-2" aria-label="Filtrar por agente">
            <input type="hidden" name="pipeline" value={board.pipeline?.key ?? ""} />
            <div className="flex flex-col gap-1">
              <label htmlFor="agente" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                Agente
              </label>
              <Select id="agente" name="agente" defaultValue={sp.agente ?? ""} className="w-56">
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
      {!board.pipeline ? (
        <EmptyState title="No hay pipelines configurados" />
      ) : (
        <>
          {total === 0 ? (
            <div className="mb-4">
              <EmptyState title="No hay oportunidades en este pipeline" description="Convertí un lead o creá una oportunidad desde un contacto." />
            </div>
          ) : null}
          <ListLimitNotice total={board.totalCount} shown={total} limit={500} noun="oportunidades" />
          <Board
            key={`${board.pipeline.key}-${sp.agente ?? ""}`}
            stages={board.pipeline.stages}
            cards={board.cards.map((c) => ({ ...c, stageEnteredAt: c.stageEnteredAt.toISOString() }))}
            canMove={can(actor, "opportunities.update")}
            move={moveStageAction}
          />
        </>
      )}
    </>
  );
}
