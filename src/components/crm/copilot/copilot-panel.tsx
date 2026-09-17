"use client";

/**
 * Panel del «✦ Asistente IA» (se carga bajo demanda desde CopilotLauncher). Drawer accesible con <dialog> nativo:
 * foco atrapado, Esc cierra, título y regiones con nombre. Dos modos: Asistente (guía del CRM) y Analista (datos).
 * No tiene prompts ni lógica de negocio: todo llega ya validado desde el servidor.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ActionResult } from "@/server/next/action";
import type { CopilotAnswer, CopilotMode, CopilotStatus } from "@/server/ai/copilot/types";
import { cx } from "@/components/ui/cx";
import { askCopilotAction, copilotFeedbackAction, copilotStatusAction } from "@/app/crm/(panel)/_copilot/actions";

type Exchange = { id: string; question: string; answer: CopilotAnswer | null; error: string | null };

const NETWORK_ERROR = "No pudimos completar la consulta. Revisá tu conexión y probá de nuevo.";

const EXAMPLES = ["¿Cómo agrego un tour 360°?", "¿Cómo publico una propiedad en el sitio?", "¿Cómo agendo una visita?"];

const GENERATED_BY: Record<CopilotAnswer["generatedBy"], string> = {
  ai: "Redactado por IA con datos verificados",
  guide: "Guía del CRM · sin IA",
  data: "Datos directos del CRM · sin IA",
};

/** Formato mínimo y seguro de la guía: **negrita** y `código` (sin HTML: todo se renderiza como texto). */
function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return (
    <p className={cx("whitespace-pre-line", className)}>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded bg-paper-2 px-1 text-[0.92em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </p>
  );
}

