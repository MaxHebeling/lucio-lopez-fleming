"use client";

/**
 * Estado en vivo del link del cliente. Polling liviano (no hay Realtime: auth propia sobre Postgres):
 * cada 12 s con ETag/If-None-Match, pausado con la pestaña oculta y con backoff exponencial ante errores.
 * Al cerrarse la visita (o si el link deja de estar disponible) recarga la página: el servidor decide qué mostrar.
 */
import { useEffect, useRef, useState } from "react";

export type LivePhase = "scheduled" | "en_route" | "checked_in" | "in_progress";
type Status = { phase: LivePhase | "closed"; checkedInAt: string | null };

const POLL_MS = 12_000;
const MAX_BACKOFF_MS = 120_000;
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });

const STEPS: Array<{ phase: LivePhase; label: string }> = [
  { phase: "scheduled", label: "Programada" },
  { phase: "en_route", label: "En camino" },
  { phase: "checked_in", label: "En la propiedad" },
  { phase: "in_progress", label: "En curso" },
];

export function phaseCopy(s: { phase: LivePhase; checkedInAt: string | null }): { title: string; detail: string } {
  switch (s.phase) {
    case "en_route":
      return { title: "Tu asesor está en camino", detail: "Salió hacia la propiedad." };
    case "checked_in":
      return { title: "Tu asesor ya está en la propiedad", detail: s.checkedInAt ? `Llegada confirmada ${timeFmt.format(new Date(s.checkedInAt))}` : "Llegada confirmada" };
    case "in_progress":
      return { title: "La visita está en curso", detail: s.checkedInAt ? `Llegada confirmada ${timeFmt.format(new Date(s.checkedInAt))}` : "" };
    default:
      return { title: "Tu visita está programada", detail: "Acá vas a ver cuando tu asesor salga y llegue a la propiedad." };
  }
}

export function ClientLiveStatus({ token, initial }: { token: string; initial: { phase: LivePhase; checkedInAt: string | null } }) {
  const [status, setStatus] = useState(initial);
  const etag = useRef<string | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let delay = POLL_MS;
    let stopped = false;
    const url = `/api/visita/${encodeURIComponent(token)}`;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(tick, ms);
    };

    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store", headers: etag.current ? { "If-None-Match": etag.current } : {} });
        if (res.status === 404) {
          stopped = true;
          window.location.reload();
          return;
        }
        if (res.status === 304) {
          delay = POLL_MS;
        } else if (res.ok) {
          etag.current = res.headers.get("ETag");
          const next = (await res.json()) as Status;
          if (next.phase === "closed") {
            stopped = true;
            window.location.reload();
            return;
          }
          setStatus({ phase: next.phase, checkedInAt: next.checkedInAt });
          delay = POLL_MS;
        } else {
          delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        }
      } catch {
        // Sin conexión o red inestable: se reintenta con backoff (no hay nada que mostrarle al cliente).
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      schedule(delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule(0);
      else window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule(POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  const copy = phaseCopy(status);
  const idx = STEPS.findIndex((s) => s.phase === status.phase);
  return (
    <section className="vx-status" aria-labelledby="vx-status-title">
      <div aria-live="polite" aria-atomic="true">
        <h2 id="vx-status-title" className="vx-status-title">
          <span className="vx-dot" data-live={status.phase !== "scheduled"} aria-hidden="true" />
          {copy.title}
        </h2>
        {copy.detail ? <p className="mt-1.5 pl-[1.4rem] text-sm text-ink-2">{copy.detail}</p> : null}
      </div>
      <ol className="vx-steps" aria-label="Etapas de la visita">
        {STEPS.map((s, i) => (
          <li key={s.phase} className="vx-step" data-done={i <= idx} data-current={i === idx} aria-current={i === idx ? "step" : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}
