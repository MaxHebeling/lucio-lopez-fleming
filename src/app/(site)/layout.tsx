import "./site.css";
import { MotionProvider } from "@/components/experience/MotionProvider";
import { MOTION_BOOT_SCRIPT } from "@/components/experience/motion/config";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFloatingContact } from "@/components/site/SiteFloatingContact";
import { OrganizationJsonLd } from "@/components/site/JsonLd";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="site flex min-h-svh flex-col bg-paper text-ink">
      {/* Marca el documento antes del primer paint: sin JS o con reduced motion nada se oculta ni se mueve. */}
      <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
      <SiteFloatingContact />
      <OrganizationJsonLd />
      <MotionProvider />
    </div>
  );
}
