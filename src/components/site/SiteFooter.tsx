import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { getSiteInfo } from "@/server/site/info";
import { telHref, whatsappHref } from "@/server/properties/public-helpers";
import { Monogram } from "@/components/experience/Monogram";
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from "./icons";
import { SITE_NAV } from "./nav";

export async function SiteFooter() {
  const info = await getSiteInfo();
  const wa = whatsappHref(info.whatsappE164, "Hola, les escribo desde la web de Lucio López Fleming.");
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer on-dark bg-ink text-paper">
      <div className="container-site grid gap-14 pb-10 pt-20 lg:grid-cols-12 lg:gap-8 lg:pt-28">
        <div className="lg:col-span-5">
          <Monogram className="h-16 w-auto text-brick" />
          <p className="display mt-8 max-w-md text-4xl leading-[1.02] lg:text-5xl">
            Buenos negocios{info.foundedYear ? <>, desde {info.foundedYear}.</> : "."}
          </p>
          <p className="mt-5 max-w-sm text-paper/75">Comercialización de inmuebles y lotes, alquileres, administración y tasación de propiedades en la provincia de Salta y el país.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                <WhatsAppIcon className="size-5" /> WhatsApp
              </a>
            ) : null}
            <Link href="/contacto" className="btn btn-outline">
              Contactanos
            </Link>
          </div>
        </div>

        <nav aria-label="Pie de página" className="lg:col-span-3">
          <p className="eyebrow text-paper/70">Explorar</p>
          <ul className="mt-5 grid gap-3 text-[0.95rem]">
            <li>
              <Link href="/propiedades" className="hover:underline">
                Todas las propiedades
              </Link>
            </li>
            {SITE_NAV.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="hover:underline">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid gap-8 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
          {info.branches.map((b) => (
            <address key={b.slug} className="not-italic">
              <p className="eyebrow text-paper/70">{b.name}</p>
              <ul className="mt-4 grid gap-2 text-[0.95rem] text-paper/85">
                {b.street || b.city ? (
                  <li className="flex gap-2">
                    <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-paper/60" />
                    {[b.street, b.city].filter(Boolean).join(", ")}
                  </li>
                ) : null}
                {b.phone && telHref(b.phone) ? (
                  <li className="flex gap-2">
                    <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-paper/60" />
                    <a href={telHref(b.phone)!} className="hover:underline">
                      {b.phone}
                    </a>
                  </li>
                ) : null}
                {b.schedule ? <li className="text-paper/70">{b.schedule}</li> : null}
              </ul>
            </address>
          ))}
          {info.mainEmail ? (
            <p className="flex gap-2 text-[0.95rem] text-paper/85">
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-paper/60" />
              <a href={`mailto:${info.mainEmail}`} className="break-all hover:underline">
                {info.mainEmail}
              </a>
            </p>
          ) : null}
        </div>
      </div>
      <div className="container-site flex flex-col gap-4 border-t border-paper/15 py-6 text-sm text-paper/70 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {info.name}
        </p>
        <div className="flex items-center gap-5">
          <Link href="/terminos" className="hover:underline">
            Términos
          </Link>
          <Link href="/privacidad" className="hover:underline">
            Privacidad
          </Link>
          <a href={info.social.instagram} target="_blank" rel="noopener noreferrer" className="inline-flex size-11 items-center justify-center rounded-full hover:text-paper" aria-label="Instagram de Lucio López Fleming">
            <InstagramIcon />
          </a>
          <a href={info.social.facebook} target="_blank" rel="noopener noreferrer" className="inline-flex size-11 items-center justify-center rounded-full hover:text-paper" aria-label="Facebook de Lucio López Fleming">
            <FacebookIcon />
          </a>
        </div>
      </div>
    </footer>
  );
}
