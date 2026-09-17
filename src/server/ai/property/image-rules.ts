/**
 * Reglas puras sobre métricas de imagen (sin sharp: se usan también en el navegador). Umbrales y calibración en
 * image-metrics.ts.
 */
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

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
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
