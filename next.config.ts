import type { NextConfig } from "next";

const storagePublic = process.env.STORAGE_PUBLIC_BASE_URL ? new URL(process.env.STORAGE_PUBLIC_BASE_URL) : null;

// CSP: sin dominios de terceros innecesarios. tile.openstreetmap.org es el host canónico de tiles de OSM
// (los subdominios a/b/c quedaron deprecados): lo usa el mapa estático del sitio público. Los tiles del mapa (OpenStreetMap) y las fotos migradas (Adinco)
// son los únicos orígenes externos de imágenes hasta completar la copia de multimedia a storage propio.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://static1.adinco.net https://tile.openstreetmap.org https://*.tile.openstreetmap.org${storagePublic ? ` ${storagePublic.origin}` : ""}`,
  "font-src 'self'",
  // Subida directa de fotos al storage (URL firmada): el navegador hace PUT al endpoint S3.
  `connect-src 'self'${process.env.STORAGE_DRIVER === "s3" && process.env.STORAGE_ENDPOINT ? ` ${new URL(process.env.STORAGE_ENDPOINT).origin}` : ""}`,
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
  // La barra final se resuelve en redirects() (abajo) y no con el 308 implícito de Next, que corre antes que todo:
  // así /company/ va a /empresa en un solo salto en lugar de 308 → 301.
  skipTrailingSlashRedirect: true,
  // URLs del sitio anterior (Adinco) → sitio nuevo. 301 explícito: es lo que esperan buscadores y portales.
  // Las fichas /luciolopez-{código} se resuelven contra property_redirects en /api/site/legacy/[code].
  async redirects() {
    const legacy = [
      { source: "/properties", destination: "/propiedades" },
      { source: "/properties/operation/forSale", destination: "/propiedades/venta" },
      { source: "/properties/operation/forRent", destination: "/propiedades/alquiler" },
      { source: "/company", destination: "/empresa" },
      { source: "/contact", destination: "/contacto" },
    ];
    return [
      ...legacy.flatMap((r) => [
        { ...r, statusCode: 301 as const },
        { source: `${r.source}/`, destination: r.destination, statusCode: 301 as const },
      ]),
      // Equivalente al redirect implícito de Next (sin trailingSlash): /ruta/ → /ruta, 308.
      { source: "/:path+/", destination: "/:path+", permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: "/luciolopez-:code(\\d{1,7})", destination: "/api/site/legacy/:code" }];
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
