/** Prompts versionados de la Fase 2 · Ventas (se suman al registro central con una sola línea en registry.ts). */
import { salesComparePrompt } from "./sales-compare";
import { salesConciergePrompt } from "./sales-concierge";
import { salesLeadExtractPrompt } from "./sales-lead-extract";
import { salesPropertyQaPrompt } from "./sales-property-qa";

export const SALES_PROMPTS = {
  [salesConciergePrompt.id]: salesConciergePrompt,
  [salesPropertyQaPrompt.id]: salesPropertyQaPrompt,
  [salesComparePrompt.id]: salesComparePrompt,
  [salesLeadExtractPrompt.id]: salesLeadExtractPrompt,
} as const;
