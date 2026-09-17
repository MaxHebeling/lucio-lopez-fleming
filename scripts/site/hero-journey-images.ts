/**
 * Fotos del recorrido de la portada (docs/WEB_EXPERIENCE.md §4.1).
 *
 * - Propiedad Cód. 2605 (Club de Campo El Tipal): las fotos reales de la publicación (1024 × 768 o 768 × 1024, no
 *   existen versiones más grandes). Solo se redimensiona/comprime y se aplica un sharpen leve: nada de upscaling ni de
 *   imágenes generadas. next/image genera AVIF/WebP a partir de estas.
 *
 * Uso: pnpm tsx scripts/site/hero-journey-images.ts <carpeta con las fotos NN.jpg de la 2605 (NN = sort_order)>
 * Idempotente; los archivos generados se versionan. No descarga nada (el CDN de Adinco bloquea ráfagas).
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT_DIR = resolve(ROOT, "public/brand/journey/el-tipal-2605");

/** sort_order de la publicación → nombre del archivo. */
const PROPERTY_PHOTOS: Record<string, string> = {
  "04": "acceso",
  "05": "hall-living",
  "13": "escalera",
  "40": "ventana-arco",
  "41": "vista-balcon",
  "28": "piscina-dia",
  "32": "piscina-noche",
};

async function main() {
  const src = process.argv[2];
  if (!src || !existsSync(src)) throw new Error("Indicá la carpeta con las fotos de la propiedad 2605 (NN.jpg).");
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [order, name] of Object.entries(PROPERTY_PHOTOS)) {
    const input = resolve(src, `${order}.jpg`);
    const out = resolve(OUT_DIR, `${name}.jpg`);
    const info = await sharp(input).rotate().sharpen({ sigma: 0.55, m1: 0.6, m2: 1.2 }).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
    console.info(`${order} → ${name}.jpg ${info.width}×${info.height} ${Math.round(info.size / 1024)} KB`);
  }
}

await main();
