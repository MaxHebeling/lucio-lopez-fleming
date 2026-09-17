/** Comparador del sitio: datos publicados (flag `site_compare`) y resumen redactado con clave (guardas de grounding). */
import "server-only";
import { z } from "zod";
import type { Database, Executor } from "../../db";
import { isEnabled } from "../../flags";
import { errorFields, log } from "../../log";
import { addGroundedText, emptyFacts, findViolations } from "../../ai/guards";
import { classifyAIError } from "../../ai/core/errors";
import { untrustedData } from "../../ai/core/governance";
import { modelFor } from "../../ai/core/routing";
import { promptRef } from "../../ai/prompts/registry";
import { compareSummarySchema, salesComparePrompt } from "../../ai/prompts/sales-compare";
import type { PublicPropertyDetail } from "../../properties/public";
import { getPublicPropertyByCode } from "../property-qa/service";
import { PUBLIC_CALL_TIMEOUT_MS, publicRateLimit, publicStatusFor, recordPublicUsage, resolvePublicProvider, type PublicAIDeps } from "../public-ai";
import { buildComparison, MAX_COMPARE, type Comparison } from "./build";

export const COMPARE_FLAG = "site_compare";

export async function loadComparison(db: Executor, codes: number[]): Promise<{ comparison: Comparison | null; found: PublicPropertyDetail[]; missing: number[] }> {
  const unique = [...new Set(codes)].slice(0, MAX_COMPARE);
  const results = await Promise.all(unique.map(async (code) => ({ code, p: await getPublicPropertyByCode(db, code) })));
  const found = results.flatMap((r) => (r.p ? [r.p] : []));
  const missing = results.filter((r) => !r.p).map((r) => r.code);
  return { comparison: found.length >= 2 ? buildComparison(found) : null, found, missing };
}

export const compareSummaryInputSchema = z.object({ codes: z.array(z.number().int().positive().max(9_999_999)).min(2).max(MAX_COMPARE) });

export type CompareSummaryResponse = { status: "ok"; summary: string | null; layer: "ai" | "deterministic" } | { status: "disabled" | "rate_limited" | "invalid" | "not_found" };

export async function summarizeComparison(db: Database, raw: unknown, ctx: { ip: string | null; requestId?: string | null }, deps: PublicAIDeps = {}): Promise<CompareSummaryResponse> {
  if (!(await isEnabled(db, COMPARE_FLAG))) return { status: "disabled" };
  const parsed = compareSummaryInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  if (!(await publicRateLimit(db, "compare_summary", ctx.ip))) return { status: "rate_limited" };
  const { comparison } = await loadComparison(db, parsed.data.codes);
  if (!comparison) return { status: "not_found" };
  const t0 = Date.now();
  const { provider, reason } = await resolvePublicProvider(db, deps);
  const base = { purpose: "compare_summary" as const, feature: "public.compare_summary" as const, task: salesComparePrompt.task, requestId: ctx.requestId };
  if (!provider) {
    await recordPublicUsage(db, { ...base, provider: "deterministic", model: "none", promptRef: "sales.compare.deterministic@2026-09-17.1", status: publicStatusFor(reason), fallbackReason: reason, usage: null, latencyMs: Date.now() - t0 });
    return { status: "ok", summary: null, layer: "deterministic" };
  }
  const table = comparison.rows.map((r) => `${r.label}: ${r.values.map((v, i) => `#${comparison.columns[i]!.code} ${v ?? "Sin dato"}`).join(" | ")}`).join("\n");
  const facts = emptyFacts();
  addGroundedText(facts, table);
  for (const c of comparison.columns) facts.propertyCodes.add(c.code);
  const model = await modelFor(db, salesComparePrompt.task);
  try {
    const res = await provider.extract({
      task: salesComparePrompt.task,
      model,
      system: [salesComparePrompt.system],
      messages: [{ role: "user", content: `<tabla>\n${untrustedData("tabla_comparacion", table, 6000)}\n</tabla>` }],
      schema: compareSummarySchema,
      schemaName: "resumen_comparacion",
      maxTokens: 400,
      timeoutMs: deps.callTimeoutMs ?? PUBLIC_CALL_TIMEOUT_MS,
      attempts: 1,
      deadline: Date.now() + (deps.callTimeoutMs ?? PUBLIC_CALL_TIMEOUT_MS) + 1_000,
      entityType: "site_compare",
    });
    const violations = findViolations(res.value.summary, facts);
    const common = { ...base, provider: provider.name, model: res.model, promptRef: promptRef(salesComparePrompt), usage: res.usage, latencyMs: Date.now() - t0 };
    if (violations.length) {
      log.warn("sales.compare_guard_blocked", { requestId: ctx.requestId, violations: violations.map((v) => v.kind) });
      await recordPublicUsage(db, { ...common, status: "fallback", fallbackReason: "guard_blocked", guardViolations: violations });
      return { status: "ok", summary: null, layer: "deterministic" };
    }
    await recordPublicUsage(db, { ...common, status: "ok", fallbackReason: null });
    return { status: "ok", summary: res.value.summary, layer: "ai" };
  } catch (e) {
    const r = classifyAIError(e);
    log.warn("sales.compare_call_failed", { requestId: ctx.requestId, reason: r, ...errorFields(e) });
    await recordPublicUsage(db, { ...base, provider: provider.name, model, promptRef: promptRef(salesComparePrompt), status: publicStatusFor(r), fallbackReason: r, usage: null, latencyMs: Date.now() - t0, error: (e as Error).message });
    return { status: "ok", summary: null, layer: "deterministic" };
  }
}
