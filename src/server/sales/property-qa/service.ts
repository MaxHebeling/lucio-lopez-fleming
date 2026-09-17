/**
 * «✦ Preguntale a esta propiedad» (sitio público). Flag `ai_property_qa`, límite por IP, solo propiedades publicadas.
 * Determinista siempre; con clave y tema no reconocido, redacción con Haiku sobre los hechos publicados + guardas.
 * La pregunta no se guarda (ai_interactions: tema, capa, resultado y costo).
 */
import "server-only";
import { z } from "zod";
import type { Database, Executor } from "../../db";
import { isEnabled } from "../../flags";
import { errorFields, log } from "../../log";
import { addGroundedText, emptyFacts, findViolations } from "../../ai/guards";
import { classifyAIError } from "../../ai/core/errors";
import { redactForModel, untrustedData } from "../../ai/core/governance";
import { modelFor } from "../../ai/core/routing";
import { promptRef } from "../../ai/prompts/registry";
import { propertyQaOutputSchema, salesPropertyQaPrompt } from "../../ai/prompts/sales-property-qa";
import { getPublicPropertyBySlug, type PublicPropertyDetail } from "../../properties/public";
import { PUBLIC_CALL_TIMEOUT_MS, publicRateLimit, publicStatusFor, recordPublicUsage, resolvePublicProvider, type PublicAIDeps } from "../public-ai";
import { answerFromFacts, NOT_REGISTERED, publicFacts, suggestedQuestions, type QaAnswer } from "./answer";

export const PROPERTY_QA_FLAG = "ai_property_qa";
export const DETERMINISTIC_QA_REF = "sales.property_qa.deterministic@2026-09-17.1";

export const propertyQaInputSchema = z.object({ code: z.number().int().positive().max(9_999_999), question: z.string().trim().min(3).max(300) });

export type PropertyQaResponse = ({ status: "ok"; layer: "deterministic" | "ai" } & QaAnswer) | { status: "disabled" } | { status: "rate_limited" } | { status: "invalid" } | { status: "not_found" };

/** Ficha pública por código (solo publicadas, nunca la demo). */
export async function getPublicPropertyByCode(db: Executor, code: number): Promise<PublicPropertyDetail | null> {
  const row = await db.selectFrom("properties").select("slug").where("code", "=", code).where("is_published", "=", true).where("is_demo", "=", false).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) return null;
  const r = await getPublicPropertyBySlug(db, row.slug);
  return r.kind === "found" ? r.property : null;
}

export { suggestedQuestions };