async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export default function CopilotPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const titleId = useId();
  const [mode, setMode] = useState<CopilotMode>("assistant");
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<CopilotMode, Exchange[]>>({ assistant: [], analyst: [] });
  const [conversations, setConversations] = useState<Partial<Record<CopilotMode, string>>>({});
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void call(() => copilotStatusAction({ path: pathname })).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setStatus(r.data);
        setStatusError(null);
      } else setStatusError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, pathname]);

  const ask = useCallback(
    async (input: { question?: string; quickQueryId?: string; label: string; mode?: CopilotMode }) => {
      const m = input.mode ?? mode;
      if (pending) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setThreads((t) => ({ ...t, [m]: [...t[m], { id, question: input.label, answer: null, error: null }] }));
      setPending(true);
      setAnnounce("Consultando…");
      const r = await call(() => askCopilotAction({ mode: m, question: input.question, quickQueryId: input.quickQueryId, path: pathname, conversationId: conversations[m] }));
      setPending(false);
      if (r.ok) {
        setConversations((c) => ({ ...c, [m]: r.data.conversationId }));
        setThreads((t) => ({ ...t, [m]: t[m].map((e) => (e.id === id ? { ...e, answer: r.data } : e)) }));
        setAnnounce("Respuesta lista.");
      } else {
        // Conversación vencida o de otra sesión: la próxima pregunta abre una nueva.
        if (/Conversación no encontrad/.test(r.error)) setConversations((c) => ({ ...c, [m]: undefined }));
        setThreads((t) => ({ ...t, [m]: t[m].map((e) => (e.id === id ? { ...e, error: r.error } : e)) }));
        setAnnounce(r.error);
      }
    },
    [conversations, mode, pathname, pending],
  );

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 2 || pending) return;
    setQuestion("");
    void ask({ question: q, label: q });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const switchMode = (m: CopilotMode) => {
    setMode(m);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const thread = threads[mode];
  const context = status?.screen?.entityLabel ?? status?.screen?.moduleLabel ?? null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-0 ml-auto h-svh max-h-none w-full max-w-none border-l border-line bg-paper p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/30 sm:w-[460px]"
    >
      <div className="flex h-full flex-col">
        <header className="border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="flex items-center gap-2 text-base font-bold">
                <span aria-hidden="true" className="text-brick">
                  ✦
                </span>
                Asistente IA
              </h2>
              <p className="mt-0.5 truncate text-xs text-stone">{context ? `Contexto: ${context}` : "Contexto: CRM"}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-semibold hover:bg-paper-2">
              Cerrar
            </button>
          </div>
          <div role="tablist" aria-label="Modo del asistente" className="mt-3 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-paper-2 p-1">
            {(
              [
                ["assistant", "Asistente", "¿Cómo hago…?"],
                ["analyst", "Analista", "¿Qué está pasando?"],
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`copilot-tab-${key}`}
                aria-selected={mode === key}
                aria-controls="copilot-tabpanel"
                onClick={() => switchMode(key)}
                className={cx("rounded-[6px] px-2 py-1.5 text-left text-sm", mode === key ? "bg-white font-semibold shadow-[var(--shadow-soft)]" : "text-ink-2 hover:text-ink")}
              >
                {label}
                <span className="block text-[11px] font-normal text-stone">{hint}</span>
              </button>
            ))}
          </div>
        </header>

        <div id="copilot-tabpanel" role="tabpanel" aria-labelledby={`copilot-tab-${mode}`} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={pending}>
            {statusError ? <p className="mb-3 rounded-[var(--radius-md)] border border-danger/30 bg-[#fbeeed] px-3 py-2 text-sm text-danger">{statusError}</p> : null}
            {status?.notice ? (
              <p role="status" className="mb-3 rounded-[var(--radius-md)] border border-warning/30 bg-[#fbf4e6] px-3 py-2 text-sm text-warning">
                {status.notice}
              </p>
            ) : null}
            {status?.screen?.entityIgnored ? <p className="mb-3 text-xs text-stone">El registro de esta pantalla no se usa como contexto.</p> : null}
            {mode === "assistant" && status && !status.knowledgeReady ? (
              <p className="mb-3 rounded-[var(--radius-md)] border border-line bg-white px-3 py-2 text-sm text-ink-2">La guía del CRM todavía no está cargada en esta instalación. Avisale a un administrador.</p>
            ) : null}

            {mode === "analyst" && status?.quickQueries.length ? (
              <section aria-label="Consultas rápidas" className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Consultas rápidas · datos directos del CRM</p>
                <div className="flex flex-wrap gap-2">
                  {status.quickQueries.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      disabled={pending}
                      onClick={() => void ask({ quickQueryId: q.id, label: q.label })}
                      className="rounded-full border border-line bg-white px-3 py-1.5 text-sm hover:border-ink disabled:opacity-50"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {mode === "analyst" && status && !status.quickQueries.length ? <p className="mb-3 text-sm text-stone">Tu rol no tiene consultas de datos disponibles.</p> : null}

            {!thread.length ? (
              mode === "assistant" ? (
                <div className="text-sm text-ink-2">
                  <p>Preguntá cómo se hace algo en el CRM. Respondo con la guía del CRM y te dejo el link a la pantalla.</p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {EXAMPLES.map((ex) => (
                      <li key={ex}>
                        <button type="button" disabled={pending} onClick={() => void ask({ question: ex, label: ex })} className="text-left text-sm font-semibold underline underline-offset-4 hover:text-brick disabled:opacity-50">
                          {ex}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-ink-2">Consultá qué está pasando en tu operación. Solo ves lo que tu rol ya puede ver en el CRM.</p>
              )
            ) : (
              <ol className="flex flex-col gap-4" aria-label="Conversación">
                {thread.map((ex) => (
                  <li key={ex.id} className="flex flex-col gap-2">
                    <p className="ml-auto max-w-[90%] rounded-[var(--radius-lg)] bg-ink px-3 py-2 text-sm text-paper">{ex.question}</p>
                    {ex.error ? (
                      <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-[#fbeeed] px-3 py-2 text-sm text-danger">
                        {ex.error}
                      </p>
                    ) : ex.answer ? (
                      <AnswerView
                        answer={ex.answer}
                        statusNotice={status?.notice ?? null}
                        onNavigate={onClose}
                        onSuggestion={(s) => {
                          setMode(s.mode);
                          if (s.quickQueryId) void ask({ quickQueryId: s.quickQueryId, label: s.label.replace(/^.*«(.+)».*$/, "$1"), mode: s.mode });
                        }}
                      />
                    ) : (
                      <p className="text-sm text-stone">{mode === "assistant" ? "Buscando en la guía…" : "Consultando el CRM…"}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <form onSubmit={submit} className="border-t border-line bg-paper px-4 py-3">
            <label htmlFor="copilot-question" className="sr-only">
              {mode === "assistant" ? "Pregunta sobre cómo usar el CRM" : "Pregunta sobre la operación"}
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="copilot-question"
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={1000}
                placeholder={mode === "assistant" ? "¿Cómo hago…?" : status?.aiConfigured ? "¿Qué está pasando con…?" : "Probá: visitas de hoy, tareas vencidas…"}
                className="min-h-10 w-full resize-none rounded-[var(--radius-md)] border border-line bg-white px-3 py-2 text-sm placeholder:text-stone focus:border-ink focus:outline-none"
              />
              <button type="submit" disabled={pending || question.trim().length < 2} className="h-10 shrink-0 rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-2 disabled:opacity-50">
                {pending ? "…" : "Preguntar"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-stone">La IA no ejecuta acciones: explica, busca y resume. Verificá antes de decidir. {status?.shortcut ? `Atajo: ${status.shortcut}.` : ""}</p>
          </form>
        </div>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
      </div>
    </dialog>
  );
}

function AnswerView({ answer, statusNotice, onNavigate, onSuggestion }: { answer: CopilotAnswer; statusNotice: string | null; onNavigate: () => void; onSuggestion: (s: NonNullable<CopilotAnswer["suggestion"]>) => void }) {
  return (
    <article className="rounded-[var(--radius-lg)] border border-line bg-white p-3 text-sm" aria-label="Respuesta del asistente">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone">{GENERATED_BY[answer.generatedBy]}</p>
      {answer.notice && answer.notice !== statusNotice ? <p className="mb-2 rounded-[var(--radius-md)] bg-[#fbf4e6] px-2.5 py-1.5 text-xs text-warning">{answer.notice}</p> : null}
      <RichText text={answer.text} className="text-ink" />

      {answer.guide.length ? (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Fuentes de la guía">
          {answer.guide.map((g) => (
            <li key={`${g.document}-${g.heading}`} className="rounded-[var(--radius-md)] border border-line bg-paper px-3 py-2">
              <p className="font-semibold">{g.heading}</p>
              <p className="text-[11px] uppercase tracking-wide text-stone">Guía · {g.document}</p>
              {answer.generatedBy !== "ai" ? <RichText text={g.excerpt} className="mt-1.5 text-ink-2" /> : null}
              {g.href ? (
                <Link href={g.href} onClick={onNavigate} className="mt-1.5 inline-block text-xs font-semibold underline underline-offset-4 hover:text-brick">
                  Ir a la pantalla ({g.href})
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {answer.facts.length ? (
        <div className="mt-3 flex flex-col gap-3">
          {answer.facts.map((f, i) => (
            <section key={`${f.title}-${i}`} aria-label={`Hechos: ${f.title}`}>
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-2">Hechos · {f.title}</h3>
              {answer.generatedBy === "ai" ? <p className="text-xs text-stone">{f.summary}</p> : null}
              {f.period ? <p className="text-[11px] text-stone">Período: {f.period}</p> : null}
              {f.items.length ? (
                <ul className="mt-1.5 divide-y divide-line rounded-[var(--radius-md)] border border-line">
                  {f.items.map((it, j) => (
                    <li key={j} className="flex items-start justify-between gap-2 px-2.5 py-2">
                      <div className="min-w-0">
                        {it.href ? (
                          <Link href={it.href} onClick={onNavigate} className="font-semibold underline-offset-4 hover:underline">
                            {it.label}
                          </Link>
                        ) : (
                          <p className="font-semibold">{it.label}</p>
                        )}
                        {it.detail ? <p className="text-xs text-stone">{it.detail}</p> : null}
                        {it.definition ? <p className="mt-0.5 text-[11px] text-stone">Definición: {it.definition}</p> : null}
                      </div>
                      {it.badge ? <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{it.badge}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-[11px] text-stone">
                Origen:{" "}
                {f.source.href ? (
                  <Link href={f.source.href} onClick={onNavigate} className="underline underline-offset-2">
                    {f.source.label}
                  </Link>
                ) : (
                  f.source.label
                )}
                {f.scope === "own" ? " · solo lo asignado a vos" : f.scope === "all" ? " · todo lo que tu rol puede ver" : ""}
                {f.truncated ? ` · mostrando ${f.items.length} de ${f.total}` : ""}
              </p>
            </section>
          ))}
        </div>
      ) : null}

      {answer.interpretation.length ? (
        <section className="mt-3 rounded-[var(--radius-md)] bg-paper-2 px-3 py-2" aria-label="Interpretación de la IA">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-2">Interpretación de la IA (no son datos)</h3>
          <ul className="mt-1 list-disc pl-4 text-ink-2">
            {answer.interpretation.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {answer.suggestion ? (
        <button type="button" onClick={() => onSuggestion(answer.suggestion!)} className="mt-3 text-left text-xs font-semibold text-brick underline underline-offset-4">
          {answer.suggestion.label}
        </button>
      ) : null}

      <Feedback messageId={answer.messageId} />
    </article>
  );
}

function Feedback({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "commented">("idle");
  const [error, setError] = useState<string | null>(null);
  const commentId = useId();

  const send = async (r: 1 | -1, text?: string) => {
    setState("saving");
    const res = await call(() => copilotFeedbackAction({ messageId, rating: r, comment: text }));
    if (res.ok) {
      setError(null);
      setState(text ? "commented" : "saved");
    } else {
      setError(res.error);
      setState("idle");
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-2">
      <div className="flex items-center gap-2 text-xs text-stone">
        <span>¿Te sirvió?</span>
        {(
          [
            [1, "👍", "Me sirvió"],
            [-1, "👎", "No me sirvió"],
          ] as const
        ).map(([value, icon, label]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={rating === value}
            disabled={state === "saving"}
            onClick={() => {
              setRating(value);
              void send(value);
            }}
            className={cx("rounded-[var(--radius-md)] border px-2 py-0.5 text-sm", rating === value ? "border-ink bg-paper-2" : "border-line hover:border-ink")}
          >
            <span aria-hidden="true">{icon}</span>
          </button>
        ))}
        {state === "saved" || state === "commented" ? <span role="status">¡Gracias!</span> : null}
      </div>
      {rating !== null && state !== "commented" ? (
        <form
          className="mt-2 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) void send(rating, comment.trim());
          }}
        >
          <label htmlFor={commentId} className="sr-only">
            Comentario opcional sobre la respuesta
          </label>
          <input
            id={commentId}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder="Comentario opcional"
            className="h-8 w-full rounded-[var(--radius-md)] border border-line bg-white px-2 text-xs placeholder:text-stone focus:border-ink focus:outline-none"
          />
          <button type="submit" disabled={!comment.trim() || state === "saving"} className="h-8 shrink-0 rounded-[var(--radius-md)] border border-line bg-white px-2.5 text-xs font-semibold hover:border-ink disabled:opacity-50">
            Enviar comentario
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
