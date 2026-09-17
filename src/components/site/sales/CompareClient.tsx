"use client";

import { useEffect, useState } from "react";
import type { CompareSummaryResponse } from "@/server/sales/compare/service";
import { trackSite, writeCompare } from "./site-track";

/** Registra la comparación (solo la cantidad) y deja la selección de la pestaña igual a lo que se está viendo. */
export function CompareViewTracker({ codes }: { codes: number[] }) {
  useEffect(() => {
    trackSite("property_compared", { propertyCode: codes[0], props: { count: Math.min(3, Math.max(2, codes.length)) } });
  }, [codes]);
  useEffect(() => {
    // La URL compartida manda: se sincroniza la barra de comparación con estas propiedades.
    writeCompare(codes.map((code) => ({ code, label: `Propiedad #${code}` })));
  }, [codes]);
  return null;
}

/** Resumen redactado (solo se ofrece con la clave del proveedor configurada; guardas en el servidor). */
export function CompareSummaryButton({ codes }: { codes: number[] }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; text?: string }>({ status: "idle" });
  const run = async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/site/compare-summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes }) });
      const data = (await res.json().catch(() => null)) as CompareSummaryResponse | null;
      if (data?.status === "ok" && data.summary) setState({ status: "done", text: data.summary });
      else setState({ status: "error", text: "No hay un resumen redactado disponible ahora: las diferencias de arriba salen directo de las fichas." });
    } catch {
      setState({ status: "error", text: "No pudimos generar el resumen (sin conexión)." });
    }
  };
  return (
    <div className="mt-4" aria-live="polite">
      {state.status === "done" ? (
        <p className="border-l-2 border-brick pl-3 text-ink">
          {state.text}
          <span className="mt-1 block text-xs text-stone">✦ Resumen redactado automáticamente con los datos de la tabla.</span>
        </p>
      ) : (
        <>
          <button type="button" onClick={() => void run()} disabled={state.status === "loading"} className="btn btn-outline min-h-11 text-sm">
            {state.status === "loading" ? "Redactando…" : "✦ Resumen redactado"}
          </button>
          {state.status === "error" ? <p className="mt-2 text-sm text-ink-2">{state.text}</p> : null}
        </>
      )}
    </div>
  );
}
