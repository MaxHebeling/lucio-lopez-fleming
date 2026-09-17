/**
 * «Contanos qué buscás» (sitio público, anónimo). Convierte texto en filtros REALES del buscador y explica qué entendió.
 *
 *   1. Flag `ai_concierge` + validación + límite por IP.
 *   2. Capa determinista (intent/parse.ts) contra el catálogo real. Funciona siempre, sin clave.
 *   3. Con clave (y presupuesto público): SOLO si la capa determinista dejó algo sin interpretar o no encontró filtros,
 *      extracción con Haiku (`sales.concierge`). La salida se valida con zod, se normaliza contra el catálogo y toda cifra
 *      tiene que aparecer en el texto. Inválida, caída o con cifras inventadas → queda la determinista.
 *   4. El modelo NUNCA genera resultados: los resultados son el listado real con esos filtros.
 *   5. Registro sin texto (ai_interactions: función, capa, resultado, costo). El texto no se guarda en ningún lado.
 */
import "server-only";
import { z } from "zod";
import type { Database } from "../db";
import { isEnabled } from "../flags";
import { errorFields, log } from "../log";
import { extractAnyNumbers } from "../ai/guards";
import { classifyAIError, type AIFailureReason } from "../ai/core/errors";
import { redactForModel, untrustedData } from "../ai/core/governance";
import { modelFor } from "../ai/core/routing";
import { conciergeExtractSchema, salesConciergePrompt, type ConciergeExtract } from "../ai/prompts/sales-concierge";
import { promptRef } from "../ai/prompts/registry";
import { loadSalesCatalog } from "./catalog";
import { intentChips, intentToFilters, listingHref, type IntentChip } from "./intent/filters";
import { parseSearchText, fold, MAX_CONCIERGE_TEXT, type ParseResult } from "./intent/parse";
import { intentHasFilters, type IntentLocation, type SalesCatalog, type SearchIntent } from "./intent/schema";
import { PUBLIC_CALL_TIMEOUT_MS, publicRateLimit, publicStatusFor, recordPublicUsage, resolvePublicProvider, type PublicAIDeps } from "./public-ai";

export const CONCIERGE_FLAG = "ai_concierge";
export const DETERMINISTIC_CONCIERGE_REF = "sales.concierge.deterministic@2026-09-17.1";

export const conciergeInputSchema = z.object({ text: z.string().trim().min(2).max(MAX_CONCIERGE_TEXT) });

export type ConciergeResponse =
  | {
      status: "ok";
      layer: "deterministic" | "ai";
      intent: SearchIntent;
      filters: ReturnType<typeof intentToFilters>;
      href: string;
      chips: IntentChip[];
      unparsed: string[];
      ambiguousAmount: SearchIntent["ambiguousAmount"];
      /** Monto sin moneda: el mismo listado interpretándolo en dólares o en pesos (la persona elige). */
      ambiguousLinks: { usd: string; ars: string } | null;
      /** Parece un propietario que quiere vender/tasar (no una búsqueda). */
      ownerHint: boolean;
      hasFilters: boolean;
    }
  | { status: "disabled" }
  | { status: "rate_limited" }
  | { status: "invalid" };

// ───────────────────────── Normalización de la salida del modelo ─────────────────────────

const sourcedAi = <T>(value: T) => ({ value, origin: "ai" as const, confidence: 0.75, evidence: null });

/** Números (con multiplicadores y números en palabras chicos) presentes en el texto de la persona. */
function textNumbers(text: string): Set<number> {
  const folded = fold(text).replace(/\blucas?\b/g, "mil").replace(/\bpalos?\b/g, "millones");
  const out = new Set<number>(extractAnyNumbers(folded));
  const words: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  for (const w of fold(text).split(/[^a-z0-9]+/)) if (words[w]) out.add(words[w]);
  // «N ambientes» → N − 1 dormitorios; «lucas/palos»: extractAnyNumbers ya multiplica mil/millón.
  for (const m of fold(text).matchAll(/(\d{1,2})\s*amb/g)) out.add(Number(m[1]) - 1);
  return out;
}

/**
 * Salida del modelo → intención validada. Descarta claves fuera del catálogo y cifras que no están en el texto.
 * Devuelve null si el modelo inventó cifras (se registra como guarda y se usa la capa determinista).
 */
