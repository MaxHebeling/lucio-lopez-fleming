import type { Metadata } from "next";
import { NotFoundContent } from "@/components/site/NotFoundContent";

export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false, follow: true } };

export default function SiteNotFound() {
  return <NotFoundContent />;
}
