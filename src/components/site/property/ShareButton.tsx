"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/** Compartir: Web Share API cuando existe (mobile); si no, copia el link. Resultado anunciado por aria-live. */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [msg, setMsg] = useState("");
  const onClick = async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMsg("Link copiado");
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setMsg("Link copiado");
      } catch {
        setMsg("No se pudo copiar: " + url);
      }
    }
    window.setTimeout(() => setMsg(""), 4000);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} className="btn btn-outline min-h-11 px-4 text-sm">
        {msg === "Link copiado" ? <Check aria-hidden className="size-4" /> : <Share2 aria-hidden className="size-4" />} Compartir
      </button>
      <span role="status" aria-live="polite" className="text-sm text-ink-2">
        {msg}
      </span>
    </span>
  );
}
