import type { Metadata } from "next";
import "./(site)/site.css";
import { NotFoundContent } from "@/components/site/NotFoundContent";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false, follow: true } };

/** 404 de rutas inexistentes (fuera de cualquier grupo): misma marca que el sitio. */
export default async function NotFound() {
  // Sin connection(): el 404 raíz se incluye en el árbol de TODAS las páginas (límite de not-found del layout raíz) y
  // cualquier API dinámica acá vuelve dinámico al sitio entero. Las sedes salen de la caché del sitio (getSiteInfo).
  return (
    <div className="site flex min-h-svh flex-col bg-paper text-ink">
      <SiteHeader />
      <main id="contenido" className="flex-1">
        <NotFoundContent />
      </main>
      <SiteFooter />
    </div>
  );
}
