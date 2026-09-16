/**
 * Costo estimado de una llamada a Claude, en micro-dólares (1 USD = 1.000.000).
 * Precios públicos por millón de tokens (USD/MTok) verificados el 2026-09-16 en
 * https://platform.claude.com/docs/en/about-claude/pricing — revisar al cambiar AI_MODEL.
 * Precio en USD/MTok = micro-USD por token, por eso la cuenta es directa.
 */

export type ModelPrice = { input: number; output: number; cacheWrite: number; cacheRead: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/** Modelo desconocido: se usa el precio más alto publicado para no subestimar el gasto frente al presupuesto. */
export const CONSERVATIVE_PRICE: ModelPrice = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  const exact = MODEL_PRICES[model];
  if (exact) return { price: exact, known: true };
  // Alias con sufijo de fecha (p. ej. claude-sonnet-5-20260101)
  const base = Object.keys(MODEL_PRICES).find((k) => model.startsWith(`${k}-`));
  return base ? { price: MODEL_PRICES[base]!, known: true } : { price: CONSERVATIVE_PRICE, known: false };
}

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };

export function estimateCostMicros(model: string, u: TokenUsage): number {
  const { price } = priceFor(model);
  return Math.ceil(
    u.inputTokens * price.input + u.outputTokens * price.output + u.cacheCreationInputTokens * price.cacheWrite + u.cacheReadInputTokens * price.cacheRead,
  );
}
