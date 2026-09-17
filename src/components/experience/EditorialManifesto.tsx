import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Words } from "./Reveal";

/**
 * Nivel 2 · Pausa. Manifiesto corto con textos reales de la empresa (docs/WEB_EXPERIENCE.md §1): el párrafo se
 * enciende palabra por palabra con el scroll en desktop (`data-scene="words"`, opacidad 0.5 → 1: legible siempre);
 * en el resto de las pantallas se revela al entrar. Es la hoja de papel que cubre la portada: solo tipografía.
 */
export function EditorialManifesto({ foundedYear }: { foundedYear: number | null }) {
  return (
    <section className="scene manifesto" aria-labelledby="manifesto-title">
      <div className="container-site manifesto-grid">
        <div className="manifesto-side">
          <p className="eyebrow text-brick">La inmobiliaria</p>
          <h2 id="manifesto-title" className="manifesto-kicker">
            Líderes inmobiliarios {foundedYear ? `desde ${foundedYear}` : "en Salta"}
          </h2>
        </div>
        <div className="manifesto-main">
          <p className="manifesto-text display" data-scene="words" data-reveal="up">
            <Words text="Una de las empresas más tradicionales del rubro en Salta." />{" "}
            <em>
              <Words text="Seriedad, calidad humana, compromiso" />
            </em>{" "}
            <Words text="y la experiencia en el rubro, en cada negocio." />
          </p>
          <div className="manifesto-foot" data-reveal="up">
            <p>Comercialización de inmuebles y lotes, alquileres, administración y tasación de propiedades en la provincia de Salta y el país. Brindamos asesoramiento personalizado.</p>
            <Link href="/empresa" className="link-arrow text-ink">
              Conocé la empresa <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
