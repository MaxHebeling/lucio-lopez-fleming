"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Phone, X } from "lucide-react";
import { Logo } from "./Logo";
import { SITE_NAV } from "./nav";
import { WhatsAppIcon } from "./icons";
import { pauseSmoothScroll, resumeSmoothScroll } from "@/components/experience/motion/smooth-scroll";

type Props = { phone: { label: string; href: string } | null; whatsappHref: string | null };

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Cabecera: sólida por defecto; en el home (data-tone="hero") transparente sobre la portada hasta hacer scroll.
 * Menú mobile accesible: foco atrapado, Esc cierra, el foco vuelve al botón y el fondo no scrollea.
 */
export function HeaderShell({ phone, whatsappHref }: Props) {
  const pathname = usePathname();
  const tone = pathname === "/" ? "hero" : "solid";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      setScrolled(window.scrollY > 24);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    pauseSmoothScroll();
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      resumeSmoothScroll();
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <header className="site-header" data-tone={tone} data-scrolled={scrolled ? "true" : "false"} data-menu-open={open ? "true" : "false"}>
      <div className="container-site flex h-full items-center justify-between gap-6">
        <Logo />
        <nav aria-label="Principal" className="header-nav header-enter hidden items-center gap-5 whitespace-nowrap text-[0.875rem] font-medium lg:flex xl:gap-7 xl:text-[0.9rem]">
          {SITE_NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-enter flex items-center gap-2">
          {whatsappHref ? (
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary hidden min-h-11 px-4 text-sm sm:inline-flex">
              <WhatsAppIcon className="size-4" /> WhatsApp
            </a>
          ) : phone ? (
            <a href={phone.href} className="btn btn-outline hidden min-h-11 px-4 text-sm sm:inline-flex lg:px-3 xl:px-4">
              <Phone aria-hidden className="size-4" /> <span className="lg:max-xl:sr-only">{phone.label}</span>
            </a>
          ) : null}
          <button
            ref={buttonRef}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-menu" ref={panelRef} className="mobile-menu lg:hidden" data-state="open" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="container-site flex h-[var(--header-h)] items-center justify-between">
            <Logo onDark onClick={() => setOpen(false)} />
            <button type="button" className="inline-flex size-11 items-center justify-center rounded-full" aria-label="Cerrar menú" onClick={close}>
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <nav aria-label="Menú mobile" className="container-site pb-10 pt-6">
            <ul className="flex flex-col">
              <li className="menu-item border-b border-paper/15" style={{ "--i": 0 } as React.CSSProperties}>
                <Link href="/propiedades" onClick={() => setOpen(false)} className="display block py-4 text-4xl" aria-current={pathname === "/propiedades" ? "page" : undefined}>
                  Todas las propiedades
                </Link>
              </li>
              {SITE_NAV.map((item, i) => (
                <li key={item.href} className="menu-item border-b border-paper/15" style={{ "--i": i + 1 } as React.CSSProperties}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="display block py-4 text-4xl" aria-current={isCurrent(pathname, item.href) ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="menu-item mt-8 flex flex-col gap-3" style={{ "--i": 8 } as React.CSSProperties}>
              <Link href="/#vender" onClick={() => setOpen(false)} className="btn btn-light">
                Quiero vender mi propiedad
              </Link>
              {whatsappHref ? (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  <WhatsAppIcon className="size-5" /> Escribinos por WhatsApp
                </a>
              ) : null}
              {phone ? (
                <a href={phone.href} className="btn btn-outline">
                  <Phone aria-hidden className="size-5" /> Llamar al {phone.label}
                </a>
              ) : null}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
