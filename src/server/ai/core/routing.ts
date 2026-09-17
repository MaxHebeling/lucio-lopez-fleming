/**
 * Ruteo de modelos por tarea. Configurable sin redeploy en `settings` (`ai.model.<tarea>`, valor JSON string).
 * Solo se acepta un modelo con precio conocido en pricing.ts: si no, el gasto no se podría controlar contra el
 * presupuesto diario y se usa el valor por defecto (queda un aviso en el log).
 */
import type { Executor } from "../../db";
import { log } from "../../log";
import { priceFor } from "../pricing";
import { AI_TASKS, type AITask } from "./types";

/** Haiku 4.5 para clasificar/extraer (rápido y barato); Sonnet 5 para responder, analizar y visión. */
export const DEFAULT_MODELS: Readonly<Record<AITask, string>> = {
  classify: "claude-haiku-4-5-20251001",
  extract: "claude-haiku-4-5-20251001",
  answer: "claude-sonnet-5",
  analyze: "claude-sonnet-5",
  vision: "claude-sonnet-5",
};

const MODEL_RE = /^[a-z0-9][a-z0-9.-]{2,80}$/;

export type RouteInfo = { task: AITask; model: string; source: "setting" | "default"; rejected: string | null };

export function resolveModel(task: AITask, configured: unknown): RouteInfo {
  if (typeof configured === "string" && configured.trim()) {
    const m = configured.trim();
    if (MODEL_RE.test(m) && priceFor(m).known) return { task, model: m, source: "setting", rejected: null };
    return { task, model: DEFAULT_MODELS[task], source: "default", rejected: m.slice(0, 80) };
  }
  return { task, model: DEFAULT_MODELS[task], source: "default", rejected: null };
}

export async function modelRouting(db: Executor): Promise<Record<AITask, RouteInfo>> {
  const rows = await db
    .selectFrom("settings")
    .select(["key", "value"])
    .where("key", "in", AI_TASKS.map((t) => `ai.model.${t}`))
    .execute();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<AITask, RouteInfo>;
  for (const task of AI_TASKS) {
    const info = resolveModel(task, byKey.get(`ai.model.${task}`));
    if (info.rejected) log.warn("ai.model_setting_rejected", { task, configured: info.rejected, fallback: info.model });
    out[task] = info;
  }
  return out;
}

export async function modelFor(db: Executor, task: AITask): Promise<string> {
  return (await modelRouting(db))[task].model;
}
