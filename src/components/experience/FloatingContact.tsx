"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { WhatsAppIcon } from "@/components/site/icons";

type Props = { phone: { label: string; href: string } | null; whatsappHref: string | null };

/**
 * Contacto flotante discreto: WhatsApp si la inmobiliaria lo configuró (SITE_WHATSAPP_E164), si no el teléfono real.
 * Solo en mobile (desde 640 px la cabecera fija ya muestra el contacto). Aparece después de la portada al volver hacia
 * arriba, se retira mientras se lee hacia abajo (no tapa CTAs) y cuando hay otro contacto a la vista (captación, cierre,
 * pie) o se está escribiendo en un formulario (teclado). No existe en las fichas: ahí está la barra de contacto del asesor.
 */
export function FloatingContact({ phone, whatsappHref }: Props) {
  const pathname = usePathname();
  const [pastHero, setPastHero] = useState(false);
  const [avoid, setAvoid] = useState(false);
  const [typing, setTyping] = useState(false);
  const [goingUp, setGoingUp] = useState(true);
  const onDetail = /^\/propiedades\/[^/]+$/.test(pathname) && !/^\/propiedades\/(venta|alquiler)$/.test(pathname);

  useEffect(() => {
    let raf = 0;
    let lastY = window.scrollY;
    const read = () => {
      raf = 0;
      const y = window.scrollY;
      // Se muestra al volver hacia arriba (intención de contactar) y se retira mientras se lee hacia abajo.
      if (Math.abs(y - lastY) > 8) setGoingUp(y < lastY);
      lastY = y;
      setPastHero(y > window.innerHeight * 0.7);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    const visible = new Set<Element>();
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            for (const e of entries) {
              if (e.isIntersecting) visible.add(e.target);
              else visible.delete(e.target);
            }
            setAvoid(visible.size > 0);
          })
        : null;
    document.querySelectorAll("[data-float-avoid], .site-footer").forEach((el) => io?.observe(el));
    const onFocusIn = (e: FocusEvent) => setTyping(e.target instanceof HTMLElement && e.target.matches("input, textarea, select"));
    const onFocusOut = () => setTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [pathname]);

  if (onDetail || (!phone && !whatsappHref)) return null;
  const shown = pastHero && goingUp && !avoid && !typing;
  const wa = Boolean(whatsappHref);
  const href = whatsappHref ?? phone!.href;
  const label = wa ? "Escribinos por WhatsApp" : `Llamanos al ${phone!.label}`;

  return (
    <a
      href={href}
      {...(wa ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="float-contact"
      data-shown={shown ? "" : undefined}
      aria-label={label}
      tabIndex={shown ? undefined : -1}
      aria-hidden={shown ? undefined : true}
    >
      {wa ? <WhatsAppIcon className="size-5" /> : <Phone aria-hidden className="size-5" strokeWidth={1.8} />}
      <span className="float-contact-label" aria-hidden>
        {wa ? "WhatsApp" : phone!.label}
      </span>
    </a>
  );
}
