/**
 * Calificación de leads.
 * - Lectura (CRM): resumen estructurado con alcance (lead visible + contacto en alcance comercial).
 * - Job (lead.created): datos sugeridos a partir de la consulta escrita (parser determinista siempre; con clave,
 *   extracción con Haiku validada contra el catálogo y cifras del texto), siguiente acción propuesta y `lead.qualified`.
 *   Nada se confirma solo y nada se envía al cliente.
 */
import "server-only";
import type { Database, Executor } from "../../db";
import type { Actor, SystemActor } from "../../auth/actor";
import { INTEREST_LABEL } from "../../../components/crm/labels";
import { budgetStatus } from "../../ai/budget";
import { getAnthropicProvider } from "../../ai/core/anthropic";
import { classifyAIError } from "../../ai/core/errors";
import { redactForModel, untrustedData } from "../../ai/core/governance";
import type { AIProvider } from "../../ai/core/types";
import { modelFor } from "../../ai/core/routing";
import { promptRef } from "../../ai/prompts/registry";
import { conciergeExtractSchema } from "../../ai/prompts/sales-concierge";
import { salesLeadExtractPrompt } from "../../ai/prompts/sales-lead-extract";
import { loadLead } from "../../crm/entities";
import { emitEvent } from "../../events";
import { isEnabled } from "../../flags";
import { errorFields, log } from "../../log";
import { loadSalesCatalog } from "../catalog";
import { mergeIntents, normalizeAiExtract } from "../concierge";
import { intentHasFilters, type SearchIntent } from "../intent/schema";
import { parseSearchText } from "../intent/parse";
import { formatFieldValue, intentToProposals, PROFILE_FIELDS, SOURCE_LABEL, type PreferenceSource } from "../profile/fields";
import { proposePreferences } from "../profile/service";
import { proposeRecommendations } from "../nba/service";
import { loadSalesContact } from "../scope";
import { publicStatusFor, recordPublicUsage } from "../public-ai";
import { buildLeadSummary, type LeadSummary, type ProfileDisplay } from "./summary";

export async function getLeadQualification(db: Executor, actor: Actor, leadId: string): Promise<LeadSummary> {
  const lead = await loadLead(db, actor, leadId);
  const { actor: staff } = await loadSalesContact(db, actor, lead.contact_id);
  const [contact, phones, emails, source, property, prefs, types, features] = await Promise.all([
    db.selectFrom("contacts").select(["display_name"]).where("id", "=", lead.contact_id).executeTakeFirstOrThrow(),
    db.selectFrom("contact_phones").select(["is_whatsapp"]).where("contact_id", "=", lead.contact_id).execute(),
    db.selectFrom("contact_emails").select(["id"]).where("contact_id", "=", lead.contact_id).execute(),
    db.selectFrom("lead_sources").select(["name"]).where("key", "=", lead.source_key).executeTakeFirst(),
    lead.property_id ? db.selectFrom("properties").select(["code", "title"]).where("id", "=", lead.property_id).where("organization_id", "=", staff.organizationId).executeTakeFirst() : Promise.resolve(undefined),
    db.selectFrom("client_preferences").select(["field", "value", "status", "source"]).where("contact_id", "=", lead.contact_id).where("status", "in", ["confirmed", "suggested"]).execute(),
    db.selectFrom("property_types").select(["key", "name"]).execute(),
    db.selectFrom("features").select(["key", "name"]).execute(),
  ]);
  const names = { types: new Map(types.map((t) => [t.key, t.name])), features: new Map(features.map((f) => [f.key, f.name])) };
  const profile: ProfileDisplay = {};
  for (const field of PROFILE_FIELDS) {
    const row = prefs.find((p) => p.field === field && p.status === "confirmed") ?? prefs.find((p) => p.field === field);
    if (row && field !== "notes") profile[field] = { display: formatFieldValue(field, row.value, names), confirmed: row.status === "confirmed", sourceLabel: SOURCE_LABEL[row.source as PreferenceSource] ?? row.source };
  }
  return buildLeadSummary({
    name: contact.display_name,
    channels: { phone: phones.length > 0 || Boolean(lead.submitted_phone), email: emails.length > 0 || Boolean(lead.submitted_email), whatsapp: phones.some((p) => p.is_whatsapp) },
    sourceName: source?.name ?? lead.source_key,
    interestLabel: lead.operation_interest ? (INTEREST_LABEL[lead.operation_interest] ?? null) : null,
    property: property ?? null,
    profile,
  });
}

const SKIP_INTERESTS = new Set(["appraisal", "sell_my_property"]);

