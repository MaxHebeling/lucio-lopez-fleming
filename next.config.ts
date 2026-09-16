import type { NextConfig } from "next";

const storagePublic = process.env.STORAGE_PUBLIC_BASE_URL ? new URL(process.env.STORAGE_PUBLIC_BASE_URL) : null;

// CSP: sin dominios de terceros innecesarios. Los tiles del mapa (OpenStreetMap) y las fotos migradas (Adinco)
// son los únicos orígenes externos de imágenes hasta completar la copia de multimedia a storage propio.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://static1.adinco.net https://*.tile.openstreetmap.org${storagePublic ? ` ${storagePublic.origin}` : ""}`,
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:" + (storagePublic ? ` ${storagePublic.origin}` : ""),
  "frame-src https://www.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // El proxy bufferea el body (10 MB por defecto): las fotos admiten hasta 15 MB (subida por /api/crm/propiedades/[id]/multimedia).
    proxyClientMaxBodySize: "16mb",
  },
  serverExternalPackages: ["@node-rs/argon2", "pg", "sharp"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "static1.adinco.net" },
      ...(storagePublic ? [{ protocol: storagePublic.protocol.replace(":", "") as "https", hostname: storagePublic.hostname }] : []),
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/crm/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/propietarios/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
