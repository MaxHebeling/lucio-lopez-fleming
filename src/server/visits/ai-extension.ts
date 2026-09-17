/**
 * Puntos de extensión para la fase de IA (no implementada acá). Hoy todas devuelven null: la UI solo muestra una
 * propuesta «Revisá y confirmá» cuando exista una salida real. Nada de esto envía datos a terceros.
 *
 * Contrato para la fase siguiente (AI Core):
 * - `structureVisitReport(text)`: a partir del comentario escrito/dictado por el agente, propone los campos
 *   estructurados del informe. El agente SIEMPRE revisa y confirma (`saveVisitReport` con `confirm`).
 * - `buildVisitBrief(input)`: brief previo a la visita (propiedad, cliente, historial) para el detalle de «Mis visitas».
 * - `draftThankYouMessage(input)`: borrador de agradecimiento; reemplaza a la plantilla solo como sugerencia editable.
 */
import type { Interest } from "./rules";

export type VisitReportProposal = {
  summary: string;
  interest: Interest | null;
  positives: string | null;
  objections: string | null;
  nextStep: string | null;
  /** YYYY-MM-DDTHH:mm en hora de Salta. */
  followUpAt: string | null;
};

export type VisitBrief = { headline: string; points: string[] };

export type VisitAiExtensions = {
  structureVisitReport(text: string): Promise<VisitReportProposal | null>;
  buildVisitBrief(input: { appointmentId: string }): Promise<VisitBrief | null>;
  draftThankYouMessage(input: { appointmentId: string; template: string }): Promise<string | null>;
};

/** Implementación nula: sin IA configurada no hay propuesta (nunca una respuesta simulada). */
export const nullVisitAi: VisitAiExtensions = {
  structureVisitReport: async () => null,
  buildVisitBrief: async () => null,
  draftThankYouMessage: async () => null,
};

let current: VisitAiExtensions = nullVisitAi;

/** La fase de IA registra su implementación al iniciar (p. ej. desde src/server/ai). */
export function registerVisitAi(impl: VisitAiExtensions): void {
  current = impl;
}

export function structureVisitReport(text: string): Promise<VisitReportProposal | null> {
  return current.structureVisitReport(text);
}

export function buildVisitBrief(input: { appointmentId: string }): Promise<VisitBrief | null> {
  return current.buildVisitBrief(input);
}

export function draftThankYouMessage(input: { appointmentId: string; template: string }): Promise<string | null> {
  return current.draftThankYouMessage(input);
}
