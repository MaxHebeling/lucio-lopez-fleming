import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Monogram } from "@/components/experience/Monogram";

export function NotFoundContent() {
  return (
    <section className="container-site grid min-h-[70svh] items-center gap-10 py-20 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <p className="eyebrow text-brick">Error 404</p>
        <h1 className="display mt-6 text-[clamp(3rem,8vw,7rem)] leading-[0.92]">
          Esta dirección <em>no existe.</em>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-ink-2">Puede que la propiedad ya no esté publicada o que el enlace haya cambiado. Te dejamos por dónde seguir.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/propiedades" className="btn btn-ink">
            Ver propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
          </Link>
          <Link href="/" className="btn btn-outline">
            Ir al inicio
          </Link>
          <Link href="/contacto" className="btn btn-outline">
            Contactanos
          </Link>
        </div>
      </div>
      <Monogram className="hidden h-72 w-auto justify-self-end text-paper-2 lg:col-span-4 lg:col-start-9 lg:block" />
    </section>
  );
}
