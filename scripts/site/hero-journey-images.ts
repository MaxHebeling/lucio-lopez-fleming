/**
 * Fotos del recorrido de la portada (docs/WEB_EXPERIENCE.md §4.1).
 *
 * - Propiedad Cód. 2605 (Club de Campo El Tipal): las fotos reales de la publicación (1024 × 768 o 768 × 1024, no
 *   existen versiones más grandes). Solo se redimensiona/comprime y se aplica un sharpen leve: nada de upscaling ni de
 *   imágenes generadas. next/image genera AVIF/WebP a partir de estas.
 * - Placeholders borrosos (≈ 300 B) de las fotos del recorrido y de las fotos de marca del recorrido de respaldo.
 *
 * Uso: pnpm tsx scripts/site/hero-journey-images.ts <carpeta con las fotos NN.jpg de la 2605 (NN = sort_order)>
 * Idempotente; los archivos generados se versionan. No descarga nada (el CDN de Adinco bloquea ráfagas).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT_DIR = resolve(ROOT, "public/brand/journey/el-tipal-2605");
const BLUR_FILE = resolve(ROOT, "src/components/experience/hero/journey-blur.ts");

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

const BRAND_PHOTOS = ["oficina-modular", "oficina-escritorio", "trabajo-planos", "equipo-planos"];

async function blur(file: string): Promise<string> {
  const buf = await sharp(file).resize(16, 16, { fit: "inside" }).webp({ quality: 50 }).toBuffer();
  return `data:image/webp;base64,${buf.toString("base64")}`;
}

async function main() {
  const src = process.argv[2];
  if (!src || !existsSync(src)) throw new Error("Indicá la carpeta con las fotos de la propiedad 2605 (NN.jpg).");
  mkdirSync(OUT_DIR, { recursive: true });
  const blurs: Record<string, string> = {};
  for (const [order, name] of Object.entries(PROPERTY_PHOTOS)) {
    const input = resolve(src, `${order}.jpg`);
    const out = resolve(OUT_DIR, `${name}.jpg`);
    const info = await sharp(input).rotate().sharpen({ sigma: 0.55, m1: 0.6, m2: 1.2 }).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
    blurs[`/brand/journey/el-tipal-2605/${name}.jpg`] = await blur(out);
    console.info(`${order} → ${name}.jpg ${info.width}×${info.height} ${Math.round(info.size / 1024)} KB`);
  }
  for (const name of BRAND_PHOTOS) blurs[`/brand/photos/${name}.jpg`] = await blur(resolve(ROOT, `public/brand/photos/${name}.jpg`));
  const body = Object.entries(blurs)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  writeFileSync(
    BLUR_FILE,
    `// Generado por scripts/site/hero-journey-images.ts: no editar a mano.\n/** Placeholders borrosos (16 px, WebP) de las fotos del recorrido de la portada, por ruta pública. */\nexport const JOURNEY_BLUR: Record<string, string> = {\n${body}\n};\n`,
  );
  console.info(`Placeholders → ${BLUR_FILE}`);
}

await main();
