import type { Metadata } from "next";
import { connection } from "next/server";
import "./(site)/site.css";
import { NotFoundContent } from "@/components/site/NotFoundContent";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false, follow: true } };

/** 404 de rutas inexistentes (fuera de cualquier grupo): misma marca que el sitio. */
export default async function NotFound() {
  // Datos de sedes en vivo: no se prerenderiza en build (el build no depende de la base).
  await connection();
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
