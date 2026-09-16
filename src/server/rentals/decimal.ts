/**
 * Aritmética exacta para dinero e índices. Nunca se usa `number` para acumular ni multiplicar montos:
 * - montos → centavos en `bigint`;
 * - índices y factores → racionales `bigint` (numerador/denominador), sin pérdida de precisión.
 *
 * Regla de redondeo (documentada): "redondeo comercial" a 2 decimales, mitad hacia arriba (half-up)
 * sobre valores positivos: 1234,565 → 1234,57 · 1234,564 → 1234,56. El factor de ajuste se MUESTRA con
 * 8 decimales, pero el monto nuevo se calcula con la razón exacta de los índices (no con el factor redondeado).
 */

export type Ratio = { n: bigint; d: bigint };

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** "1234.5" → 1234.5 como racional exacto. Acepta la salida de Postgres para numeric. */
export function parseRatio(value: string): Ratio {
  const s = value.trim();
  if (!DECIMAL.test(s)) throw new Error(`Número decimal inválido: ${value}`);
  const neg = s.startsWith("-");
  const [int, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const n = BigInt(int! + frac) * (neg ? -1n : 1n);
  return normalize({ n, d: 10n ** BigInt(frac.length) });
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function normalize(r: Ratio): Ratio {
  if (r.d === 0n) throw new Error("División por cero");
  if (r.d < 0n) r = { n: -r.n, d: -r.d };
  const g = gcd(r.n, r.d) || 1n;
  return { n: r.n / g, d: r.d / g };
}

export const ONE: Ratio = { n: 1n, d: 1n };

export function mul(a: Ratio, b: Ratio): Ratio {
  return normalize({ n: a.n * b.n, d: a.d * b.d });
}

export function div(a: Ratio, b: Ratio): Ratio {
  if (b.n === 0n) throw new Error("División por cero");
  return normalize({ n: a.n * b.d, d: a.d * b.n });
}

/** Redondeo half-up (mitad alejándose de cero) a `scale` decimales; devuelve el entero escalado. */
export function roundScaled(r: Ratio, scale: number): bigint {
  const f = 10n ** BigInt(scale);
  const num = r.n * f;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + r.d) / (2n * r.d);
  return neg ? -q : q;
}

export function scaledToString(v: bigint, scale: number): string {
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(scale + 1, "0");
  const out = scale === 0 ? abs : `${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
  return neg ? `-${out}` : out;
}

/** Racional → string con `scale` decimales (half-up). */
export function ratioToFixed(r: Ratio, scale: number): string {
  return scaledToString(roundScaled(r, scale), scale);
}

// ───────────── Dinero en centavos ─────────────

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** Valida un monto ingresado ("150000", "150000.5", "150000,50") y lo devuelve normalizado con 2 decimales. */
export function normalizeMoneyInput(raw: string): string | null {
  let s = raw.trim().replace(/\s/g, "");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  if (!MONEY.test(s)) return null;
  return centsToString(toCents(s));
}

/** Monto decimal (string de numeric o input validado) → centavos. Rechaza más de 2 decimales significativos. */
export function toCents(value: string): bigint {
  const r = parseRatio(value);
  const scaled = r.n * 100n;
  if (scaled % r.d !== 0n) throw new Error(`El monto ${value} tiene más de 2 decimales`);
  return scaled / r.d;
}

export function centsToString(c: bigint): string {
  return scaledToString(c, 2);
}

export function centsToRatio(c: bigint): Ratio {
  return normalize({ n: c, d: 100n });
}

/** monto × razón, redondeado a centavos (half-up). */
export function applyRatioToCents(cents: bigint, ratio: Ratio): bigint {
  return roundScaled(mul(centsToRatio(cents), ratio), 2);
}

/** Porcentaje (p. ej. "8.50") de un monto en centavos, redondeado a centavos (half-up). */
export function percentOfCents(cents: bigint, pct: string): bigint {
  return applyRatioToCents(cents, div(parseRatio(pct), { n: 100n, d: 1n }));
}

/**
 * Reparte `total` centavos según pesos (p. ej. porcentajes de condominio) sin perder ni inventar centavos:
 * método del mayor resto; los empates se resuelven por orden de aparición.
 */
export function allocateCents(total: bigint, weights: Ratio[]): bigint[] {
  if (!weights.length) return [];
  const sum = weights.reduce((acc, w) => ({ n: acc.n * w.d + w.n * acc.d, d: acc.d * w.d }), { n: 0n, d: 1n });
  if (sum.n <= 0n) throw new Error("Pesos inválidos");
  const exact = weights.map((w) => div(mul({ n: total, d: 1n }, w), sum)); // centavos exactos (racional)
  const floors = exact.map((e) => {
    const q = e.n / e.d;
    return e.n < 0n && e.n % e.d !== 0n ? q - 1n : q;
  });
  let remaining = total - floors.reduce((a, b) => a + b, 0n);
  const order = exact
    .map((e, i) => ({ i, rem: { n: e.n - floors[i]! * e.d, d: e.d } }))
    .sort((a, b) => {
      const diff = a.rem.n * b.rem.d - b.rem.n * a.rem.d;
      return diff > 0n ? -1 : diff < 0n ? 1 : a.i - b.i;
    });
  const out = [...floors];
  for (const o of order) {
    if (remaining <= 0n) break;
    out[o.i]! += 1n;
    remaining -= 1n;
  }
  return out;
}
