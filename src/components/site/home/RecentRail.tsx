import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PublicPropertyCard } from "@/server/properties/public";
import { PropertyCard } from "@/components/site/PropertyCard";
import { TextReveal } from "@/components/experience/Reveal";

/** Recientes: fila horizontal con swipe nativo en mobile y scroll horizontal libre en desktop (sin secuestro). */
export function RecentRail({ items }: { items: PublicPropertyCard[] }) {
  if (!items.length) return null;
  return (
    <section className="scene recent" aria-labelledby="recientes-title">
      <div className="container-site flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow text-brick">Recién publicadas</p>
          <TextReveal id="recientes-title" as="h2" className="display h2 mt-5" lines={["Lo último que", <em key="e">entró a la cartera.</em>]} />
        </div>
        <Link href="/propiedades?orden=recientes" className="link-arrow text-ink">
          Ver todas <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      <ul className="rail mt-12 lg:mx-auto lg:max-w-[var(--container)]" data-reveal-row aria-label="Propiedades recientes (deslizá para ver más)">
        {items.map((p) => (
          <li key={p.code} data-reveal="up">
            <PropertyCard p={p} sizes="(min-width: 1024px) 28vw, (min-width: 640px) 46vw, 78vw" />
          </li>
        ))}
      </ul>
    </section>
  );
}
