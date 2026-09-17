/**
 * Reacciones de IA (Fase 6) sobre eventos de negocio: acciones de automatización de SISTEMA, idempotentes y sin
 * efectos hacia afuera. Nada se envía a clientes ni se publica: solo sugerencias en «Tareas sugeridas», borradores y
 * datos del perfil SUGERIDOS. Registradas en src/server/jobs/handlers.ts (vía ./jobs). Flag `ai_automations`.
 *
 * Garantías (docs/ai/AUTOMATION.md):
 * - Idempotencia: el motor corre una vez por (automatización, evento) y todo lo que escriben estas acciones es upsert
 *   por clave natural (sugerencia por entidad+regla+huella, borrador por propiedad+canal+hash, preferencia por valor).
 * - Reintentos: job `automation.run` con backoff (5 intentos) → dead + aviso a administración (runner existente).
 * - Loops: corren con la causa del evento; lo que emiten queda marcado como derivado y el motor no vuelve a dispararlas
 *   en la misma cadena (src/server/automation/loop-guard.ts). Ninguna escucha eventos `ai.*`.
 */
import "server-only";
import { sql } from "../../db";
import { registerAction, type ActionContext } from "../../automation/actions";
import { AppError } from "../../errors";
import { isEnabled } from "../../flags";
import { errorFields, log } from "../../log";
import { generateMarketingDrafts, MARKETING_FLAG } from "../property/marketing-director";
import { loadSalesCatalog } from "../../sales/catalog";
import { mergeIntents, normalizeAiExtract } from "../../sales/concierge";
import { parseSearchText } from "../../sales/intent/parse";
import { intentHasFilters, type SalesCatalog, type SearchIntent } from "../../sales/intent/schema";
import { intentToProposals } from "../../sales/profile/fields";
import { proposePreferences } from "../../sales/profile/service";
import { redactForModel, untrustedData } from "../core/governance";
import { salesLeadExtractPrompt } from "../prompts/sales-lead-extract";
import { aiAvailable, runExtractTask } from "../run-task";
import { markBriefsStale } from "../brief/cache";
import { collectVisits } from "../task-center/collectors";
import { suggestionFingerprint } from "../task-center/rules";
import { refreshContactSuggestions, upsertSuggestions } from "../task-center/service";

export const AI_AUTOMATIONS_FLAG = "ai_automations";

export const AI_REACTION_ACTIONS = ["ai_react_visit_finished", "ai_react_property_published", "ai_react_lead_created", "ai_react_report_confirmed"] as const;

const UUID = /^[0-9a-f-]{36}$/i;

async function enabled(ctx: ActionContext): Promise<boolean> {
  return isEnabled(ctx.db, AI_AUTOMATIONS_FLAG);
}

// ───────────────────────────── appointment.finished ─────────────────────────────

export async function reactVisitFinished(ctx: ActionContext) {
  if (!(await enabled(ctx))) return { skipped: "flag" };
  if (ctx.event.aggregateType !== "appointment" || !UUID.test(ctx.event.aggregateId)) return { skipped: "no es una visita" };
  const v = await ctx.db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .select(["a.id", "a.kind", "a.status", "a.contact_id", "a.assigned_user_id"])
    .where("a.id", "=", ctx.event.aggregateId)
    .where("u.organization_id", "=", ctx.actor.organizationId)
    .executeTakeFirst();
  if (!v || v.kind !== "visit" || v.status !== "completed") return { skipped: "visita inexistente o no finalizada" };
  // Cierre de la visita: cargar el informe (el brief previo queda como resumen; con clave, la IA propone los campos a
  // partir del comentario del agente), preparar el agradecimiento y, con informe confirmado, el seguimiento.
  const collected = await collectVisits(ctx.db, ctx.actor.organizationId, new Date(), { appointmentId: v.id });
  const visit = await upsertSuggestions(ctx.db, ctx.actor, "visit", collected.candidates);
  // Señales y siguiente acción del cliente con la visita ya realizada.
  const sales = v.contact_id ? await refreshContactSuggestions(ctx.db, ctx.actor, [v.contact_id]) : null;
  await markBriefsStale(ctx.db, [v.assigned_user_id]);
  return { visitSuggestions: collected.candidates.map((c) => c.ruleKey), created: visit?.created ?? 0, salesSuggestions: sales?.seen ?? 0 };
}

// ───────────────────────────── property.published ─────────────────────────────

