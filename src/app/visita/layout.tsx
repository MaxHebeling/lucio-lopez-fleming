import type { Metadata } from "next";
import "./visita.css";

/** Link temporal del cliente: nunca se indexa (además de X-Robots-Tag en next.config y fuera del sitemap). */
export const metadata: Metadata = {
  title: "Tu visita",
  description: "Seguí el estado de tu visita con Lucio López Fleming.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function VisitLayout({ children }: LayoutProps<"/visita">) {
  return children;
}
