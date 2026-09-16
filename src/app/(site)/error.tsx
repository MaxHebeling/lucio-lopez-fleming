"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Error inesperado en una página del sitio: mensaje humano, reintento y salida. El detalle queda en los logs del servidor. */
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[site] error de página", error.digest ?? error.message);
  }, [error]);
  return (
    <section className="container-site grid min-h-[70svh] content-center py-20">
      <p className="eyebrow text-brick">Algo salió mal</p>
      <h1 className="display mt-6 max-w-3xl text-[clamp(2.8rem,7vw,6rem)] leading-[0.95]">
        No pudimos cargar <em>esta página.</em>
      </h1>
      <p className="mt-6 max-w-lg text-lg text-ink-2">Ya quedó registrado. Probá de nuevo en unos segundos o seguí navegando.</p>
      {error.digest ? <p className="tabular mt-2 text-sm text-ink-2">Referencia: {error.digest}</p> : null}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn btn-ink">
          Reintentar
        </button>
        <Link href="/propiedades" className="btn btn-outline">
          Ver propiedades
        </Link>
        <Link href="/contacto" className="btn btn-outline">
          Contacto
        </Link>
      </div>
    </section>
  );
}
