/** Prompts versionados de la Fase 2 · Ventas (se suman al registro central con una sola línea en registry.ts). */
import { salesConciergePrompt } from "./sales-concierge";

export const SALES_PROMPTS = {
  [salesConciergePrompt.id]: salesConciergePrompt,
} as const;
