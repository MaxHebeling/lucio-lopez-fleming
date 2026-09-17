/**
 * Tipos neutrales del AI Core: ninguna capa de negocio importa el SDK de un proveedor.
 * El proveedor concreto (hoy Anthropic, `anthropic.ts`) traduce desde y hacia estos tipos.
 */
import type { z } from "zod";
import type { TokenUsage } from "../pricing";

export type { TokenUsage } from "../pricing";

/** Tareas de ruteo de modelo (ver routing.ts). */
export const AI_TASKS = ["classify", "extract", "answer", "analyze", "vision"] as const;
export type AITask = (typeof AI_TASKS)[number];

export type AITextBlock = { type: "text"; text: string };
export type AIToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type AIToolResultBlock = { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };
export type AIImageBlock = { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
export type AIContentBlock = AITextBlock | AIToolUseBlock | AIToolResultBlock | AIImageBlock;

export type AIMessage = { role: "user" | "assistant"; content: string | AIContentBlock[] };

/** Herramienta tal como la ve el modelo (JSON Schema de entrada). La autorización NO vive acá: ver registry.ts. */
export type AIToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type AIToolChoice = { type: "auto" } | { type: "none" } | { type: "tool"; name: string };

export type AICallOptions = {
  /** Timeout de cada intento. */
  timeoutMs?: number;
  /** Intentos máximos (solo errores reintentables). */
  attempts?: number;
  /** Hora límite (epoch ms) de toda la operación. */
  deadline?: number;
  signal?: AbortSignal;
  /** Para integration_logs (p. ej. id de la conversación del copiloto). */
  entityType?: string;
  entityId?: string;
  sleep?: (ms: number) => Promise<void>;
};

export type AIChatRequest = AICallOptions & {
  task: AITask;
  model: string;
  /** Bloques de sistema: el primero es estático (cacheable); los siguientes, contexto del turno. */
  system: string[];
  messages: AIMessage[];
  tools?: AIToolSpec[];
  toolChoice?: AIToolChoice;
  /** JSON Schema de la salida final (structured output). La validación real la hace zod en quien llama. */
  responseSchema?: Record<string, unknown>;
  maxTokens: number;
};

export type AIChatResult = { content: AIContentBlock[]; stopReason: string | null; usage: TokenUsage; model: string };

export type AIExtractRequest<S extends z.ZodType> = AICallOptions & {
  task: AITask;
  model: string;
  system: string[];
  messages: AIMessage[];
  schema: S;
  /** Nombre de la herramienta forzada que transporta la salida estructurada. */
  schemaName?: string;
  schemaDescription?: string;
  maxTokens: number;
};

export type AIExtractResult<T> = { value: T; usage: TokenUsage; model: string; stopReason: string | null };

export type AISummarizeRequest = AICallOptions & {
  task?: AITask;
  model: string;
  /** Instrucciones propias (confiables). */
  instructions: string;
  /** Texto a resumir: se envía como DATOS delimitados, nunca como instrucciones. */
  text: string;
  source: string;
  maxTokens?: number;
};

export type AIVisionRequest = AICallOptions & {
  model: string;
  instructions: string;
  images: AIImageBlock[];
  maxTokens?: number;
};

export type AITextResult = { text: string; usage: TokenUsage; model: string; stopReason: string | null };

export type AIEmbedRequest = AICallOptions & { texts: string[] };
export type AIEmbedResult = { vectors: number[][]; model: string };

/**
 * Contrato de un proveedor de modelos. `embed` es opcional: Anthropic no ofrece embeddings y la Fase 1 no los usa
 * (retrieval full-text). Agregar otro proveedor = implementar esta interfaz; nada del negocio cambia.
 */
export interface AIProvider {
  readonly name: string;
  chat(req: AIChatRequest): Promise<AIChatResult>;
  extract<S extends z.ZodType>(req: AIExtractRequest<S>): Promise<AIExtractResult<z.infer<S>>>;
  summarize(req: AISummarizeRequest): Promise<AITextResult>;
  vision(req: AIVisionRequest): Promise<AITextResult>;
  embed?(req: AIEmbedRequest): Promise<AIEmbedResult>;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
}

export function addUsage(total: TokenUsage, u: TokenUsage): void {
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
  total.cacheCreationInputTokens += u.cacheCreationInputTokens;
  total.cacheReadInputTokens += u.cacheReadInputTokens;
}

export function textOf(content: AIContentBlock[]): string {
  return content
    .filter((b): b is AITextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
