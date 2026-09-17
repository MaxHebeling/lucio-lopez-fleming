/**
 * Tareas puntuales de IA fuera del copiloto (visión de fotos, borradores de marketing, intención del tour, brief e
 * informe de visitas) sobre el MISMO AI Core: proveedor (`core/anthropic.ts` → `client.ts`), ruteo por tarea
 * (`core/routing.ts`), prompts versionados (`prompts/*`), salida estructurada con zod (`provider.extract`),
 * presupuesto diario compartido (`budget.ts`) y registro sin prompts (`core/usage.ts` → ai_interactions).
 *
 * No es otro núcleo: es el orquestador mínimo que el copiloto tiene inline, reutilizable por las funciones de la Fase 3/4b.
 * Sin clave, con presupuesto agotado o ante cualquier error, devuelve `{ ok: false, reason }` y quien llama usa su capa
 * determinista. Nunca lanza por la IA.
 */
import type { z } from "zod";
import type { Database } from "../db";
import { errorFields, log } from "../log";
import { budgetStatus } from "./budget";
import { getAnthropicProvider } from "./core/anthropic";
import { classifyAIError, type AIFailureReason } from "./core/errors";
import { modelFor } from "./core/routing";
import type { AIMessage, AIProvider, AITask, TokenUsage } from "./core/types";
import { emptyUsage } from "./core/types";
import { recordUsage, type AIPurpose, type AIStatus } from "./core/usage";
import { promptRef, type PromptDefinition } from "./prompts/registry";

export type TaskWho = { organizationId: string; userId: string | null; requestId?: string };

export type TaskDeps = {
  /** Solo tests: proveedor inyectado (null = sin clave). */
  provider?: AIProvider | null;
  env?: NodeJS.ProcessEnv;
};

let testProvider: AIProvider | null | undefined;

/** SOLO tests: fija el proveedor para las tareas (undefined = comportamiento real). */
export function setTaskProviderForTests(p: AIProvider | null | undefined): void {
  testProvider = p;
}

export type ProviderResolution = { provider: AIProvider; reason: null } | { provider: null; reason: AIFailureReason };

export async function resolveTaskProvider(db: Database, deps: TaskDeps = {}): Promise<ProviderResolution> {
  const injected = deps.provider !== undefined ? deps.provider : testProvider;
  const provider = injected !== undefined ? injected : await getAnthropicProvider(db, deps.env);
  if (!provider) return { provider: null, reason: "not_configured" };
  if ((await budgetStatus(db)).exhausted) return { provider: null, reason: "budget_exhausted" };
  return { provider, reason: null };
}

/** ¿Hay modelo disponible ahora? (para decidir si mostrar una acción con IA; sin efectos visibles). */
export async function aiAvailable(db: Database, deps: TaskDeps = {}): Promise<boolean> {
  return (await resolveTaskProvider(db, deps)).provider !== null;
}

export type TaskResult<T> =
  | { ok: true; value: T; model: string; promptRef: string; interactionId: string }
  | { ok: false; reason: AIFailureReason; promptRef: string; interactionId: string | null };

export type ExtractTask<S extends z.ZodType> = {
  db: Database;
  who: TaskWho;
  purpose: AIPurpose;
  feature: string;
  task: AITask;
  prompt: PromptDefinition<S> & { output: S };
  /** Bloques de contexto del turno (ya delimitados como datos no confiables por quien llama). */
  context?: string[];
  messages: AIMessage[];
  maxTokens: number;
  timeoutMs?: number;
  entityType?: string;
  entityId?: string;
  deps?: TaskDeps;
  /** Validación de negocio posterior a zod (grounding, ids existentes). Devolver un motivo descarta la salida. */
  verify?: (value: z.infer<S>) => { kind: string; value: string }[];
};

export async function runExtractTask<S extends z.ZodType>(t: ExtractTask<S>): Promise<TaskResult<z.infer<S>>> {
  const ref = promptRef(t.prompt);
  const t0 = Date.now();
  const res = await resolveTaskProvider(t.db, t.deps);
  const record = async (status: AIStatus, fallbackReason: AIFailureReason | null, model: string, provider: string, usage: TokenUsage, extra: { error?: string | null; violations?: Array<{ kind: string; value: string }>; stopReason?: string | null } = {}) =>
    recordUsage(t.db, {
      actor: t.who,
      purpose: t.purpose,
      feature: t.feature,
      task: t.task,
      provider,
      model,
      promptRef: ref,
      status,
      fallbackReason,
      usage,
      latencyMs: Date.now() - t0,
      rounds: provider === "deterministic" ? 0 : 1,
      stopReason: extra.stopReason ?? null,
      tools: [],
      guardViolations: extra.violations,
      error: extra.error ?? null,
    }).catch((e) => {
      log.error("ai.task_usage_record_failed", { feature: t.feature, ...errorFields(e) });
      return null;
    });

  if (!res.provider) {
    // Sin clave no se registra cada intento (sería ruido en cada pantalla); presupuesto agotado sí.
    const id = res.reason === "budget_exhausted" ? await record("budget_exceeded", "budget_exhausted", "none", "deterministic", emptyUsage()) : null;
    return { ok: false, reason: res.reason, promptRef: ref, interactionId: id };
  }
  const model = await modelFor(t.db, t.task);
  try {
    const out = await res.provider.extract({
      task: t.task,
      model,
      system: [t.prompt.system, ...(t.context ?? [])],
      messages: t.messages,
      schema: t.prompt.output,
      maxTokens: t.maxTokens,
      timeoutMs: t.timeoutMs ?? 20_000,
      attempts: 2,
      deadline: Date.now() + 45_000,
      entityType: t.entityType ?? `ai_${t.purpose}`,
      entityId: t.entityId,
    });
    const violations = t.verify?.(out.value) ?? [];
    if (violations.length) {
      log.warn("ai.task_guard_blocked", { feature: t.feature, kinds: violations.map((v) => v.kind) });
      const id = await record("blocked", "guard_blocked", out.model, res.provider.name, out.usage, { violations, stopReason: out.stopReason });
      return { ok: false, reason: "guard_blocked", promptRef: ref, interactionId: id };
    }
    const id = await record("ok", null, out.model, res.provider.name, out.usage, { stopReason: out.stopReason });
    return { ok: true, value: out.value, model: out.model, promptRef: ref, interactionId: id ?? "" };
  } catch (e) {
    const reason = classifyAIError(e);
    log.warn("ai.task_failed", { feature: t.feature, reason, ...errorFields(e) });
    const status: AIStatus = reason === "invalid_output" ? "invalid_output" : reason === "timeout" ? "timeout" : reason === "rate_limited" ? "rate_limited" : "error";
    const id = await record(status, reason, model, res.provider.name, emptyUsage(), { error: (e as Error).message });
    return { ok: false, reason, promptRef: ref, interactionId: id };
  }
}
