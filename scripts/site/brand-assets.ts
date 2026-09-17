/**
 * Genera los assets de marca del sitio desde brand-source/ (ver brand-source/README.md).
 * - Monograma LLF vectorizado a mano (trazos angulares medidos sobre logo-cuadrado-blanco-sobre-ladrillo.png).
 * - Favicons/íconos desde el logo cuadrado (recorte del monograma para que se lea a 16–32 px).
 * - Fotos de oficina/equipo redimensionadas (next/image genera AVIF/WebP a partir de estas).
 * - Imagen OpenGraph por defecto (logo cuadrado original sobre ladrillo, sin texto inventado).
 * Uso: pnpm tsx scripts/site/brand-assets.ts   (idempotente; los archivos generados se versionan)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = resolve(ROOT, "brand-source");
const PUBLIC = resolve(ROOT, "public/brand");
const APP = resolve(ROOT, "src/app");
const BRICK = { r: 174, g: 44, b: 36, alpha: 1 };

/**
 * Geometría del monograma (coordenadas medidas sobre el original, origen en su esquina superior izquierda).
 * Pieza A: "L" exterior + asta central + brazos de la "F". Pieza B: "L" interior.
 */
export const MONOGRAM_VIEWBOX = "0 0 412 482";
export const MONOGRAM_PATHS = [
  "M0 114 L33 95 L35 331 L198 423 L198 1 L411 118 L410 156 L233 59 L233 205 L378 289 L378 328 L233 248 L233 481 L0 351 Z",
  "M100 57 L131 38 L133 275 L172 298 L172 336 L100 296 Z",
];

function monogramSvg(fill: string, padding = 0): string {
  const [, , w, h] = MONOGRAM_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  const vb = `${-padding} ${-padding} ${w + padding * 2} ${h + padding * 2}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Lucio López Fleming"><g fill="${fill}">${MONOGRAM_PATHS.map((d) => `<path d="${d}"/>`).join("")}</g></svg>\n`;
}

/** ICO con un PNG embebido (formato válido desde Windows Vista y en todos los navegadores). */
function pngToIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

async function main() {
  mkdirSync(resolve(PUBLIC, "photos"), { recursive: true });

  writeFileSync(resolve(PUBLIC, "monogram.svg"), monogramSvg("#ae2c25"));
  writeFileSync(resolve(PUBLIC, "monogram-white.svg"), monogramSvg("#f4f0ea"));

  // Íconos: monograma recortado del logo cuadrado original (centro ≈ 1133,947 en el original de 2359 px).
  const square = sharp(resolve(SRC, "logo-cuadrado-blanco-sobre-ladrillo.png"));
  const iconBase = await square.clone().extract({ left: 733, top: 547, width: 800, height: 800 }).png().toBuffer();
  await sharp(iconBase).resize(512, 512).png({ compressionLevel: 9 }).toFile(resolve(APP, "icon.png"));
  await sharp(iconBase).resize(180, 180).png({ compressionLevel: 9 }).toFile(resolve(APP, "apple-icon.png"));
  const fav = await sharp(iconBase).resize(48, 48).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(resolve(APP, "favicon.ico"), pngToIco(fav, 48));

  // OpenGraph por defecto: logo original completo centrado sobre ladrillo.
  const logo = await square.clone().extract({ left: 250, top: 560, width: 1860, height: 1180 }).resize({ height: 520 }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: BRICK } })
    .composite([{ input: logo, gravity: "center" }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(resolve(APP, "opengraph-image.jpg"));

  const photos: Array<[string, string, number]> = [
    ["oficina-direccion-escritorio.jpg", "oficina-escritorio.jpg", 2400],
    ["agente-trabajando-planos.jpg", "trabajo-planos.jpg", 2400],
    ["equipo-reunion-planos.png", "equipo-planos.jpg", 1366],
    ["oficina-modular-atardecer.jpg", "oficina-modular.jpg", 1200],
  ];
  for (const [from, to, width] of photos) {
    await sharp(resolve(SRC, from)).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(resolve(PUBLIC, "photos", to));
  }
  console.log("brand assets ok");
}

await main();
