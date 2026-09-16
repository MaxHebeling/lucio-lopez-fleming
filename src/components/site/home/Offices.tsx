import { Clock, MapPin, Phone } from "lucide-react";
import type { PublicBranch } from "@/server/site/info";
import { telHref } from "@/server/properties/public-helpers";
import { StaticMap } from "@/components/site/StaticMap";
import { Reveal, TextReveal } from "@/components/experience/Reveal";

/** Oficinas: sedes reales con dirección, horario, teléfono y mapa. */
export function Offices({ branches, headingLevel = 2 }: { branches: PublicBranch[]; headingLevel?: 2 | 3 }) {
  if (!branches.length) return null;
  return (
    <section className="py-[var(--section-y)]" aria-labelledby="oficinas-title">
      <div className="container-site">
        <p className="eyebrow text-brick">Oficinas</p>
        <TextReveal id="oficinas-title" as={headingLevel === 2 ? "h2" : "h3"} className="display h2 mt-5" lines={["Vení a conocernos", <em key="o">en Salta.</em>]} />
        <ul className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-8" data-reveal-group="120">
          {branches.map((b) => (
            <Reveal as="li" key={b.slug}>
              <h3 className="display text-3xl lg:text-4xl">
                {b.name}
              </h3>
              <ul className="mt-5 grid gap-2.5 text-ink-2">
                {b.street || b.city ? (
                  <li className="flex gap-2.5">
                    <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-brick" strokeWidth={1.6} />
                    {[b.street, b.city, b.province].filter(Boolean).join(", ")}
                  </li>
                ) : null}
                {b.schedule ? (
                  <li className="flex gap-2.5">
                    <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-brick" strokeWidth={1.6} />
                    <span>
                      <span className="sr-only">Horario: </span>
                      {/^\d/.test(b.schedule) ? `Horario: ${b.schedule} h` : b.schedule}
                    </span>
                  </li>
                ) : null}
                {b.phone && telHref(b.phone) ? (
                  <li className="flex gap-2.5">
                    <Phone aria-hidden className="mt-0.5 size-5 shrink-0 text-brick" strokeWidth={1.6} />
                    <a href={telHref(b.phone)!} className="font-semibold text-ink underline-offset-4 hover:underline">
                      {b.phone}
                    </a>
                  </li>
                ) : null}
              </ul>
              {b.lat !== null && b.lng !== null ? <StaticMap className="mt-6" lat={b.lat} lng={b.lng} approximate={false} label={`Mapa: ${b.name}, ${[b.street, b.city].filter(Boolean).join(", ")}`} /> : null}
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
