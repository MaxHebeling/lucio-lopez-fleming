"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { PropertyQaResponse } from "@/server/sales/property-qa/service";
import { hydrationStore, trackSite } from "./site-track";
import "./sales.css";

type Ok = Extract<PropertyQaResponse, { status: "ok" }>;

/** Precarga la pregunta en el formulario real de consulta (LeadForm de #consulta) y lleva el foco ahí. */
function openAdvisor(code: number, question: string) {
  const box = document.getElementById("consulta");
  const form = box?.querySelector<HTMLFormElement>("form");
  const message = form?.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
  if (message) message.value = `Hola, tengo una consulta sobre la propiedad Cód. ${code}: ${question}`.slice(0, 2000);
  box?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  form?.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
}

/** Abre «Pedir una visita» (formulario real) y lleva el foco. */
function openVisit() {
  const details = document.querySelector<HTMLDetailsElement>("[data-visit-request]");
  if (details) {
    details.open = true;
    details.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    details.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
  } else openAdvisor(0, "");
}

/**
 * «✦ Preguntale a esta propiedad». Responde SOLO con los datos publicados de esta ficha (servidor:
 * src/server/sales/property-qa). Si el dato no está registrado lo dice y ofrece consultar a un asesor con la pregunta
 * precargada. Cerrado por defecto (<details>): no empuja contenido ni compite con la galería.
 */
export function PropertyQA({ code, suggestions, visitable }: { code: number; suggestions: string[]; visitable: boolean }) {
  const id = useId();
  const ready = useSyncExternalStore(hydrationStore.subscribe, hydrationStore.client, hydrationStore.server);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Ok | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const ask = async (q: string) => {
    const value = q.trim();
    if (value.length < 3 || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/site/property-qa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, question: value }) });
      const data = (await res.json().catch(() => null)) as PropertyQaResponse | null;
      if (!data || data.status !== "ok") {
        setAnswer(null);
        setError(data?.status === "rate_limited" ? "Hiciste muchas preguntas seguidas. Probá en unos minutos o consultá a un asesor." : "No pudimos responder ahora. Podés consultar a un asesor.");
        return;
      }
      setAsked(value);
      setAnswer(data);
      setQuestion("");
      trackSite("property_qa_asked", { propertyCode: code, props: { topic: data.topic, answered: data.registered } });
      requestAnimationFrame(() => answerRef.current?.focus());
    } catch {
      setError("No pudimos responder (sin conexión). Probá de nuevo o consultá a un asesor.");
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <details className="qa group mt-14" data-property-qa>
      <summary className="qa-toggle cursor-pointer list-none">
        <span>
          <span className="qa-title">
            <span aria-hidden className="mr-2 text-brick">
              ✦
            </span>
            Preguntale a esta propiedad
          </span>
          <span className="mt-1 block text-sm text-ink-2">Respuestas con los datos publicados de esta ficha.</span>
        </span>
        <span aria-hidden className="text-2xl transition-transform group-open:rotate-45">
          +
        </span>
      </summary>

      <noscript>
        <p className="mt-4 text-sm text-ink-2">
          Para preguntar necesitás JavaScript. También podés{" "}
          <a href="#consulta" className="underline underline-offset-4">
            consultar a un asesor
          </a>
          .
        </p>
      </noscript>

      {ready ? (
        <div className="mt-5">
          {suggestions.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Preguntas frecuentes">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" className="qa-suggestion" disabled={pending} onClick={() => void ask(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form onSubmit={onSubmit} className="concierge mt-4" aria-busy={pending || undefined}>
            <label htmlFor={`${id}-q`} className="sr-only">
              Tu pregunta sobre esta propiedad
            </label>
            <input id={`${id}-q`} className="concierge-input" value={question} onChange={(e) => setQuestion(e.target.value)} minLength={3} maxLength={300} placeholder="Por ejemplo: ¿tiene calefacción?" autoComplete="off" />
            <button type="submit" disabled={pending || question.trim().length < 3} className="btn btn-ink concierge-submit">
              {pending ? "Buscando…" : "Preguntar"}
            </button>
          </form>

          <div aria-live="polite">
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            {answer ? (
              <div ref={answerRef} tabIndex={-1} className="qa-answer outline-none" role="region" aria-label="Respuesta sobre la propiedad">
                <p className="text-sm text-stone">«{asked}»</p>
                <p className="mt-1 text-lg leading-snug text-ink">{answer.answer}</p>
                {answer.facts.length ? (
                  <dl className="mt-3 grid gap-1 text-sm text-ink-2">
                    {answer.facts.slice(0, 4).map((f) => (
                      <div key={`${f.label}-${f.value}`} className="flex flex-wrap gap-x-2">
                        <dt className="font-semibold text-ink">{f.label}:</dt>
                        <dd className="tabular">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <p className="mt-2 text-xs text-stone">Fuente: datos publicados de la ficha{answer.layer === "ai" ? " · redactado automáticamente" : ""}.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {answer.cta === "visit" && visitable ? (
                    <button type="button" className="btn btn-primary min-h-11 text-sm" onClick={openVisit}>
                      Pedir una visita <ArrowRight aria-hidden className="btn-icon size-4" />
                    </button>
                  ) : null}
                  {answer.cta === "advisor" || !answer.registered ? (
                    <button type="button" className="btn btn-outline min-h-11 text-sm" onClick={() => openAdvisor(code, asked)}>
                      Consultar a un asesor
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </details>
  );
}

/** Señales de interés de la ficha: vista (una vez por carga) y apertura de la galería. Sin texto ni datos personales. */
export function PropertyViewTracker({ code }: { code: number }) {
  useEffect(() => {
    let from: "listing" | "home" | "similar" | "compare" | "direct" = "direct";
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === window.location.origin) {
        if (ref.pathname === "/") from = "home";
        else if (ref.pathname.startsWith("/propiedades/comparar")) from = "compare";
        else if (/^\/propiedades\/[a-z0-9-]{3,}$/.test(ref.pathname) && !/^\/propiedades\/(venta|alquiler)$/.test(ref.pathname)) from = "similar";
        else if (ref.pathname.startsWith("/propiedades")) from = "listing";
      }
    } catch {
      from = "direct";
    }
    trackSite("property_viewed", { propertyCode: code, props: { from } });
    const gallery = document.querySelector("[data-track-gallery]");
    let sent = false;
    const onClick = (e: Event) => {
      if (sent || !(e.target instanceof Element) || !e.target.closest("button")) return;
      sent = true;
      trackSite("property_gallery_opened", { propertyCode: code });
    };
    gallery?.addEventListener("click", onClick);
    return () => gallery?.removeEventListener("click", onClick);
  }, [code]);
  return null;
}
