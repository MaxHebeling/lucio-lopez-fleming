/**
 * Puntos de extensión de IA del núcleo de visitas. La implementación real vive en `src/server/ai/visits` (Fase 4b) y se
 * registra al importar `@/server/ai/visits/register`; sin registrar, todas devuelven null (nunca una respuesta simulada).
 *
 * Contrato (docs/ai/VISITS_AI.md):
 * - `buildVisitBrief`: brief previo (hechos registrados + «NO REGISTRADO»; con clave, resumen de la IA aparte).
 * - `structureVisitReport`: propuesta guardada para el texto actual del informe (se genera a pedido, con clave).
 *   El agente SIEMPRE revisa y confirma (`saveVisitReport` con `confirm`).
 * - `draftThankYouMessage`: variante guardada del agradecimiento (se genera a pedido, con clave); sin ella, la plantilla.
 * - `suggestFollowUp`: seguimiento sugerido con motivo desde el informe confirmado; la tarea se crea solo al confirmar.
 * Todas reciben el actor: la autorización (`loadVisit`) se aplica ANTES de leer datos o llamar a la IA.
 */
import type { Database } from "../db";
import type { Actor } from "../auth/actor";
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

export type VisitBriefFact = { id: string; section: "cliente" | "busca" | "pregunto" | "propiedad"; text: string };

export type VisitBrief = {
  headline: string;
  facts: VisitBriefFact[];
  notRegistered: string[];
  generatedBy: "rules" | "ai";
  /** Resumen de la IA (cita hechos) e interpretación rotulada. null sin IA. */
  ai: { points: Array<{ text: string; factIds: string[] }>; interpretation: string[] } | null;
  generatedAt: Date | null;
};

export type VisitFollowUpSuggestion = { dueAt: Date; title: string; reason: string };

export type VisitAiContext = { db: Database; actor: Actor };

export type VisitAiExtensions = {
  structureVisitReport(ctx: VisitAiContext, input: { appointmentId: string; text: string }): Promise<VisitReportProposal | null>;
  buildVisitBrief(ctx: VisitAiContext, input: { appointmentId: string }): Promise<VisitBrief | null>;
  draftThankYouMessage(ctx: VisitAiContext, input: { appointmentId: string; template: string }): Promise<string | null>;
  suggestFollowUp(ctx: VisitAiContext, input: { appointmentId: string }): Promise<VisitFollowUpSuggestion | null>;
};

/** Implementación nula: sin IA registrada no hay propuesta (nunca una respuesta simulada). */
export const nullVisitAi: VisitAiExtensions = {
  structureVisitReport: async () => null,
  buildVisitBrief: async () => null,
  draftThankYouMessage: async () => null,
  suggestFollowUp: async () => null,
};

let current: VisitAiExtensions = nullVisitAi;

/** La fase de IA registra su implementación al iniciar (src/server/ai/visits/register.ts). */
export function registerVisitAi(impl: VisitAiExtensions): void {
  current = impl;
}

export function structureVisitReport(ctx: VisitAiContext, input: { appointmentId: string; text: string }): Promise<VisitReportProposal | null> {
  return current.structureVisitReport(ctx, input);
}

export function buildVisitBrief(ctx: VisitAiContext, input: { appointmentId: string }): Promise<VisitBrief | null> {
  return current.buildVisitBrief(ctx, input);
}

export function draftThankYouMessage(ctx: VisitAiContext, input: { appointmentId: string; template: string }): Promise<string | null> {
  return current.draftThankYouMessage(ctx, input);
}

export function suggestFollowUp(ctx: VisitAiContext, input: { appointmentId: string }): Promise<VisitFollowUpSuggestion | null> {
  return current.suggestFollowUp(ctx, input);
}
