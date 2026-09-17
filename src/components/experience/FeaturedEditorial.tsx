import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import type { PublicPropertyCard } from "@/server/properties/public";
import { OPERATION_NOUN } from "@/server/properties/public-helpers";
import { PriceBlock, Specs } from "@/components/site/property-bits";
import { TextReveal } from "./Reveal";

/**
 * Destacadas como editoriales de arquitectura: cada propiedad con una composición propia (no una grilla de cards).
 *  01 · foto protagonista a lo ancho + número grande.
 *  02 · split editorial: datos en columna, foto vertical.
 *  03 · tipografía gigante (la localidad real) detrás de la foto.
 * Datos 100 % de la base (ver getShowcaseProperties). Las fotos del inventario rondan 1024–1600 px de ancho: ningún
 * encuadre las muestra a más de ~1100 px CSS. Parallax interno ±28 px solo con el motor de escenas (desktop).
 */
const nn = (i: number) => String(i + 1).padStart(2, "0");

function Meta({ p, index }: { p: PublicPropertyCard; index: number }) {
  const op = p.prices[0]?.operation;
  return (
    <p className="feat-meta">
      <span className="tabular text-brick">{nn(index)}</span>
      <span aria-hidden className="feat-meta-rule" />
      <span>{[op ? OPERATION_NOUN[op] : null, p.typeName, p.zone.locality ?? p.zone.label].filter(Boolean).join(" · ")}</span>
    </p>
  );
}

function Photo({ p, sizes, className, parallax = 28 }: { p: PublicPropertyCard; sizes: string; className: string; parallax?: number }) {
  return (
    <div className={`media-frame feat-photo ${className}`}>
      <div className="feat-parallax" data-parallax-y={parallax}>
        {p.cover ? <Image src={p.cover.url} alt={p.cover.alt} fill sizes={sizes} className="reveal-img object-cover" /> : null}
      </div>
      <span aria-hidden className="curtain" />
    </div>
  );
}

function Cta({ p }: { p: PublicPropertyCard }) {
  return (
    <Link href={`/propiedades/${p.slug}`} className="link-arrow feat-cta">
      Ver la propiedad <span className="sr-only">{p.headline}</span> <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

export function FeaturedEditorial({ items, total }: { items: PublicPropertyCard[]; total: number }) {
  const [a, b, c] = items;
  if (!a) return null;
  return (
    <section className="scene feat-section" aria-labelledby="destacadas-title">
      <div className="container-site">
        <header className="feat-head">
          <p className="eyebrow text-brick">Selección</p>
          <TextReveal id="destacadas-title" as="h2" className="display h2 mt-5 max-w-4xl" lines={["Propiedades", <em key="d">para mirar dos veces.</em>]} />
          <Link href="/propiedades" className="link-arrow text-ink">
            Ver las {total} propiedades <ArrowRight aria-hidden className="size-4" />
          </Link>
        </header>

        <ol className="feat-list">
          <li className="feat feat-a">
            <article className="feat-a-grid" data-reveal="up">
              <span className="feat-num display tabular" aria-hidden>
                {nn(0)}
              </span>
              <Photo p={a} className="feat-a-photo" sizes="(min-width: 1440px) 1100px, (min-width: 1024px) 78vw, 100vw" />
              <div className="feat-a-copy">
                <Meta p={a} index={0} />
                <h3 className="display feat-title">
                  <Link href={`/propiedades/${a.slug}`}>{a.headline}</Link>
                </h3>
                {a.subtitle ? <p className="feat-sub">{a.subtitle}</p> : null}
                <Specs p={a} className="mt-4" />
                <div className="feat-foot">
                  <PriceBlock prices={a.prices} size="lg" />
                  <Cta p={a} />
                </div>
              </div>
            </article>
          </li>

          {b ? (
            <li className="feat feat-b">
              <article className="feat-b-grid" data-reveal="up">
                <div className="feat-b-copy">
                  <Meta p={b} index={1} />
                  <h3 className="display feat-title">
                    <Link href={`/propiedades/${b.slug}`}>{b.headline}</Link>
                  </h3>
                  {b.subtitle ? <p className="feat-sub">{b.subtitle}</p> : null}
                  <dl className="feat-facts">
                    {b.zone.label ? (
                      <div>
                        <dt>Ubicación</dt>
                        <dd>{b.zone.label}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Tipo</dt>
                      <dd>{b.typeName}</dd>
                    </div>
                    {b.prices[0] ? (
                      <div>
                        <dt>Operación</dt>
                        <dd className="first-letter:uppercase">{OPERATION_NOUN[b.prices[0].operation]}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Código</dt>
                      <dd className="tabular">{b.code}</dd>
                    </div>
                  </dl>
                  <Specs p={b} className="mt-6" />
                  <div className="feat-foot">
                    <PriceBlock prices={b.prices} size="lg" />
                    <Cta p={b} />
                  </div>
                </div>
                <Photo p={b} className="feat-b-photo" sizes="(min-width: 1024px) 44vw, 100vw" parallax={22} />
              </article>
            </li>
          ) : null}

          {c ? (
            <li className="feat feat-c">
              <article className="feat-c-grid" data-reveal="up">
                <p
                  className="feat-giant display"
                  aria-hidden
                  style={{ "--len": Math.max(6, (c.zone.locality ?? c.typeName).length) } as CSSProperties}
                >
                  <span data-drift="5">{c.zone.locality ?? c.typeName}</span>
                </p>
                <Photo p={c} className="feat-c-photo" sizes="(min-width: 1024px) 52vw, 100vw" parallax={32} />
                <div className="feat-c-copy">
                  <Meta p={c} index={2} />
                  <h3 className="display feat-title">
                    <Link href={`/propiedades/${c.slug}`}>{c.headline}</Link>
                  </h3>
                  <Specs p={c} className="mt-4" />
                  <div className="feat-foot">
                    <PriceBlock prices={c.prices} size="lg" />
                    <Cta p={c} />
                  </div>
                </div>
              </article>
            </li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}
