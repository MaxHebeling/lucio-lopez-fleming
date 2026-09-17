import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PublicPropertyCard } from "@/server/properties/public";
import { OPERATION_NOUN } from "@/server/properties/public-helpers";
import { Monogram } from "@/components/experience/Monogram";
import { PriceBlock, Specs, StatusBadge, TourBadge } from "./property-bits";
import { CompareToggle } from "./sales/CompareControls";

/**
 * Tarjeta de propiedad. Un único enlace (el titular) cubre toda la tarjeta: un tab stop, nombre accesible claro.
 * `sizes` según la grilla donde se usa (por defecto 1 → 2 → 3 columnas).
 */
export function PropertyCard({
  p,
  sizes = "(min-width: 1280px) 30vw, (min-width: 640px) 46vw, 92vw",
  headingLevel = 3,
  eager = false,
  preload = false,
  ratio = "aspect-[4/3]",
  compare = false,
}: {
  p: PublicPropertyCard;
  sizes?: string;
  headingLevel?: 2 | 3;
  eager?: boolean;
  /** Candidata a LCP (primera tarjeta visible): carga inmediata con prioridad alta (fetchpriority="high"). */
  preload?: boolean;
  ratio?: string;
  /** Botón «Comparar» (solo con el comparador encendido). */
  compare?: boolean;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const op = p.prices[0]?.operation;
  return (
    <article className="card group flex h-full flex-col">
      <div className={`media-frame relative ${ratio} overflow-hidden rounded-[var(--radius-lg)] bg-paper-2`}>
        {p.cover ? (
          <Image src={p.cover.url} alt={p.cover.alt} fill sizes={sizes} className="card-img object-cover" loading={eager || preload ? "eager" : "lazy"} fetchPriority={preload ? "high" : undefined} />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-line">
            <Monogram className="h-16 w-auto" />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {op ? <span className="rounded-full bg-paper/95 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-ink">{OPERATION_NOUN[op]}</span> : null}
          <StatusBadge status={p.status} />
          <TourBadge hasTour={p.hasTour} />
        </div>
        {compare ? <CompareToggle code={p.code} label={p.headline} className="compare-toggle-card" /> : null}
        <span aria-hidden className="card-arrow absolute bottom-3 right-3 grid size-10 place-items-center rounded-full bg-paper text-ink">
          <ArrowUpRight className="size-5" strokeWidth={1.8} />
        </span>
      </div>
      <div className="flex flex-1 flex-col pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">{p.zone.label ?? p.typeName}</p>
        <H className="mt-1.5 text-lg font-semibold leading-snug tracking-[-0.01em]">
          <Link href={`/propiedades/${p.slug}`} className="card-link">
            {p.headline}
          </Link>
        </H>
        {p.subtitle ? <p className="mt-1 line-clamp-1 text-sm text-ink-2">{p.subtitle}</p> : null}
        <Specs p={p} className="mt-3" />
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <PriceBlock prices={p.prices} />
          <span className="tabular text-xs text-ink-2">Cód. {p.code}</span>
        </div>
      </div>
    </article>
  );
}
