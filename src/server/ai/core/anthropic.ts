/**
 * Proveedor Anthropic (Claude). Reutiliza `client.ts`: cliente cacheado por clave, `awaiting_credentials` sin
 * ANTHROPIC_API_KEY, timeout por intento, reintentos acotados solo para errores reintentables y circuit breaker
 * persistido (`callIntegration` → integration_logs).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Database } from "../../db";
import { callModel, getAnthropicClient, type MessagesClient } from "../client";
import { ChatBasedProvider } from "./provider";
import type { AIChatRequest, AIChatResult, AIContentBlock, AIMessage, AIToolChoice } from "./types";

function toParam(block: AIContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    case "tool_result":
      return { type: "tool_result", tool_use_id: block.toolUseId, content: block.content, is_error: block.isError };
    case "image":
      return { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } };
  }
}

function toMessage(m: AIMessage): Anthropic.MessageParam {
  return { role: m.role, content: typeof m.content === "string" ? m.content : m.content.map(toParam) };
}

function toChoice(c: AIToolChoice): Anthropic.ToolChoice {
  return c.type === "tool" ? { type: "tool", name: c.name } : { type: c.type };
}

function fromContent(content: Anthropic.ContentBlock[]): AIContentBlock[] {
  const out: AIContentBlock[] = [];
  for (const b of content) {
    if (b.type === "text") out.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") out.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    // Otros bloques (thinking, server tools) no se usan en esta app.
  }
  return out;
}

export class AnthropicProvider extends ChatBasedProvider {
  readonly name = "anthropic";

  constructor(
    private readonly db: Database,
    private readonly client: MessagesClient,
  ) {
    super();
  }

  async chat(req: AIChatRequest): Promise<AIChatResult> {
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      // El primer bloque de sistema es estático: se marca cacheable (prompt caching).
      system: req.system.map((text, i) => (i === 0 ? { type: "text" as const, text, cache_control: { type: "ephemeral" as const } } : { type: "text" as const, text })),
      messages: req.messages.map(toMessage),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })) } : {}),
      ...(req.toolChoice ? { tool_choice: toChoice(req.toolChoice) } : {}),
      ...(req.responseSchema ? { output_config: { format: { type: "json_schema" as const, schema: req.responseSchema } } } : {}),
    };
    const message = await callModel(this.db, this.client, body, {
      timeoutMs: req.timeoutMs,
      attempts: req.attempts,
      deadline: req.deadline,
      signal: req.signal,
      entityType: req.entityType ?? "ai",
      entityId: req.entityId,
      sleep: req.sleep,
    });
    const u = message.usage;
    return {
      content: fromContent(message.content),
      stopReason: message.stop_reason,
      model: message.model || req.model,
      usage: {
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
      },
    };
  }
}

/** Proveedor real o null si falta ANTHROPIC_API_KEY (la integración queda `awaiting_credentials`). */
export async function getAnthropicProvider(db: Database, env: NodeJS.ProcessEnv = process.env): Promise<AnthropicProvider | null> {
  const client = await getAnthropicClient(db, env);
  return client ? new AnthropicProvider(db, client) : null;
}