export async function askProperty(db: Database, raw: unknown, ctx: { ip: string | null; requestId?: string | null }, deps: PublicAIDeps = {}): Promise<PropertyQaResponse> {
  if (!(await isEnabled(db, PROPERTY_QA_FLAG))) return { status: "disabled" };
  const parsed = propertyQaInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const t0 = Date.now();
  try {
    if (!(await publicRateLimit(db, "property_qa", ctx.ip))) return { status: "rate_limited" };
  } catch (e) {
    log.error("sales.property_qa_rate_limit_failed", { requestId: ctx.requestId, ...errorFields(e) });
  }
  const property = await getPublicPropertyByCode(db, parsed.data.code);
  if (!property) return { status: "not_found" };
  const det = answerFromFacts(property, parsed.data.question);
  const record = (r: Omit<Parameters<typeof recordPublicUsage>[1], "purpose" | "feature" | "task" | "latencyMs" | "requestId">) =>
    recordPublicUsage(db, { purpose: "property_qa", feature: "public.property_qa", task: "extract", latencyMs: Date.now() - t0, requestId: ctx.requestId, ...r });

  if (det.topic !== "unknown") {
    await record({ provider: "deterministic", model: "none", promptRef: DETERMINISTIC_QA_REF, status: "ok", fallbackReason: null, usage: null });
    return { status: "ok", layer: "deterministic", ...det };
  }
  const { provider, reason } = await resolvePublicProvider(db, deps);
  if (!provider) {
    await record({ provider: "deterministic", model: "none", promptRef: DETERMINISTIC_QA_REF, status: publicStatusFor(reason), fallbackReason: reason, usage: null });
    return { status: "ok", layer: "deterministic", ...det };
  }

  const prompt = salesPropertyQaPrompt;
  const model = await modelFor(db, prompt.task);
  const facts = publicFacts(property);
  const grounding = emptyFacts();
  for (const f of facts) addGroundedText(grounding, `${f.label} ${f.value}`);
  grounding.propertyCodes.add(property.code);
  const hechos = facts.map((f, i) => `H${i + 1}. ${f.label}: ${f.value}`).join("\n");
  try {
    const res = await provider.extract({
      task: prompt.task,
      model,
      system: [prompt.system],
      messages: [
        {
          role: "user",
          content: [
            `Propiedad código ${property.code} (${property.typeName}).`,
            `<hechos>\n${hechos}\n</hechos>`,
            property.description ? untrustedData("descripcion_publicada", redactForModel(property.description), 3000) : "Sin descripción publicada.",
            `Pregunta del visitante:\n${untrustedData("pregunta_visitante", redactForModel(parsed.data.question), 300)}`,
          ].join("\n\n"),
        },
      ],
      schema: propertyQaOutputSchema,
      schemaName: "responder_sobre_la_propiedad",
      schemaDescription: "Respuesta breve basada solo en los datos publicados de la ficha.",
      maxTokens: 400,
      timeoutMs: deps.callTimeoutMs ?? PUBLIC_CALL_TIMEOUT_MS,
      attempts: 1,
      deadline: Date.now() + (deps.callTimeoutMs ?? PUBLIC_CALL_TIMEOUT_MS) + 1_000,
      entityType: "site_property_qa",
    });
    const out = res.value;
    const badSource = out.sources.some((s) => s !== "descripcion" && !facts[Number(s.slice(1)) - 1]);
    const violations = findViolations(out.answer, grounding);
    // Dirección exacta oculta: nunca aparece la calle con altura (ni aunque esté en la descripción).
    const leaksAddress = property.addressHidden && /\b\d{2,5}\b/.test(out.answer) && /\b(calle|av\.?|avenida|pasaje|n[°º]|al \d)/i.test(out.answer);
    const common = { provider: provider.name, model: res.model, promptRef: promptRef(prompt), usage: res.usage };
    if (badSource || violations.length || leaksAddress) {
      log.warn("sales.property_qa_guard_blocked", { requestId: ctx.requestId, violations: violations.map((v) => v.kind), badSource, leaksAddress });
      await record({ ...common, status: "fallback", fallbackReason: "guard_blocked", guardViolations: [...violations, ...(badSource ? [{ kind: "source_id" }] : []), ...(leaksAddress ? [{ kind: "address" }] : [])] });
      return { status: "ok", layer: "deterministic", ...det };
    }
    await record({ ...common, status: "ok", fallbackReason: null });
    const used = out.sources.filter((s) => s !== "descripcion").map((s) => facts[Number(s.slice(1)) - 1]!);
    if (out.sources.includes("descripcion")) used.push({ label: "Fuente", value: "Descripción publicada" });
    return {
      status: "ok",
      layer: "ai",
      topic: "unknown",
      answer: out.registered ? out.answer : NOT_REGISTERED,
      registered: out.registered,
      facts: out.registered ? used : [],
      cta: out.cta === "none" ? (out.registered ? null : "advisor") : out.cta,
    };
  } catch (e) {
    const r = classifyAIError(e);
    log.warn("sales.property_qa_call_failed", { requestId: ctx.requestId, reason: r, ...errorFields(e) });
    await record({ provider: provider.name, model, promptRef: promptRef(prompt), status: publicStatusFor(r), fallbackReason: r, usage: null, error: (e as Error).message });
    return { status: "ok", layer: "deterministic", ...det };
  }
}
