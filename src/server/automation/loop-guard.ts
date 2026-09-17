/**
 * Protección contra loops de automatizaciones (docs/ai/AUTOMATION.md › Loops). Reglas PURAS, testeadas:
 *
 * 1. Profundidad: un evento derivado (emitido mientras corría una automatización o un job encolado por ella) tiene
 *    `depth` = profundidad de su causa + 1. No se disparan automatizaciones sobre eventos con depth ≥ máximo.
 * 2. Misma cadena: una automatización nunca corre sobre un evento si ella misma (o sea, su clave) ya causó ese evento
 *    o cualquiera de sus ancestros. Así A → B → A se corta en la segunda A aunque no se llegue al máximo.
 */
export const DEFAULT_MAX_EVENT_DEPTH = 3;
export const MAX_EVENT_DEPTH_LIMIT = 10;

export type LoopGuardInput = {
  automationKey: string;
  depth: number;
  maxDepth: number;
  /** Automatizaciones que causaron el evento y sus ancestros (de más cercano a más lejano). */
  chainAutomations: ReadonlyArray<string | null>;
};

export type LoopGuardVerdict = { allowed: true } | { allowed: false; reason: "max_depth" | "same_chain" };

export function normalizeMaxDepth(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_EVENT_DEPTH_LIMIT ? n : DEFAULT_MAX_EVENT_DEPTH;
}

/** ¿Se encolan automatizaciones para este evento? (despacho del outbox) */
export function dispatchAllowed(depth: number, maxDepth: number): boolean {
  return depth < maxDepth;
}

export function loopGuard(i: LoopGuardInput): LoopGuardVerdict {
  if (!dispatchAllowed(i.depth, i.maxDepth)) return { allowed: false, reason: "max_depth" };
  if (i.chainAutomations.includes(i.automationKey)) return { allowed: false, reason: "same_chain" };
  return { allowed: true };
}

export const LOOP_GUARD_LABEL: Record<"max_depth" | "same_chain", string> = {
  max_depth: "protección contra loops: la cadena de eventos derivados llegó a la profundidad máxima",
  same_chain: "protección contra loops: esta automatización ya participó de la misma cadena de eventos",
};
