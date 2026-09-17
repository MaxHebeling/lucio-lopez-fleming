/** Imágenes sintéticas para tests (sin fotos reales ni red). */
import sharp from "sharp";

/** PRNG determinista (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "Ambiente" sintético: bloques de luz/sombra, bordes (marcos, muebles) y textura fina. Cada semilla da otra escena. */
export async function scene(seed: number, width = 960, height = 720): Promise<Buffer> {
  const r = rng(seed);
  const px = Buffer.alloc(width * height * 3);
  const blocks = Array.from({ length: 14 }, () => ({ x: r() * width, y: r() * height, w: 60 + r() * 360, h: 60 + r() * 300, c: [60 + r() * 180, 60 + r() * 180, 60 + r() * 180] }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      // Degradé de fondo (luz de ventana) + textura fina
      const base = 90 + 80 * (x / width) + (r() - 0.5) * 30;
      let c = [base, base * 0.95, base * 0.9];
      for (const b of blocks) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) c = b.c.map((v) => v + (r() - 0.5) * 24);
      if (x % 97 < 3 || y % 131 < 3) c = [30, 30, 30]; // líneas duras (marcos, zócalos)
      px[i] = Math.max(0, Math.min(255, c[0]!));
      px[i + 1] = Math.max(0, Math.min(255, c[1]!));
      px[i + 2] = Math.max(0, Math.min(255, c[2]!));
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}