export function normalizeAiExtract(out: ConciergeExtract, text: string, catalog: SalesCatalog): { intent: SearchIntent; violations: Array<{ kind: string }> } {
  const violations: Array<{ kind: string }> = [];
  const nums = textNumbers(text);
  const grounded = (n: number | null, kind: string, scale = [1]) => {
    if (n === null) return null;
    if (scale.some((s) => nums.has(n / s))) return n;
    violations.push({ kind });
    return null;
  };
  const typeKeys = new Set(catalog.types.map((t) => t.key));
  const featureKeys = new Set(catalog.features.map((f) => f.key));
  const locations = out.locations.flatMap((slug): IntentLocation[] => {
    const area = catalog.areas.filter((a) => a.slug === slug);
    if (area.length) return area.map((a) => ({ kind: "area" as const, slug: a.slug, name: `${a.name}, ${a.localityName}`, localitySlug: a.localitySlug }));
    const loc = catalog.localities.find((l) => l.slug === slug);
    return loc ? [{ kind: "locality" as const, slug: loc.slug, name: loc.name, localitySlug: null }] : [];
  });
  const types = [...new Set(out.propertyTypes.filter((k) => typeKeys.has(k)))];
  const features = [...new Set(out.features.filter((k) => featureKeys.has(k)))];
  const budgetMin = grounded(out.budgetMin, "amount");
  const budgetMax = grounded(out.budgetMax, "amount");
  const bedrooms = out.bedrooms === null ? null : out.bedrooms === 0 || nums.has(out.bedrooms) ? out.bedrooms : (violations.push({ kind: "bedrooms" }), null);
  const bathrooms = out.bathrooms === null ? null : nums.has(out.bathrooms) ? out.bathrooms : (violations.push({ kind: "bathrooms" }), null);
  const garages = out.garages === null ? null : out.garages === 1 || nums.has(out.garages) ? out.garages : (violations.push({ kind: "garages" }), null);
  const surfaceMin = grounded(out.surfaceMin, "area", [1, 10_000]);
  const surfaceMax = grounded(out.surfaceMax, "area", [1, 10_000]);
  const intent: SearchIntent = {
    transactionType: out.transactionType ? sourcedAi(out.transactionType) : null,
    propertyTypes: types.length ? sourcedAi(types.slice(0, 4)) : null,
    budgetMin: budgetMin && out.currency ? sourcedAi(budgetMin) : null,
    budgetMax: budgetMax && out.currency ? sourcedAi(budgetMax) : null,
    currency: out.currency && (budgetMin || budgetMax) ? sourcedAi(out.currency) : null,
    locations: locations.length ? sourcedAi(locations.slice(0, 4)) : null,
    bedrooms: bedrooms !== null ? sourcedAi(bedrooms) : null,
    bathrooms: bathrooms !== null ? sourcedAi(bathrooms) : null,
    surface: surfaceMin || surfaceMax ? sourcedAi({ min: surfaceMin, max: surfaceMax }) : null,
    garages: garages !== null ? sourcedAi(garages) : null,
    features: features.length ? sourcedAi(features.slice(0, 12)) : null,
    moveTimeframe: out.moveTimeframe ? sourcedAi(out.moveTimeframe) : null,
    financing: out.financing ? sourcedAi(out.financing) : null,
    preferences: [...new Set(out.preferences)],
    ambiguousAmount: !out.currency && (budgetMin || budgetMax) ? { min: budgetMin, max: budgetMax } : null,
    unparsed: out.unparsed.map((u) => u.slice(0, 60)).slice(0, 5),
  };
  return { intent, violations };
}

/** Combina: lo literal de la capa determinista manda; el modelo completa lo que faltaba. */
export function mergeIntents(det: SearchIntent, ai: SearchIntent): SearchIntent {
  const pick = <K extends keyof SearchIntent>(k: K) => (det[k] && (det[k] as { origin?: string }).origin === "text" ? det[k] : (ai[k] ?? det[k]));
  const merged: SearchIntent = {
    transactionType: pick("transactionType"),
    propertyTypes: pick("propertyTypes"),
    budgetMin: det.currency ? det.budgetMin : ai.budgetMin,
    budgetMax: det.currency ? det.budgetMax : ai.budgetMax,
    currency: det.currency ?? ai.currency,
    locations: pick("locations"),
    bedrooms: pick("bedrooms"),
    bathrooms: pick("bathrooms"),
    surface: pick("surface"),
    garages: pick("garages"),
    features: det.features || ai.features ? { ...(det.features ?? ai.features)!, value: [...new Set([...(det.features?.value ?? []), ...(ai.features?.value ?? [])])].slice(0, 12) } : null,
    moveTimeframe: pick("moveTimeframe"),
    financing: pick("financing"),
    preferences: [...new Set([...det.preferences, ...ai.preferences])],
    ambiguousAmount: det.currency || ai.currency ? null : (det.ambiguousAmount ?? ai.ambiguousAmount),
    unparsed: ai.unparsed,
  };
  return merged;
}

// ───────────────────────── Servicio ─────────────────────────

function response(intent: SearchIntent, catalog: SalesCatalog, layer: "deterministic" | "ai", ownerHint: boolean): ConciergeResponse {
  const filters = intentToFilters(intent);
  const amount = intent.ambiguousAmount;
  const withCurrency = (moneda: "USD" | "ARS") => listingHref({ ...filters, moneda, ...(amount?.min ? { precio_min: amount.min } : {}), ...(amount?.max ? { precio_max: amount.max } : {}) });
  return {
    ambiguousLinks: amount ? { usd: withCurrency("USD"), ars: withCurrency("ARS") } : null,
    status: "ok",
    layer,
    intent,
    filters,
    href: listingHref(filters),
    chips: intentChips(intent, catalog),
    unparsed: intent.unparsed,
    ambiguousAmount: intent.ambiguousAmount,
    ownerHint,
    hasFilters: intentHasFilters(intent),
  };
}

