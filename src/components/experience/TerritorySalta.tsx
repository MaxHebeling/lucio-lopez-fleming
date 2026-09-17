import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ZoneShowcase } from "@/server/properties/public-home";
import { plural } from "@/server/properties/public-helpers";
import { TextReveal } from "./Reveal";
import type { TerritoryFeature } from "./territory";

export { pickTerritoryFeature, type TerritoryFeature } from "./territory";


/**
 * Territorio. «SALTA» es la protagonista: letras gigantes que recortan la foto real de una propiedad con paisaje
 * (la portada de la zona con más propiedades fuera de la ciudad de la casa central; ver pickTerritoryFeature). La
 * figura es decorativa (aria-hidden): el contenido real es el titular y el índice de zonas con conteos en vivo, que
 * enlazan al buscador. La foto dentro del SVG se carga diferida (data-lazy-href) y se desplaza con el scroll en desktop.
 */
export function TerritorySalta({ zones, feature, localities, total }: { zones: ZoneShowcase[]; feature: TerritoryFeature | null; localities: number; total: number }) {
  if (!zones.length) return null;
  const photo = feature ? getImageProps({ src: feature.url, alt: "", width: 1000, height: 562 }).props.src : null;
  return (
    <section className="scene territory on-dark" aria-labelledby="territorio-title">
      <div className="container-site">
        <p className="eyebrow text-paper/75">Territorio</p>
        <svg className="territory-word" viewBox="0 0 1000 292" aria-hidden focusable="false" data-reveal="fade">
          <defs>
            <clipPath id="salta-letters">
              <text x="0" y="276" textLength="1000" lengthAdjust="spacingAndGlyphs" className="territory-glyphs">
                SALTA
              </text>
            </clipPath>
          </defs>
          <g clipPath="url(#salta-letters)">
            <rect width="1000" height="292" className="territory-fill" />
            {photo ? (
              <g data-parallax-y="26">
                <image data-lazy-href={photo} x="0" y="-150" width="1000" height="590" preserveAspectRatio="xMidYMid slice" />
              </g>
            ) : null}
            <rect width="1000" height="292" className="territory-tint" />
          </g>
        </svg>

        <div className="territory-grid">
          <div className="territory-intro">
            <TextReveal id="territorio-title" as="h2" className="display h2" lines={["De la ciudad", <em key="c">a los cerros del valle.</em>]} />
            <p className="territory-lede">
              Comercialización de inmuebles y lotes en la provincia de Salta y el país. Hoy publicamos{" "}
              <strong className="tabular font-semibold text-paper">{plural(total, "propiedad", "propiedades")}</strong> en{" "}
              <strong className="tabular font-semibold text-paper">{plural(localities, "localidad", "localidades")}</strong>.
            </p>
            {feature ? (
              <p className="territory-credit">
                En las letras: una propiedad publicada en{" "}
                <Link href={`/propiedades?zona=${feature.zoneSlug}`} className="underline underline-offset-4 hover:text-paper">
                  {feature.zoneName}
                </Link>
                .
              </p>
            ) : null}
            <Link href="/propiedades" className="link-arrow mt-8 text-paper">
              Explorar todas las zonas <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>

          <ul className="zone-index" data-reveal-group="70">
            {zones.map((z) => (
              <li key={z.slug} data-reveal="up">
                <Link href={`/propiedades?zona=${z.slug}`} className="zone-row">
                  <span className="zone-thumb media-frame" aria-hidden>
                    {z.cover ? <Image src={z.cover.url} alt="" fill sizes="96px" className="object-cover" /> : null}
                  </span>
                  <span className="zone-name display">{z.name}</span>
                  <span className="zone-count tabular">{plural(z.count, "propiedad", "propiedades")}</span>
                  <ArrowUpRight aria-hidden className="zone-arrow size-5" strokeWidth={1.6} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
