/**
 * Doble de prueba del proveedor de IA (SOLO tests). Implementa la abstracción AIProvider sobre `chat` con respuestas
 * guionadas; registra cada pedido para verificar qué se le mandó al modelo.
 */
import { ChatBasedProvider } from "@/server/ai/core/provider";
import type { AIChatRequest, AIChatResult, AIContentBlock } from "@/server/ai/core/types";

export type Scripted = AIChatResult | Error | ((req: AIChatRequest) => AIChatResult);

export const USAGE = { inputTokens: 900, outputTokens: 120, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export class FakeProvider extends ChatBasedProvider {
  readonly name = "fake";
  readonly calls: AIChatRequest[] = [];
  constructor(private readonly script: Scripted[]) {
    super();
  }
  async chat(req: AIChatRequest): Promise<AIChatResult> {
    this.calls.push(structuredClone({ ...req, signal: undefined, sleep: undefined }));
    const next = this.script.shift();
    if (!next) throw new Error("FakeProvider: sin respuesta guionada");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(req) : next;
  }
}

export function result(content: AIContentBlock[], stopReason = "end_turn", model = "claude-sonnet-5"): AIChatResult {
  return { content, stopReason, usage: USAGE, model };
}

let seq = 0;
export function toolCall(name: string, input: Record<string, unknown> = {}): AIChatResult {
  return result([{ type: "tool_use", id: `toolu_${++seq}`, name, input }], "tool_use");
}

/** Salida estructurada del modo Asistente (tool forzada). */
export function assistantAnswer(value: Record<string, unknown>): AIChatResult {
  return result([{ type: "tool_use", id: `toolu_${++seq}`, name: "responder_con_la_guia", input: value }], "tool_use");
}

/** Salida final (JSON) del modo Analista. */
export function analystFinal(value: Record<string, unknown> | string): AIChatResult {
  return result([{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }]);
}