export async function reactPropertyPublished(ctx: ActionContext) {
  if (!(await enabled(ctx))) return { skipped: "flag" };
  if (ctx.event.aggregateType !== "property" || !UUID.test(ctx.event.aggregateId)) return { skipped: "no es una propiedad" };
  const p = await ctx.db
    .selectFrom("properties")
    .select(["id", "code", "is_published", "is_demo", "published_at"])
    .where("id", "=", ctx.event.aggregateId)
    .where("organization_id", "=", ctx.actor.organizationId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!p || !p.is_published || p.is_demo) return { skipped: "no publicada" };
  // El match inverso NO se hace acá: ya lo hace la automatización `sales_match_property_published` (Fase 2).
  if (!(await isEnabled(ctx.db, MARKETING_FLAG))) return { skipped: "director de marketing apagado", matching: "sales_match_property_published" };
  let drafts = { created: 0, updated: 0 };
  try {
    // Solo plantillas con datos reales (sin costo de IA): la redacción con IA sigue siendo a pedido desde la ficha.
    const r = await generateMarketingDrafts(ctx.db, ctx.actor, { propertyId: p.id, mode: "template" });
    drafts = { created: r.created, updated: r.updated };
  } catch (e) {
    if (e instanceof AppError && (e.code === "forbidden" || e.code === "not_found" || e.code === "unavailable")) return { skipped: e.message };
    throw e;
  }
  const open = await sql<{ n: number }>`
    select ((select count(*) from property_marketing_drafts d where d.property_id = ${p.id} and d.status = 'draft')
          + (select count(*) from social_posts s where s.property_id = ${p.id} and s.status in ('draft', 'in_review')))::int as n`.execute(ctx.db);
  const n = open.rows[0]?.n ?? 0;
  if (!n) return { drafts, suggestion: false };
  const agent = await sql<{ user_id: string }>`
    select pa.user_id from property_agents pa join users u on u.id = pa.user_id
     where pa.property_id = ${p.id} and pa.role = 'lead' and u.is_active and u.deleted_at is null`.execute(ctx.db);
  const assignedUserId = agent.rows[0]?.user_id ?? null;
  const s = await upsertSuggestions(ctx.db, ctx.actor, "marketing", [
    {
      source: "marketing",
      ruleKey: "marketing_review",
      entityType: "property",
      entityId: p.id,
      assignedUserId,
      priority: "low",
      title: `Revisar los borradores de marketing de #${p.code}`,
      reason: "Se publicó la propiedad y quedaron borradores (SEO, redes, WhatsApp, email y guion de Reel) armados solo con los datos de la ficha. Nada se publica ni se envía sin una persona.",
      evidence: ["Propiedad publicada", `${n} ${n === 1 ? "borrador abierto" : "borradores abiertos"}`],
      link: `/crm/propiedades/${p.id}#marketing`,
      fingerprint: suggestionFingerprint(["marketing_review", p.id, p.published_at?.toISOString() ?? ""]),
      task: { kind: "task", title: `Revisar y aprobar los borradores de marketing de #${p.code}`, dueInHours: 48, priority: "normal" },
    },
  ]);
  await markBriefsStale(ctx.db, [assignedUserId]);
  return { drafts, suggestion: true, created: s?.created ?? 0 };
}

// ───────────────────────────── lead.created ─────────────────────────────

export async function reactLeadCreated(ctx: ActionContext) {
  if (!(await enabled(ctx))) return { skipped: "flag" };
  if (ctx.event.aggregateType !== "lead" || !UUID.test(ctx.event.aggregateId)) return { skipped: "no es un lead" };
  const lead = await ctx.db
    .selectFrom("leads")
    .select(["id", "contact_id", "assigned_user_id", "operation_interest"])
    .where("id", "=", ctx.event.aggregateId)
    .where("organization_id", "=", ctx.actor.organizationId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!lead) return { skipped: "lead inexistente" };
  // La calificación (resumen, datos sugeridos) la hace `sales_lead_qualify`; acá solo la bandeja del agente.
  const r = await refreshContactSuggestions(ctx.db, ctx.actor, [lead.contact_id]);
  const high = await ctx.db
    .selectFrom("sales_recommendations")
    .select(["rule_key", "priority"])
    .where("contact_id", "=", lead.contact_id)
    .where("source", "=", "sales_nba")
    .where("status", "=", "open")
    .execute();
  await markBriefsStale(ctx.db, [lead.assigned_user_id]);
  return { suggestions: r?.seen ?? 0, highIntent: high.some((h) => h.rule_key === "contact_today"), highPriority: high.filter((h) => h.priority === "high").length };
}

// ───────────────────────────── visit.report_confirmed ─────────────────────────────

const REPORT_CONFIDENCE = 0.7;

