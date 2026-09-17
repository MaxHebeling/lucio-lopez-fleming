/**
 * Registro central y versionado de prompts. Ningún prompt vive en componentes React ni en servicios de negocio.
 * Regla: cualquier cambio de reglas, herramientas o formato de salida incrementa `version`; cada respuesta registra
 * `id@version` (ai_interactions.prompt_version y ai_messages.prompt_ref) para comparar calidad y costo entre versiones.
 */
import type { z } from "zod";
import type { AITask } from "../core/types";
import { copilotAnalystPrompt } from "./copilot-analyst";
import { copilotAssistantPrompt } from "./copilot-assistant";
import { marketingDirectorPrompt } from "./marketing-director";
import { photoTagsPrompt } from "./photo-tags";
import { tourIntentPrompt } from "./tour-intent";
import { visitBriefPrompt, visitReportPrompt, visitThanksPrompt } from "./visits";

export type PromptDefinition<S extends z.ZodType = z.ZodType> = {
  id: string;
  version: string;
  task: AITask;
  /** Bloque estático (cacheable). El contexto del turno se arma aparte y siempre como datos. */
  system: string;
  /** Salida estructurada validada con zod (si la hay). */
  output?: S;
  notes: string;
};

export function promptRef(p: Pick<PromptDefinition, "id" | "version">): string {
  return `${p.id}@${p.version}`;
}

/** Referencia de respuestas armadas sin modelo (guía, consultas rápidas): quedan igual de trazables. */
export const DETERMINISTIC_REF = { id: "copilot.deterministic", version: "2026-09-17.1" } as const;

export const PROMPTS = {
  [copilotAssistantPrompt.id]: copilotAssistantPrompt,
  [copilotAnalystPrompt.id]: copilotAnalystPrompt,
  // Fase 3 (AI Property) y 4b (visitas)
  [photoTagsPrompt.id]: photoTagsPrompt,
  [marketingDirectorPrompt.id]: marketingDirectorPrompt,
  [tourIntentPrompt.id]: tourIntentPrompt,
  [visitBriefPrompt.id]: visitBriefPrompt,
  [visitReportPrompt.id]: visitReportPrompt,
  [visitThanksPrompt.id]: visitThanksPrompt,
} as const satisfies Record<string, PromptDefinition>;

export function listPrompts(): Array<Pick<PromptDefinition, "id" | "version" | "task" | "notes">> {
  return Object.values(PROMPTS).map(({ id, version, task, notes }) => ({ id, version, task, notes }));
}
