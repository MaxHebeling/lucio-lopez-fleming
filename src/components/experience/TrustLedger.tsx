import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { ArrowRight, Clock, MapPin, Phone } from "lucide-react";
import type { PublicBranch } from "@/server/site/info";
import { telHref } from "@/server/properties/public-helpers";
import { TextReveal } from "./Reveal";

/**
 * Confianza, solo con datos reales: año de fundación y sedes (organización y sucursales cargadas en la base),
 * inventario y localidades en vivo, el texto con el que la empresa se describe y una foto real del equipo.
 * Sin testimonios, cifras de operaciones ni clientes (no existen: docs/WEB_EXPERIENCE.md §1).
 */
export function TrustLedger({
  foundedYear,
  branches,
  total,
  localities,
  photo,
  photoAlt,
}: {
  foundedYear: number | null;
  branches: PublicBranch[];
  total: number;
  localities: number;
  photo: StaticImageData;
  photoAlt: string;
}) {
  const figures = [
    foundedYear ? { value: String(foundedYear), label: "Fundada en Salta" } : null,
    branches.length ? { value: String(branches.length), label: branches.length === 1 ? "Oficina" : "Oficinas" } : null,
    { value: new Intl.NumberFormat("es-AR").format(total), label: "Propiedades publicadas hoy" },
    { value: String(localities), label: "Localidades con propiedades" },
  ].filter(Boolean) as Array<{ value: string; label: string }>;

  return (
    <section className="scene trust" aria-labelledby="confianza-title">
      <div className="container-site">
        <div className="trust-head">
          <p className="eyebrow text-brick">La inmobiliaria</p>
          <TextReveal id="confianza-title" as="h2" className="display h2 mt-5 max-w-4xl" lines={["Vení a conocernos", <em key="t">en Salta.</em>]} />
        </div>

        <dl className="trust-figures" data-reveal-group="90">
          {figures.map((f) => (
            <div key={f.label} className="trust-figure" data-reveal="up">
              <dt>{f.label}</dt>
              <dd className="display tabular">{f.value}</dd>
            </div>
          ))}
        </dl>

        <div className="trust-grid">
          <figure className="trust-photo" data-reveal="up">
            <div className="media-frame">
              <div className="feat-parallax" data-parallax-y="20">
                <Image src={photo} alt={photoAlt} fill sizes="(min-width: 1024px) 50vw, 100vw" className="reveal-img object-cover" placeholder="blur" />
              </div>
              <span aria-hidden className="curtain" />
            </div>
          </figure>
          <div className="trust-copy">
            <blockquote className="trust-quote display">
              <p>«Nos caracterizamos por nuestra seriedad, calidad humana, compromiso y la experiencia en el rubro.»</p>
            </blockquote>
            <Link href="/empresa" className="link-arrow mt-6 text-ink">
              Conocé la empresa <ArrowRight aria-hidden className="size-4" />
            </Link>
            <ul className="trust-offices">
              {branches.map((b) => (
                <li key={b.slug}>
                  <h3 className="trust-office-name">{b.name}</h3>
                  <ul className="trust-office-data">
                    {b.street || b.city ? (
                      <li>
                        <MapPin aria-hidden className="size-4 shrink-0 text-brick" strokeWidth={1.6} />
                        {[b.street, b.city].filter(Boolean).join(", ")}
                      </li>
                    ) : null}
                    {b.schedule ? (
                      <li>
                        <Clock aria-hidden className="size-4 shrink-0 text-brick" strokeWidth={1.6} />
                        {/^\d/.test(b.schedule) ? <span>Horario: {b.schedule} h</span> : <span><span className="sr-only">Horario: </span>{b.schedule}</span>}
                      </li>
                    ) : null}
                    {b.phone && telHref(b.phone) ? (
                      <li>
                        <Phone aria-hidden className="size-4 shrink-0 text-brick" strokeWidth={1.6} />
                        <a href={telHref(b.phone)!} className="font-semibold text-ink underline-offset-4 hover:underline">
                          {b.phone}
                        </a>
                      </li>
                    ) : null}
                  </ul>
                </li>
              ))}
            </ul>
            <Link href="/contacto" className="link-arrow mt-2 text-ink">
              Mapas y contacto <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
