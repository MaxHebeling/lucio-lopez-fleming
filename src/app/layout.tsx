import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-display", display: "swap" });
const sans = Manrope({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Lucio López Fleming Inmobiliaria · Salta", template: "%s · Lucio López Fleming" },
  description:
    "Inmobiliaria en Salta desde 1974: venta y alquiler de casas, departamentos, terrenos y locales, administración de alquileres y tasaciones.",
  applicationName: "Lucio López Fleming Inmobiliaria",
  // Entornos que no son producción nunca se indexan
  robots: process.env.APP_ENV === "production" ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f4f0ea", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
