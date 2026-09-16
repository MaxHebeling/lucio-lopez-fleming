import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Monogram } from "@/components/experience/Monogram";
import { TextReveal } from "@/components/experience/Reveal";

export function Closing({ foundedYear, whatsappHref }: { foundedYear: number | null; whatsappHref: string | null }) {
  return (
    <section className="border-t border-line py-[var(--section-y)]" aria-labelledby="cierre-title">
      <div className="container-site relative">
        <Monogram className="pointer-events-none absolute -top-4 right-[var(--gutter)] hidden h-40 w-auto text-paper-2 lg:block" />
        <TextReveal
          id="cierre-title"
          as="h2"
          className="display relative text-[length:var(--text-macro)] leading-[0.88] tracking-[-0.04em]"
          lines={["Buenos", <em key="n">negocios.</em>]}
        />
        <div className="relative mt-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-lg text-ink-2">{foundedYear ? `Desde ${foundedYear}, en Salta. ` : ""}Contanos qué buscás o qué querés vender y te asesoramos.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/propiedades" className="btn btn-ink" data-magnetic>
              Ver propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
            </Link>
            {whatsappHref ? (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                WhatsApp
              </a>
            ) : (
              <Link href="/contacto" className="btn btn-outline">
                Contactanos
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
