import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { LeadForm } from "@/components/site/LeadForm";
import { TextReveal } from "./Reveal";

/**
 * Captación de propietarios («Quiero vender mi propiedad»). Formulario grande y claro que crea un lead real en el CRM
 * (kind "owner": `sell_my_property` al vender, captación también al alquilar; ver server/site/leads.ts) con las mismas
 * defensas que el resto: validación en servidor, honeypot, rate limit, idempotencia y flag `public_lead_capture`.
 */
export function OwnersCapture({ types, phone }: { types: string[]; phone: { label: string; href: string } | null }) {
  return (
    <section id="vender" className="scene owners on-dark" aria-labelledby="vender-title" data-float-avoid>
      <div className="container-site owners-grid">
        <div className="owners-intro">
          <p className="eyebrow text-paper/75">Propietarios</p>
          <TextReveal id="vender-title" as="h2" className="display h2 mt-5" lines={["¿Tenés una propiedad", <em key="v">para vender o alquilar?</em>]} />
          <p className="owners-lede">Contanos qué es y dónde está. Te contactamos para conversar, tasarla y acompañarte en la venta o el alquiler, con asesoramiento personalizado.</p>
          <ul className="owners-links">
            <li>
              <Link href="/tasaciones" className="link-arrow text-paper">
                ¿Solo querés saber cuánto vale? Pedí una tasación <ArrowRight aria-hidden className="size-4" />
              </Link>
            </li>
            {phone ? (
              <li>
                <a href={phone.href} className="link-arrow text-paper">
                  <Phone aria-hidden className="size-4" /> ¿Preferís hablar? Llamanos al {phone.label}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="owners-card">
          <LeadForm kind="owner" size="lg" submitLabel="Quiero vender mi propiedad" appraisalTypes={types} />
        </div>
      </div>
    </section>
  );
}