export async function interpretSearch(db: Database, raw: unknown, ctx: { ip: string | null; requestId?: string | null }, deps: PublicAIDeps = {}): Promise<ConciergeResponse> {
  if (!(await isEnabled(db, CONCIERGE_FLAG))) return { status: "disabled" };
  const parsed = conciergeInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const text = parsed.data.text;
  const t0 = Date.now();

  let limited = false;
  try {
    limited = !(await publicRateLimit(db, "concierge", ctx.ip));
  } catch (e) {
    // Fail-open: la capa determinista es barata; sin límite confiable tampoco se llama al modelo.
    log.error("sales.concierge_rate_limit_failed", { requestId: ctx.requestId, ...errorFields(e) });
    limited = false;
  }
  if (limited) return { status: "rate_limited" };

  const catalog = await loadSalesCatalog(db);
  const det: ParseResult = parseSearchText(text, catalog);
  const { ownerHint, ...detIntent } = det;
  const needsModel = detIntent.unparsed.length > 0 || !intentHasFilters(detIntent);

  let reason: AIFailureReason | null = null;
  let provider: Awaited<ReturnType<typeof resolvePublicProvider>>["provider"] = null;
  if (needsModel) ({ provider, reason } = await resolvePublicProvider(db, deps));
  if (!needsModel || !provider) {
    await recordPublicUsage(db, {
      purpose: "concierge",
      feature: "public.concierge",
      task: "extract",
      provider: "deterministic",
      model: "none",
      promptRef: DETERMINISTIC_CONCIERGE_REF,
      status: publicStatusFor(needsModel ? reason : null),
      fallbackReason: needsModel ? reason : null,
      usage: null,
      latencyMs: Date.now() - t0,
      requestId: ctx.requestId,
    });
    return response(detIntent, catalog, "deterministic", ownerHint);
  }

  const prompt = salesConciergePrompt;
  const model = await modelFor(db, prompt.task);
  const catalogData = JSON.stringify({
    tipos: catalog.types.map((t) => ({ clave: t.key, nombre: t.name })),
    localidades: catalog.localities.map((l) => ({ clave: l.slug, nombre: l.name })),
    barrios: catalog.areas.map((a) => ({ clave: a.slug, nombre: a.name, localidad: a.localityName })),
    caracteristicas: catalog.features.map((f) => ({ clave: f.key, nombre: f.name })),
  });
  try {
    const res = await provider.extract({
      task: prompt.task,
      model,
      system: [prompt.system],
      messages: [{ role: "user", content: `<catalogo>\n${catalogData}\n</catalogo>\n\nTexto de la persona:\n${untrustedData("busqueda_sitio", redactForModel(text), MAX_CONCIERGE_TEXT)}` }],
      schema: conciergeExtractSchema,
      schemaName: "filtros_de_busqueda",
      schemaDescription: "Filtros de búsqueda extraídos del texto, solo con claves del catálogo.",
      maxTokens: 500,
      timeoutMs: deps.callTimeoutMs ?? PUBLIC_CALL_TIMEOUT_MS,
      attempts: 1,
      deadline: Date.now() + (deps.callTimeoutMs ?? PUBLIC_CALL_TIMEOUT_MS) + 1_000,
      entityType: "site_concierge",
    });
    const { intent: aiIntent, violations } = normalizeAiExtract(res.value, text, catalog);
    const common = { purpose: "concierge" as const, feature: "public.concierge" as const, task: prompt.task, provider: provider.name, model: res.model, promptRef: promptRef(prompt), usage: res.usage, latencyMs: Date.now() - t0, requestId: ctx.requestId };
    if (violations.length) {
      log.warn("sales.concierge_guard_blocked", { requestId: ctx.requestId, violations: violations.map((v) => v.kind) });
      await recordPublicUsage(db, { ...common, status: "fallback", fallbackReason: "guard_blocked", guardViolations: violations });
      return response(detIntent, catalog, "deterministic", ownerHint);
    }
    await recordPublicUsage(db, { ...common, status: "ok", fallbackReason: null });
    return response(mergeIntents(detIntent, aiIntent), catalog, "ai", ownerHint);
  } catch (e) {
    const r = classifyAIError(e);
    log.warn("sales.concierge_call_failed", { requestId: ctx.requestId, reason: r, ...errorFields(e) });
    await recordPublicUsage(db, { purpose: "concierge", feature: "public.concierge", task: prompt.task, provider: provider.name, model, promptRef: promptRef(prompt), status: publicStatusFor(r), fallbackReason: r, usage: null, latencyMs: Date.now() - t0, error: (e as Error).message, requestId: ctx.requestId });
    return response(detIntent, catalog, "deterministic", ownerHint);
  }
}