/** Job de calificación. Idempotente: las sugerencias repetidas no se duplican y el evento tiene dedupe por lead. */
export async function qualifyLead(db: Database, system: SystemActor, leadId: string, deps: { provider?: AIProvider | null; env?: NodeJS.ProcessEnv } = {}): Promise<{ skipped?: string; suggested: number; aiUsed: boolean; recommendations: number }> {
  if (!(await isEnabled(db, "ai_matching"))) return { skipped: "flag", suggested: 0, aiUsed: false, recommendations: 0 };
  const lead = await db.selectFrom("leads").select(["id", "organization_id", "contact_id", "message", "operation_interest"]).where("id", "=", leadId).where("deleted_at", "is", null).executeTakeFirst();
  if (!lead) return { skipped: "lead inexistente", suggested: 0, aiUsed: false, recommendations: 0 };
  if (lead.operation_interest && SKIP_INTERESTS.has(lead.operation_interest)) return { skipped: "captación", suggested: 0, aiUsed: false, recommendations: 0 };

  let suggested = 0;
  let aiUsed = false;
  const message = (lead.message ?? "").trim();
  if (message.length >= 8) {
    const catalog = await loadSalesCatalog(db);
    const det = parseSearchText(message, catalog);
    let intent: SearchIntent | null = intentHasFilters(det) ? det : null;
    const provider = deps.provider !== undefined ? deps.provider : await getAnthropicProvider(db, deps.env);
    if (provider && message.length >= 15 && !(await budgetStatus(db)).exhausted) {
      const t0 = Date.now();
      const model = await modelFor(db, salesLeadExtractPrompt.task);
      const base = { purpose: "lead_qualification" as const, feature: "sales.lead_qualification" as const, task: salesLeadExtractPrompt.task, promptRef: promptRef(salesLeadExtractPrompt) };
      try {
        const catalogData = JSON.stringify({
          tipos: catalog.types.map((t) => ({ clave: t.key, nombre: t.name })),
          localidades: catalog.localities.map((l) => ({ clave: l.slug, nombre: l.name })),
          barrios: catalog.areas.map((a) => ({ clave: a.slug, nombre: a.name, localidad: a.localityName })),
          caracteristicas: catalog.features.map((f) => ({ clave: f.key, nombre: f.name })),
        });
        const res = await provider.extract({
          task: salesLeadExtractPrompt.task,
          model,
          system: [salesLeadExtractPrompt.system],
          messages: [{ role: "user", content: `<catalogo>\n${catalogData}\n</catalogo>\n\nConsulta del cliente:\n${untrustedData("consulta_lead", redactForModel(message), 3000)}` }],
          schema: conciergeExtractSchema,
          schemaName: "necesidades_del_cliente",
          maxTokens: 500,
          timeoutMs: 15_000,
          attempts: 2,
          entityType: "lead",
          entityId: lead.id,
        });
        const { intent: ai, violations } = normalizeAiExtract(res.value, message, catalog);
        const common = { ...base, provider: provider.name, model: res.model, usage: res.usage, latencyMs: Date.now() - t0 };
        if (violations.length) await recordPublicUsage(db, { ...common, status: "fallback", fallbackReason: "guard_blocked", guardViolations: violations });
        else {
          await recordPublicUsage(db, { ...common, status: "ok", fallbackReason: null });
          const merged = mergeIntents(det, ai);
          if (intentHasFilters(merged)) intent = merged;
          aiUsed = true;
        }
      } catch (e) {
        const r = classifyAIError(e);
        log.warn("sales.lead_extract_failed", { leadId: lead.id, reason: r, ...errorFields(e) });
        await recordPublicUsage(db, { ...base, provider: provider.name, model, status: publicStatusFor(r), fallbackReason: r, usage: null, latencyMs: Date.now() - t0, error: (e as Error).message });
      }
    }
    if (intent) {
      // La consulta escrita pesa menos que un dato elegido en un formulario.
      const items = intentToProposals(intent).map((p) => ({ ...p, confidence: Math.round(p.confidence * 0.8 * 100) / 100 }));
      const r = await db.transaction().execute((trx) => proposePreferences(trx, { organizationId: lead.organization_id, contactId: lead.contact_id, source: "lead_message", items, leadId: lead.id }));
      suggested = r.proposed.length;
    }
  }

  const created = await proposeRecommendations(db, system, { organizationId: lead.organization_id, contactId: lead.contact_id, leadId: lead.id });
  await emitEvent(db, system, {
    type: "lead.qualified",
    aggregateType: "lead",
    aggregateId: lead.id,
    payload: { contactId: lead.contact_id, suggested, aiUsed, recommendations: created },
    dedupeKey: `lead.qualified:${lead.id}`,
  });
  return { suggested, aiUsed, recommendations: created.length };
}
