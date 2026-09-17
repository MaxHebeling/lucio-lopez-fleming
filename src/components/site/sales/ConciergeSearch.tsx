"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { ConciergeResponse } from "@/server/sales/concierge";
import { conciergeSnapshot, trackSite, writeConcierge, type StoredConcierge } from "./site-track";
import "./sales.css";

type Ok = Extract<ConciergeResponse, { status: "ok" }>;

const noopSubscribe = () => () => {};

const PLACEHOLDER = "Contanos qué buscás: «casa con jardín hasta USD 180.000 en San Lorenzo»";

/**
 * «Contanos qué buscás»: texto libre → filtros REALES del buscador (servidor: src/server/sales/concierge.ts).
 * Sin JS el formulario igual funciona (POST → 303 al listado filtrado). Con JS: interpreta, recuerda en esta pestaña lo
 * que entendió (para explicarlo en el listado y, si la persona envía una consulta, sugerir su perfil) y navega.
 * Nunca muestra resultados inventados: los resultados son el listado real.
 */
export function ConciergeSearch({ variant, page, currentHref }: { variant: "hero" | "listing"; page: "home" | "listing"; /** URL canónica del listado actual (la arma el servidor). */ currentHref?: string }) {
  const router = useRouter();
  const id = useId();
  const [typed, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Ok | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inflight = useRef(false);

  // En el listado: si la URL actual es la que armó la última interpretación de esta pestaña, se explica.
  const storedRaw = useSyncExternalStore(noopSubscribe, conciergeSnapshot, () => "");
  const restored = useMemo(() => {
    if (page !== "listing" || !storedRaw || !currentHref) return null;
    try {
      const stored = JSON.parse(storedRaw) as StoredConcierge;
      return stored.href === currentHref ? stored : null;
    } catch {
      return null;
    }
  }, [page, storedRaw, currentHref]);
  const text = typed ?? restored?.text ?? "";
  const shown = result ?? (restored?.response as Ok | undefined) ?? null;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = text.trim();
    if (value.length < 2 || inflight.current) return;
    inflight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/site/concierge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: value }) });
      const data = (await res.json().catch(() => null)) as ConciergeResponse | null;
      if (!data || data.status !== "ok") {
        setResult(null);
        setMessage(
          data?.status === "rate_limited"
            ? "Hiciste muchas búsquedas seguidas. Probá en unos minutos o usá los filtros."
            : data?.status === "disabled"
              ? "La búsqueda por texto no está disponible en este momento. Usá los filtros del buscador."
              : "No pudimos interpretar la búsqueda. Probá de nuevo o usá los filtros.",
        );
        return;
      }
      trackSite("concierge_searched", { props: { filters: data.chips.filter((c) => c.filters).length, unparsed: data.unparsed.length > 0, layer: data.layer, page } });
      writeConcierge({ text: value, href: data.href, response: data, at: Date.now() });
      setResult(data);
      if (data.hasFilters) {
        const here = `${window.location.pathname}${window.location.search}`;
        if (here !== data.href) router.push(data.href);
      }
    } catch {
      setMessage("No pudimos interpretar la búsqueda (sin conexión). Probá de nuevo o usá los filtros.");
    } finally {
      inflight.current = false;
      setPending(false);
    }
  };

  const showSummary = shown && (page === "listing" || !shown.hasFilters);
  return (
    <div className={page === "listing" ? "concierge-summary" : undefined}>
      <form action="/api/site/concierge" method="post" onSubmit={onSubmit} role="search" aria-label="Búsqueda en lenguaje natural" className={`concierge ${variant === "hero" ? "concierge-dark" : ""}`} aria-busy={pending || undefined}>
        <span aria-hidden className="concierge-mark">
          ✦
        </span>
        <label htmlFor={`${id}-texto`} className="sr-only">
          Contanos qué buscás
        </label>
        <input
          id={`${id}-texto`}
          name="texto"
          className="concierge-input"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          minLength={2}
          maxLength={300}
          placeholder={PLACEHOLDER}
          value={text}
          onChange={(e) => setText(e.target.value)}
          // El foco se indica en todo el control (:focus-within), no en el campo interno.
          style={{ outline: "none" }}
        />
        <button type="submit" disabled={pending} className={`btn concierge-submit ${variant === "hero" ? "btn-light" : "btn-ink"}`}>
          {pending ? "Interpretando…" : "Buscar"}
        </button>
      </form>

      <div aria-live="polite" className={page === "home" ? "empty:hidden" : undefined}>
        {message ? <p className="concierge-feedback">{message}</p> : null}
        {showSummary ? <Understood result={shown} home={page === "home"} /> : null}
      </div>
    </div>
  );
}

function Understood({ result, home }: { result: Ok; home: boolean }) {
  const filtering = result.chips.filter((c) => c.filters);
  const info = result.chips.filter((c) => !c.filters);
  return (
    <div className={home ? "concierge-feedback" : "text-sm text-ink-2"}>
      {filtering.length ? (
        <>
          <p className="font-semibold text-ink">Entendimos:</p>
          <ul className="concierge-chips" aria-label="Filtros aplicados">
            {filtering.map((c) => (
              <li key={c.key} className="concierge-chip" data-filters="true">
                {c.label}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="font-semibold text-ink">No encontramos filtros concretos en tu búsqueda.</p>
      )}
      {info.length ? (
        <ul className="concierge-chips" aria-label="Datos tenidos en cuenta que no filtran">
          {info.map((c) => (
            <li key={c.key} className="concierge-chip" data-filters="false">
              {c.label}
            </li>
          ))}
        </ul>
      ) : null}
      {result.unparsed.length ? <p className="mt-2">No pude interpretar: {result.unparsed.map((u) => `«${u}»`).join(", ")}.</p> : null}
      {result.ambiguousLinks ? (
        <p className="mt-2">
          ¿El monto es en{" "}
          <Link href={result.ambiguousLinks.usd} className="font-semibold underline underline-offset-4">
            dólares
          </Link>{" "}
          o en{" "}
          <Link href={result.ambiguousLinks.ars} className="font-semibold underline underline-offset-4">
            pesos
          </Link>
          ?
        </p>
      ) : null}
      {result.ownerHint ? (
        <p className="mt-2">
          ¿Querés vender o tasar tu propiedad?{" "}
          <Link href="/tasaciones" className="font-semibold underline underline-offset-4">
            Pedí una tasación
          </Link>
        </p>
      ) : null}
      {!result.hasFilters ? (
        <p className="mt-2">
          Probá sumar tipo, zona o presupuesto (por ejemplo, «casa en Vaqueros hasta USD 150.000») o{" "}
          <Link href="/propiedades" className="font-semibold underline underline-offset-4">
            mirá todas las propiedades
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 text-xs text-stone">Interpretación automática de tu texto: podés ajustar cada filtro a mano.</p>
      )}
    </div>
  );
}
