import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PublicPropertyCard } from "@/server/properties/public";
import { OPERATION_NOUN } from "@/server/properties/public-helpers";
import { PriceBlock, Specs } from "@/components/site/property-bits";

/**
 * Showcase editorial asimétrico (no una grilla de cards idénticas): una pieza principal a sangre de columna,
 * dos piezas desplazadas y una fila final. Las fotos se descubren con cortina + escala interna (solo transform).
 */
const LAYOUT = [
  { wrap: "lg:col-span-7", ratio: "aspect-[4/3] lg:aspect-[5/4]", sizes: "(min-width: 1024px) 56vw, 92vw", big: true },
  { wrap: "lg:col-span-4 lg:col-start-9 lg:mt-40", ratio: "aspect-[4/5]", sizes: "(min-width: 1024px) 30vw, 92vw", big: false },
  { wrap: "lg:col-span-4 lg:col-start-2 lg:-mt-16", ratio: "aspect-[4/5]", sizes: "(min-width: 1024px) 30vw, 92vw", big: false },
  { wrap: "lg:col-span-6 lg:col-start-7 lg:mt-24", ratio: "aspect-[16/11]", sizes: "(min-width: 1024px) 46vw, 92vw", big: false },
  { wrap: "lg:col-span-5 lg:col-start-1 lg:mt-8", ratio: "aspect-[4/3]", sizes: "(min-width: 1024px) 38vw, 92vw", big: false },
  { wrap: "lg:col-span-5 lg:col-start-8 lg:mt-28", ratio: "aspect-[4/3]", sizes: "(min-width: 1024px) 38vw, 92vw", big: false },
];

export function PropertyShowcase({ items }: { items: PublicPropertyCard[] }) {
  return (
    <ul className="grid gap-14 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
      {items.slice(0, LAYOUT.length).map((p, i) => {
        const l = LAYOUT[i]!;
        const op = p.prices[0]?.operation;
        return (
          <li key={p.code} className={`card ${i === 0 ? "sm:col-span-2" : ""} ${l.wrap}`}>
            <article data-reveal="up">
              <div className={`media-frame ${l.ratio} rounded-[var(--radius-lg)] bg-paper-2`}>
                {/* El parallax mueve una capa interna más grande que el marco: la foto nunca invade el texto. */}
                <div className="absolute -inset-y-6 inset-x-0" data-parallax={l.big ? undefined : "0.05"}>
                  {p.cover ? <Image src={p.cover.url} alt={p.cover.alt} fill sizes={l.sizes} className="reveal-img card-img object-cover" /> : null}
                </div>
                <span aria-hidden className="curtain" />
                <span aria-hidden className="card-arrow absolute bottom-4 right-4 grid size-12 place-items-center rounded-full bg-paper text-ink">
                  <ArrowUpRight className="size-5" strokeWidth={1.8} />
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-2" style={{ "--reveal-delay": "120ms" } as CSSProperties}>
                    <span className="tabular text-brick">{String(i + 1).padStart(2, "0")}</span> · {op ? OPERATION_NOUN[op] : p.typeName} · {p.zone.label}
                  </p>
                  <h3 className={`display mt-2 ${l.big ? "text-4xl lg:text-5xl" : "text-3xl"} leading-[1.02]`}>
                    <Link href={`/propiedades/${p.slug}`} className="card-link">
                      {p.headline}
                    </Link>
                  </h3>
                  <Specs p={p} className="mt-3" />
                </div>
                <PriceBlock prices={p.prices} />
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
