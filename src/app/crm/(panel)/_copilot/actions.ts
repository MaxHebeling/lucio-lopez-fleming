"use server";

/**
 * Server Actions del «✦ Asistente IA». Solo delegan: autorización, límites, gobernanza y registro viven en
 * src/server/ai/copilot/service.ts (Next verifica el Origin de las Server Actions).
 */
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { askCopilot, getCopilotStatus, recordCopilotFeedback } from "@/server/ai/copilot/service";
import { copilotAskSchema, copilotFeedbackSchema, copilotStatusSchema, type CopilotAskInput, type CopilotFeedbackInput } from "@/server/ai/copilot/types";

export async function copilotStatusAction(input: { path?: string }) {
  return runAction("ai.copilot_status", copilotStatusSchema, input, (data, actor) => getCopilotStatus(getDb(), actor, data));
}

export async function askCopilotAction(input: CopilotAskInput) {
  return runAction("ai.copilot_ask", copilotAskSchema, input, (data, actor) => askCopilot(getDb(), actor, data));
}

export async function copilotFeedbackAction(input: CopilotFeedbackInput) {
  return runAction("ai.copilot_feedback", copilotFeedbackSchema, input, (data, actor) => recordCopilotFeedback(getDb(), actor, data));
}