function parseReport(texts: string[], catalog: SalesCatalog): SearchIntent | null {
  let intent: SearchIntent | null = null;
  for (const t of texts) {
    const det = parseSearchText(t, catalog);
    if (!intentHasFilters(det)) continue;
    intent = intent ? mergeIntents(intent, det) : det;
  }
  return intent;
}

export async function reactReportConfirmed(ctx: ActionContext) {
  if (!(await enabled(ctx))) return { skipped: "flag" };
  if (ctx.event.aggregateType !== "appointment" || !UUID.test(ctx.event.aggregateId)) return { skipped: "no es una visita" };
  const v = await ctx.db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .innerJoin("appointment_reports as r", "r.appointment_id", "a.id")
    .select(["a.id", "a.contact_id", "a.assigned_user_id", "r.status", "r.body", "r.positives", "r.objections", "r.next_step"])
    .where("a.id", "=", ctx.event.aggregateId)
    .where("u.organization_id", "=", ctx.actor.organizationId)
    .executeTakeFirst();
  if (!v || v.status !== "confirmed") return { skipped: "informe no confirmado" };

  let proposed = 0;
  let aiUsed = false;
  if (v.contact_id && (await isEnabled(ctx.db, "ai_matching"))) {
    const texts = [v.next_step, v.positives, v.objections, v.body].filter((t): t is string => Boolean(t && t.trim().length >= 8));
    const catalog = await loadSalesCatalog(ctx.db);
    let intent = parseReport(texts, catalog);
    const full = texts.join("\n").slice(0, 3000);
    if (full.length >= 15 && (await aiAvailable(ctx.db))) {
      // El informe es texto escrito por una persona sobre un cliente: viaja minimizado y como DATOS no confiables.
      const res = await runExtractTask({
        db: ctx.db,
        who: { organizationId: ctx.actor.organizationId, userId: null },
        purpose: "visit_report_profile",
        feature: "ai.visit_report_profile",
        task: salesLeadExtractPrompt.task,
        prompt: salesLeadExtractPrompt,
        context: [`<catalogo>\n${JSON.stringify({ tipos: catalog.types.map((t) => ({ clave: t.key, nombre: t.name })), localidades: catalog.localities.map((l) => ({ clave: l.slug, nombre: l.name })), caracteristicas: catalog.features.map((f) => ({ clave: f.key, nombre: f.name })) })}\n</catalogo>`],
        messages: [{ role: "user", content: `Informe de una visita (lo que el cliente dijo que busca):\n${untrustedData("informe_visita", redactForModel(full), 3000)}` }],
        maxTokens: 500,
        timeoutMs: 15_000,
        entityType: "appointment",
        entityId: v.id,
        verify: (out) => normalizeAiExtract(out, full, catalog).violations.map((x) => ({ kind: x.kind, value: "" })),
      });
      if (res.ok) {
        const ai = normalizeAiExtract(res.value, full, catalog).intent;
        const merged = intent ? mergeIntents(intent, ai) : ai;
        if (intentHasFilters(merged)) intent = merged;
        aiUsed = true;
      }
    }
    if (intent) {
      const items = intentToProposals(intent).map((p) => ({ ...p, confidence: Math.round(p.confidence * REPORT_CONFIDENCE * 100) / 100 }));
      const orgId = ctx.actor.organizationId;
      const contactId = v.contact_id;
      // SIEMPRE sugeridos: una persona los confirma o descarta en la ficha del contacto.
      const r = await ctx.db.transaction().execute((trx) => proposePreferences(trx, { organizationId: orgId, contactId, source: "visit_report", items }));
      proposed = r.proposed.length;
    }
  }
  const collected = await collectVisits(ctx.db, ctx.actor.organizationId, new Date(), { appointmentId: v.id });
  const visit = await upsertSuggestions(ctx.db, ctx.actor, "visit", collected.candidates);
  const sales = v.contact_id ? await refreshContactSuggestions(ctx.db, ctx.actor, [v.contact_id]) : null;
  await markBriefsStale(ctx.db, [v.assigned_user_id]);
  return { proposedPreferences: proposed, aiUsed, visitSuggestions: collected.candidates.map((c) => c.ruleKey), created: visit?.created ?? 0, salesSuggestions: sales?.seen ?? 0 };
}

function wrap(name: string, fn: (ctx: ActionContext) => Promise<unknown>) {
  registerAction(name, async (_params, ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      log.warn("ai.reaction_failed", { action: name, eventId: ctx.event.id, ...errorFields(e) });
      throw e;
    }
  });
}

wrap("ai_react_visit_finished", reactVisitFinished);
wrap("ai_react_property_published", reactPropertyPublished);
wrap("ai_react_lead_created", reactLeadCreated);
wrap("ai_react_report_confirmed", reactReportConfirmed);
