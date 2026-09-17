/**
 * Métricas deterministas de una foto (sin IA, sin red): hash perceptual para duplicadas, luminancia para oscuras y
 * varianza del Laplaciano para borrosas. Todo se calcula con `sharp` sobre los bytes de NUESTRO storage; las fotos del
 * sitio anterior (`source_only`/`verified`) nunca se descargan (ver quality.ts).
 *
 * Umbrales calibrados (tests/unit/ai-property-images.test.ts, docs/ai/PROPERTY.md › Fotos):
 * - Nitidez: con la imagen llevada a 512 px de ancho (el tamaño en el que se mira en la ficha y en redes) se calcula la
 *   varianza del Laplaciano y se divide por la varianza de luminancia, así la medida no depende de la exposición (una
 *   foto oscura pero nítida no se marca borrosa). Fotos reales nítidas: 0,32–1,88; renders suaves del tour demo:
 *   0,12–0,44; desenfoque gaussiano σ=1 a 512 px: 0,05–0,32 («suave», no se marca); σ=2: 0,007–0,037 (también
 *   oscurecidas: ≈ 0,03). Umbral 0,04. Imágenes casi uniformes (varianza de luminancia < 25) no se evalúan.
 * - Oscura: media de luminancia < 60 Y percentil 95 < 110 (fotos normales: media 100–141, p95 184–197; las mismas
 *   oscurecidas al 25 %: media 25–35, p95 46–49). Una foto nocturna real también se marca: es «posiblemente oscura».
 * - Duplicadas: dHash de 64 bits con distancia de Hamming ≤ 5 (la misma foto re-encodeada/recortada levemente da 0–3;
 *   fotos distintas del mismo ambiente, > 12).
 */
import sharp from "sharp";

export const IMAGE_METRICS_VERSION = "2026-09-17.1";

export const IMAGE_THRESHOLDS = {
  /** Distancia de Hamming máxima (sobre 64 bits) para considerar dos fotos la misma. */
  duplicateMaxDistance: 5,
  darkMeanMax: 60,
  darkP95Max: 110,
  /** Luminancia por debajo de la cual un píxel cuenta como oscuro (para el ratio informativo). */
  darkPixelLevel: 40,
  /** Cociente varianza del Laplaciano / varianza de luminancia por debajo del cual la foto se ve borrosa. */
  blurRatioMax: 0.04,
  /** Por debajo de esta varianza de luminancia la imagen es casi uniforme: la nitidez no se evalúa. */
  minLuminanceVariance: 25,
  /** Ancho de normalización para nitidez. */
  sharpnessWidth: 512,
} as const;

export type ImageMetrics = {
  width: number;
  height: number;
  dhash: string;
  luminanceMean: number;
  luminanceP95: number;
  darkPixelRatio: number;
  laplacianVariance: number;
  luminanceVariance: number;
};

const MAX_INPUT_PIXELS = 120_000_000;
const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const };

/** dHash 8×8: la imagen en grises a 9×8 y, por fila, si cada píxel es más claro que el siguiente. 16 dígitos hex. */
export async function dHash(bytes: Uint8Array): Promise<string> {
  const { data } = await sharp(Buffer.from(bytes), opts).rotate().greyscale().resize(9, 8, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x]!;
      const right = data[y * 9 + x + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export async function luminanceStats(bytes: Uint8Array): Promise<{ mean: number; p95: number; darkRatio: number }> {
  const { data } = await sharp(Buffer.from(bytes), opts).rotate().greyscale().resize({ width: 256, height: 256, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const hist = new Uint32Array(256);
  let sum = 0;
  for (const v of data) {
    hist[v]!++;
    sum += v;
  }
  const n = data.length || 1;
  let acc = 0;
  let p95 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc >= n * 0.95) {
      p95 = i;
      break;
    }
  }
  let dark = 0;
  for (let i = 0; i < IMAGE_THRESHOLDS.darkPixelLevel; i++) dark += hist[i]!;
  return { mean: round(sum / n, 2), p95, darkRatio: round(dark / n, 4) };
}

/**
 * Varianza del Laplaciano (kernel 4-vecinos con `sharp.convolve`, 16 bits con signo) y varianza de luminancia, ambas
 * sobre la imagen en grises a 512 px de ancho.
 */
export async function sharpness(bytes: Uint8Array): Promise<{ laplacianVariance: number; luminanceVariance: number }> {
  const base = sharp(Buffer.from(bytes), opts).rotate().greyscale().resize({ width: IMAGE_THRESHOLDS.sharpnessWidth, height: IMAGE_THRESHOLDS.sharpnessWidth * 4, fit: "inside" });
  const [lap, lum] = await Promise.all([
    base
      .clone()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
      .raw({ depth: "short" })
      .toBuffer({ resolveWithObject: true }),
    base.clone().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const values = new Int16Array(lap.data.buffer, lap.data.byteOffset, Math.floor(lap.data.byteLength / 2));
  return { laplacianVariance: round(variance(values), 2), luminanceVariance: round(variance(lum.data), 2) };
}

function variance(values: ArrayLike<number>): number {
  let s = 0;
  let s2 = 0;
  const n = values.length || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    s += v;
    s2 += v * v;
  }
  const mean = s / n;
  return Math.max(0, s2 / n - mean * mean);
}

export async function imageMetrics(bytes: Uint8Array): Promise<ImageMetrics> {
  const meta = await sharp(Buffer.from(bytes), opts).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const [hash, lum, sh] = await Promise.all([dHash(bytes), luminanceStats(bytes), sharpness(bytes)]);
  return {
    width: (rotated ? meta.height : meta.width) ?? 0,
    height: (rotated ? meta.width : meta.height) ?? 0,
    dhash: hash,
    luminanceMean: lum.mean,
    luminanceP95: lum.p95,
    darkPixelRatio: lum.darkRatio,
    laplacianVariance: sh.laplacianVariance,
    luminanceVariance: sh.luminanceVariance,
  };
}

export function isDark(m: Pick<ImageMetrics, "luminanceMean" | "luminanceP95">): boolean {
  return m.luminanceMean < IMAGE_THRESHOLDS.darkMeanMax && m.luminanceP95 < IMAGE_THRESHOLDS.darkP95Max;
}

export function sharpnessRatio(m: Pick<ImageMetrics, "laplacianVariance" | "luminanceVariance">): number | null {
  return m.luminanceVariance < IMAGE_THRESHOLDS.minLuminanceVariance ? null : m.laplacianVariance / m.luminanceVariance;
}

export function isBlurry(m: Pick<ImageMetrics, "laplacianVariance" | "luminanceVariance">): boolean {
  const r = sharpnessRatio(m);
  return r !== null && r < IMAGE_THRESHOLDS.blurRatioMax;
}

/**
 * Grupos de duplicadas por dHash (unión de componentes: A≈B y B≈C quedan juntas). Devuelve solo grupos de 2+,
 * con los ids en el orden recibido (el primero es el que "se queda": el de menor orden en la ficha).
 */
export function duplicateGroups(items: Array<{ id: string; dhash: string }>, maxDistance: number = IMAGE_THRESHOLDS.duplicateMaxDistance): string[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (hammingDistance(items[i]!.dhash, items[j]!.dhash) <= maxDistance) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, string[]>();
  items.forEach((it, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), it.id]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
