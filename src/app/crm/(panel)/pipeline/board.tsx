"use client";

/**
 * Tablero kanban. Tres formas de mover una oportunidad, todas contra el mismo servicio:
 * arrastrar y soltar (mouse), el menú "Mover a…" de cada tarjeta (teclado, lector de pantalla, celular).
 * Pasar a una etapa "perdida" pide el motivo antes de enviar.
 */
import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Alert, Button, Textarea, cx, formatMoney } from "@/components/ui";
import { Modal } from "@/components/crm/dialog-button";
import type { ClientActionResult } from "@/components/crm/action-form";

type Stage = { id: string; key: string; name: string; outcome: string };
export type Card = {
  id: string;
  title: string;
  status: string;
  stageId: string;
  contactName: string;
  propertyCode: number | null;
  budgetMin: string | null;
  budgetMax: string | null;
  budgetCurrency: string | null;
  assignedName: string | null;
  stageEnteredAt: string;
};
type MoveInput = { opportunityId: string; stageId: string; lostReason?: string };

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function budget(c: Card): string | null {
  if (!c.budgetMin && !c.budgetMax) return null;
  const cur = c.budgetCurrency ?? "USD";
  if (c.budgetMin && c.budgetMax) return `${formatMoney(c.budgetMin, cur)} – ${formatMoney(c.budgetMax, cur)}`;
  return c.budgetMax ? `Hasta ${formatMoney(c.budgetMax, cur)}` : `Desde ${formatMoney(c.budgetMin, cur)}`;
}

export function Board({ stages, cards, canMove, move }: { stages: Stage[]; cards: Card[]; canMove: boolean; move: (i: MoveInput) => Promise<ClientActionResult<unknown>> }) {
  const [optimistic, applyMove] = useOptimistic(cards, (state, m: { id: string; stageId: string }) => state.map((c) => (c.id === m.id ? { ...c, stageId: m.stageId } : c)));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pendingLost, setPendingLost] = useState<{ card: Card; stage: Stage } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [moving, startTransition] = useTransition();
  // Tarjeta movida con el menú "Mover a…": al cambiar de columna se vuelve a montar, así que el foco se lleva a su
  // control en la columna nueva (y se mantiene ahí si el servidor rechaza y vuelve a la original).
  const focusAfterMove = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    const el = document.getElementById(`mv-${id}`);
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (!moving) focusAfterMove.current = null;
  }, [optimistic, moving]);

  function request(card: Card, stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || card.stageId === stageId) return;
    if (stage.outcome === "lost") {
      setReason("");
      setReasonError(null);
      setPendingLost({ card, stage });
      return;
    }
    send(card, stage);
  }

  function cancelLost() {
    const id = pendingLost?.card.id;
    setPendingLost(null);
    focusAfterMove.current = null;
    // El <dialog> devuelve el foco al elemento previo; si era el menú de la tarjeta, sigue en su lugar.
    if (id) requestAnimationFrame(() => document.getElementById(`mv-${id}`)?.focus());
  }

  function send(card: Card, stage: Stage, lostReason?: string) {
    setError(null);
    startTransition(async () => {
      applyMove({ id: card.id, stageId: stage.id });
      const r = await move({ opportunityId: card.id, stageId: stage.id, lostReason });
      if (r.ok) setAnnounce(`“${card.title}” movida a ${stage.name}`);
      else setError(`No se pudo mover “${card.title}”: ${r.error}`);
    });
  }

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {error ? (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="relative -mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" role="region" aria-label="Tablero de oportunidades" tabIndex={0}>
        <div className="flex snap-x snap-mandatory gap-3 sm:snap-none">
          {stages.map((s) => {
            const list = optimistic.filter((c) => c.stageId === s.id);
            return (
              <section
                key={s.id}
                aria-label={`${s.name}: ${list.length}`}
                className={cx(
                  "flex w-[85vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-[var(--radius-lg)] border bg-paper-2/60 sm:w-72",
                  overStage === s.id ? "border-ink" : "border-line",
                )}
                onDragOver={(e) => {
                  if (!dragId || !canMove) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverStage(s.id);
                }}
                onDragLeave={() => setOverStage((o) => (o === s.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverStage(null);
                  const card = optimistic.find((c) => c.id === (dragId ?? e.dataTransfer.getData("text/plain")));
                  setDragId(null);
                  if (card) request(card, s.id);
                }}
              >
                <header className="flex items-center justify-between gap-2 px-3 py-2">
                  <h2 className="text-sm font-bold">{s.name}</h2>
                  <span className={cx("rounded-full px-2 text-xs font-semibold", s.outcome === "won" ? "bg-[#e3efe6] text-success" : s.outcome === "lost" ? "bg-[#f5dfdd] text-danger" : "bg-white text-ink-2")}>{list.length}</span>
                </header>
                <ul className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                  {list.map((c) => (
                    <li
                      key={c.id}
                      draggable={canMove}
                      onDragStart={(e) => {
                        setDragId(c.id);
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      className={cx("relative rounded-[var(--radius-md)] border border-line bg-white p-3 shadow-[var(--shadow-soft)]", canMove && "cursor-grab active:cursor-grabbing", dragId === c.id && "opacity-60")}
                    >
                      <Link href={`/crm/pipeline/${c.id}`} className="block font-semibold leading-snug text-ink underline-offset-4 hover:underline">
                        {c.title}
                      </Link>
                      {c.title.startsWith(c.contactName) ? null : (
                        <p className="mt-1 text-xs text-ink-2">
                          {c.contactName}
                          {c.propertyCode ? ` · Prop. ${c.propertyCode}` : ""}
                        </p>
                      )}
                      {budget(c) ? <p className="text-xs text-ink-2">{budget(c)}</p> : null}
                      <p className="mt-1 text-xs text-stone">
                        {c.assignedName ?? "Sin asignar"} · {daysSince(c.stageEnteredAt)} d en etapa
                      </p>
                      {canMove ? (
                        <form
                          className="mt-2 flex gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = new FormData(e.currentTarget).get("stageId");
                            if (typeof v !== "string" || v === c.stageId) return;
                            focusAfterMove.current = c.id;
                            request(c, v);
                          }}
                        >
                          <label className="sr-only" htmlFor={`mv-${c.id}`}>
                            Mover “{c.title}” a
                          </label>
                          <select id={`mv-${c.id}`} name="stageId" defaultValue={c.stageId} key={c.stageId} className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-white px-2 text-xs">
                            {stages.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.id === c.stageId ? `${st.name} (actual)` : st.name}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="sm" variant="secondary">
                            Mover
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {pendingLost ? (
        <Modal title={`Marcar como perdida: ${pendingLost.card.title}`} onClose={cancelLost}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3) {
                setReasonError("El motivo es obligatorio");
                return;
              }
              const p = pendingLost;
              setPendingLost(null);
              send(p.card, p.stage, reason.trim());
            }}
          >
            <label htmlFor="lost-reason" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              Motivo de la pérdida
            </label>
            <Textarea id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus aria-invalid={reasonError ? true : undefined} aria-describedby={reasonError ? "lost-reason-error" : undefined} />
            {reasonError ? (
              <p id="lost-reason-error" role="alert" className="text-xs text-danger">
                {reasonError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" variant="danger">
                Marcar perdida
              </Button>
              <Button variant="ghost" onClick={cancelLost}>
                Cancelar
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
