import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { TextReveal } from "./Reveal";

/**
 * Cierre como otra portada: la foto de la portada reencuadrada sobre el cielo (misma escena, otro plano), tipografía
 * grande y los dos caminos del sitio: ver propiedades o vender. La foto asienta su escala al entrar (motor de escenas).
 */
export function FinalCover({ photo, lines, lede, phone }: { photo: StaticImageData; lines: [string, string]; lede: string; phone: { label: string; href: string } | null }) {
  return (
    <section className="scene final on-dark" aria-labelledby="cierre-title" data-float-avoid>
      <div className="final-media" aria-hidden>
        <div className="final-settle" data-scene="settle">
          <Image src={photo} alt="" fill sizes="100vw" className="final-img" placeholder="blur" />
        </div>
      </div>
      <span className="final-veil" aria-hidden />
      <div className="container-site final-body">
        <TextReveal id="cierre-title" as="h2" className="display final-title" lines={[lines[0], <em key="c">{lines[1]}</em>]} />
        <p className="final-lede" data-reveal="up">
          {lede}
        </p>
        <div className="final-cta" data-reveal="up">
          <Link href="/propiedades" className="btn btn-light btn-arrow" data-magnetic>
            Ver propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
          </Link>
          <Link href="#vender" className="btn btn-outline">
            Quiero vender
          </Link>
          {phone ? (
            <a href={phone.href} className="link-arrow final-phone">
              <Phone aria-hidden className="size-4" /> {phone.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
