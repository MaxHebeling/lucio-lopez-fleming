import type { Metadata } from "next";
import { Mail, Phone } from "lucide-react";
import { telHref, whatsappHref } from "@/server/properties/public-helpers";
import { getSiteInfo } from "@/server/site/info";
import { LeadForm } from "@/components/site/LeadForm";
import { Offices } from "@/components/site/home/Offices";
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from "@/components/site/icons";
import { pageMetadata } from "@/components/site/seo";

export const metadata: Metadata = pageMetadata({
  title: "Contacto",
  description: "Escribinos o visitanos: Casa Central en Av. Entre Ríos 639, Salta, y Oficina San Lorenzo Chico. Teléfono, horarios y formulario de contacto.",
  path: "/contacto",
});

/** ISR: se sirve desde caché; se regenera al invalidar el sitio (sedes, conteos) o a los 5 minutos. */
export const revalidate = 300;

export default async function ContactoPage() {
  const info = await getSiteInfo();
  const wa = whatsappHref(info.whatsappE164, "Hola, les escribo desde la web de Lucio López Fleming.");
  return (
    <>
      <div className="container-site grid gap-12 pb-8 pt-12 lg:grid-cols-12 lg:pt-20">
        <div className="lg:col-span-5">
          <p className="eyebrow text-brick">Contacto</p>
          <h1 className="display mt-6 text-[clamp(2.8rem,6.5vw,6rem)] leading-[0.95]">
            Hablemos <em>de tu próximo negocio.</em>
          </h1>
          <p className="mt-6 max-w-md text-lg text-ink-2">Contanos qué buscás, qué querés vender o alquilar. Brindamos asesoramiento personalizado.</p>
          <ul className="mt-10 grid gap-3">
            {wa ? (
              <li>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  <WhatsAppIcon className="size-5" /> Escribinos por WhatsApp
                </a>
              </li>
            ) : null}
            {info.branches.map((b) =>
              b.phone && telHref(b.phone) ? (
                <li key={b.slug} className="flex items-center gap-3">
                  <Phone aria-hidden className="size-5 text-brick" strokeWidth={1.6} />
                  <span>
                    {b.name}:{" "}
                    <a href={telHref(b.phone)!} className="whitespace-nowrap font-semibold underline-offset-4 hover:underline">
                      {b.phone}
                    </a>
                  </span>
                </li>
              ) : null,
            )}
            {info.mainEmail ? (
              <li className="flex items-center gap-3">
                <Mail aria-hidden className="size-5 text-brick" strokeWidth={1.6} />
                <a href={`mailto:${info.mainEmail}`} className="break-all font-semibold underline-offset-4 hover:underline">
                  {info.mainEmail}
                </a>
              </li>
            ) : null}
            <li className="mt-2 flex items-center gap-2">
              <a href={info.social.instagram} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 hover:border-ink">
                <InstagramIcon className="size-5" /> Instagram
              </a>
              <a href={info.social.facebook} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 hover:border-ink">
                <FacebookIcon className="size-5" /> Facebook
              </a>
            </li>
          </ul>
        </div>
        <section aria-labelledby="form-contacto" className="lg:col-span-6 lg:col-start-7">
          <div className="rounded-[20px] border border-line bg-white p-5 sm:p-8">
            <h2 id="form-contacto" className="display text-4xl">
              Envianos tu consulta
            </h2>
            <div className="mt-6">
              <LeadForm kind="contact" />
            </div>
          </div>
        </section>
      </div>
      <Offices branches={info.branches} />
    </>
  );
}
