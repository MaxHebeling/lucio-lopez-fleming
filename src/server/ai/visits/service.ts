/**
 * IA de visitas (Fase 4b): implementación de los puntos de extensión de `src/server/visits/ai-extension.ts`.
 *
 * - Brief previo (flag `ai_visit_brief`): determinista con hechos numerados y «NO REGISTRADO»; con clave, el modelo
 *   resume citando hechos y agrega sugerencias rotuladas como interpretación. Job al crear/asignar la visita y refresco
 *   ~2 h antes; también a pedido. Visible en /crm/mis-visitas/[id] y en el centro operativo.
 * - Informe estructurado (flag `ai_followup`, con clave): propuesta «Revisá y confirmá»; nunca se guarda como informe.
 * - Agradecimiento (flag `ai_followup`, con clave): variante breve editable; sin clave, la plantilla de siempre.
 * - Seguimiento sugerido (flag `ai_followup`): reglas con motivo; la tarea se crea solo al confirmar.
 *
 * RBAC antes de IA: todo lo que parte de una persona pasa por `loadVisit` (alcance propio/todos + organización).
 * Los jobs leen por id y solo escriben la propuesta (nadie la ve sin pasar por `loadVisit`).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, type Database, type Executor } from "../../db";
import { can, requirePermission, type Actor } from "../../auth/actor";
import { registerAction } from "../../automation/actions";
import { utcToLocalInput } from "../../crm/time";
import { emitEvent } from "../../events";
import { AppError, conflict } from "../../errors";
import { isEnabled } from "../../flags";
import { stableStringify } from "../../integrations/portals/snapshot";
import { enqueue } from "../../jobs/queue";
import { registerJobHandler } from "../../jobs/registry";
import { addScheduledTask } from "../../jobs/scheduled";
import { publicZoneLabel } from "../../properties/public";
import { assertCanManageVisit, loadVisit } from "../../visits/access";
import { FIELD_LABEL, formatFieldValue, PROFILE_FIELDS, type ProfileField } from "../../sales/profile/fields";
import { COMPANY_NAME, firstName, type Interest } from "../../visits/rules";
import { addGroundedText, emptyFacts, findViolations } from "../guards";
import { redactForModel, untrustedData } from "../core/governance";
import { visitBriefPrompt, visitReportPrompt, visitThanksPrompt } from "../prompts/visits";
import { aiAvailable, runExtractTask, type TaskDeps } from "../run-task";
import { buildDeterministicBrief, suggestVisitFollowUp, VISIT_BRIEF_RULES_VERSION, type BriefInput, type DeterministicBrief, type FollowUpSuggestion } from "./rules";

export const BRIEF_FLAG = "ai_visit_brief";
export const FOLLOWUP_FLAG = "ai_followup";
export const BRIEF_JOB = "ai.visit_brief";

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const hashOf = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex");

// ───────────────────────────── Datos del brief ─────────────────────────────

/** Lectura por id (sin alcance): la usan los jobs y, SIEMPRE después de `loadVisit`, las personas. */
async function loadBriefInputById(db: Executor, appointmentId: string): Promise<(BriefInput & { organizationId: string; contactId: string | null }) | null> {
  const a = await db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .leftJoin("contacts as c", "c.id", "a.contact_id")
    .select(["a.id", "a.starts_at", "a.property_id", "a.contact_id", "a.lead_id", "a.opportunity_id", "a.notes", "u.full_name as agent_name", "u.organization_id", "c.display_name as contact_name"])
    .where("a.id", "=", appointmentId)
    .where("a.kind", "=", "visit")
    .executeTakeFirst();
  if (!a?.property_id) return null;
  const p = await db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .select(["p.id", "p.code", "p.title", "t.name as type_name", "t.category", "p.location_id", "p.rooms", "p.bedrooms", "p.bathrooms", "p.garages", "p.total_area_m2", "p.covered_area_m2", "p.land_area_m2", "p.age_years", "p.orientation", "p.condition", "p.credit_eligible", "p.allows_pets", "p.organization_id"])
    .where("p.id", "=", a.property_id)
    .executeTakeFirst();
  if (!p || p.organization_id !== a.organization_id) return null;
  const [ops, features, deed, tour, lead, opp, notes, leadMessages, inbound] = await Promise.all([
    db.selectFrom("property_operations").select(["operation", "currency", "amount", "price_hidden", "expenses_amount", "expenses_currency"]).where("property_id", "=", p.id).where("is_active", "=", true).execute(),
    db.selectFrom("property_features as pf").innerJoin("features as f", "f.id", "pf.feature_id").select("f.name").where("pf.property_id", "=", p.id).orderBy("f.sort_order").execute(),
    db.selectFrom("property_documents").select("id").where("property_id", "=", p.id).where("kind", "=", "deed").where("deleted_at", "is", null).executeTakeFirst(),
    db.selectFrom("virtual_tours").select("status").where("property_id", "=", p.id).executeTakeFirst(),
    a.lead_id ? db.selectFrom("leads").select(["operation_interest"]).where("id", "=", a.lead_id).where("organization_id", "=", a.organization_id).executeTakeFirst() : Promise.resolve(undefined),
    a.opportunity_id
      ? db
          .selectFrom("opportunities as o")
          .leftJoin("pipeline_stages as s", "s.id", "o.stage_id")
          .select(["o.title", "s.name as stage", "o.budget_min", "o.budget_max", "o.budget_currency", "o.operation"])
          .where("o.id", "=", a.opportunity_id)
          .where("o.organization_id", "=", a.organization_id)
          .executeTakeFirst()
      : Promise.resolve(undefined),
    a.contact_id ? db.selectFrom("notes").select(["body"]).where("entity_type", "=", "contact").where("entity_id", "=", a.contact_id).where("deleted_at", "is", null).orderBy("created_at", "desc").limit(3).execute() : Promise.resolve([]),
    a.contact_id
      ? db.selectFrom("leads").select(["message", "created_at"]).where("contact_id", "=", a.contact_id).where("organization_id", "=", a.organization_id).where("deleted_at", "is", null).where("message", "is not", null).orderBy("created_at", "desc").limit(4).execute()
      : Promise.resolve([]),
    a.contact_id
      ? db
          .selectFrom("conversation_messages as m")
          .innerJoin("conversations as cv", "cv.id", "m.conversation_id")
          .select(["m.body", "m.created_at", "cv.channel"])
          .where("cv.contact_id", "=", a.contact_id)
          .where("m.direction", "=", "inbound")
          .where("m.body", "is not", null)
          .orderBy("m.created_at", "desc")
          .limit(4)
          .execute()
      : Promise.resolve([]),
  ]);
  const buyerProfile = a.contact_id ? await confirmedBuyerProfile(db, a.organization_id, a.contact_id) : [];
  const asked = [
    ...leadMessages.map((l) => ({ at: new Date(l.created_at), source: "consulta", text: l.message! })),
    ...inbound.map((m) => ({ at: new Date(m.created_at), source: m.channel === "whatsapp" ? "WhatsApp" : m.channel, text: m.body! })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
  return {
    organizationId: a.organization_id,
    contactId: a.contact_id,
    startsAt: new Date(a.starts_at),
    agentName: a.agent_name,
    client: a.contact_name ? { name: a.contact_name } : null,
    property: {
      code: p.code,
      title: p.title,
      typeName: p.type_name,
      category: p.category,
      zone: await publicZoneLabel(db, p.location_id),
      operations: ops.map((o) => ({ operation: o.operation as "sale", currency: o.currency as "USD", amount: num(o.amount), priceHidden: o.price_hidden, expensesAmount: num(o.expenses_amount), expensesCurrency: (o.expenses_currency as "USD" | null) ?? null })),
      rooms: p.rooms,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      garages: p.garages,
      areas: { totalM2: num(p.total_area_m2), coveredM2: num(p.covered_area_m2), landM2: num(p.land_area_m2) },
      ageYears: p.age_years,
      orientation: p.orientation,
      condition: p.condition,
      creditEligible: p.credit_eligible,
      allowsPets: p.allows_pets,
      features: features.map((f) => f.name),
      hasDeedDocument: Boolean(deed),
      tourPublished: tour?.status === "published",
    },
    seeking: {
      operationInterest: lead?.operation_interest ?? opp?.operation ?? null,
      opportunity: opp ? { title: opp.title, stage: opp.stage ?? null, budgetMin: num(opp.budget_min), budgetMax: num(opp.budget_max), budgetCurrency: opp.budget_currency } : null,
      notes: [...(a.notes ? [a.notes] : []), ...notes.map((n) => n.body)],
      // Perfil del comprador (Fase 2): solo preferencias CONFIRMADAS por una persona (las sugeridas no son datos).
      buyerProfile,
    },
    asked,
  };
}

/** «Perfil confirmado · Presupuesto: Hasta USD 250.000» por campo confirmado del perfil del comprador (client_preferences). */
async function confirmedBuyerProfile(db: Executor, organizationId: string, contactId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("client_preferences")
    .select(["field", "value"])
    .where("organization_id", "=", organizationId)
    .where("contact_id", "=", contactId)
    .where("status", "=", "confirmed")
    .execute();
  if (!rows.length) return [];
  const [types, features] = await Promise.all([db.selectFrom("property_types").select(["key", "name"]).execute(), db.selectFrom("features").select(["key", "name"]).execute()]);
  const names = { types: new Map(types.map((t) => [t.key, t.name])), features: new Map(features.map((f) => [f.key, f.name])) };
  const order = new Map(PROFILE_FIELDS.map((f, i) => [f, i]));
  return rows
    .filter((r): r is typeof r & { field: ProfileField } => order.has(r.field as ProfileField))
    .sort((x, y) => order.get(x.field)! - order.get(y.field)!)
    .map((r) => `Perfil confirmado · ${FIELD_LABEL[r.field]}: ${formatFieldValue(r.field, r.value, names)}`)
    .filter((t) => !t.endsWith(": —"));
}

// ───────────────────────────── Brief ─────────────────────────────

export type VisitBriefView = DeterministicBrief & {
  generatedBy: "rules" | "ai";
  ai: { points: Array<{ text: string; factIds: string[] }>; interpretation: string[] } | null;
  generatedAt: Date | null;
};

function briefHash(input: BriefInput): string {
  return hashOf({ v: VISIT_BRIEF_RULES_VERSION, p: visitBriefPrompt.version, input });
}

/** Hechos del brief como grounding: cifras y textos de los hechos (no los mensajes libres como evidencia de cifras). */
function briefGrounding(brief: DeterministicBrief) {
  const facts = emptyFacts();
  for (const f of brief.facts) if (f.section !== "pregunto") addGroundedText(facts, f.text);
  for (const f of brief.facts) for (const m of f.text.matchAll(/#(\d{1,7})\b/g)) facts.propertyCodes.add(Number(m[1]));
  return facts;
}

/**
 * Prepara (y guarda) el brief de una visita. Idempotente por hash de los datos: si nada cambió, no reescribe ni emite.
 * Con `useAi` y modelo disponible, agrega el resumen de la IA; si falla o no pasa las guardas, queda el determinista.
 */
export async function prepareVisitBrief(db: Database, appointmentId: string, opts: { useAi?: boolean; deps?: TaskDeps; actor: Actor }): Promise<{ status: "skipped" | "unchanged" | "prepared"; generatedBy?: "rules" | "ai" }> {
  if (!(await isEnabled(db, BRIEF_FLAG))) return { status: "skipped" };
  const input = await loadBriefInputById(db, appointmentId);
  if (!input) return { status: "skipped" };
  const brief = buildDeterministicBrief(input);
  const inputHash = briefHash(input);
  const existing = await db.selectFrom("visit_ai_outputs").select(["input_hash", "generated_by"]).where("appointment_id", "=", appointmentId).where("kind", "=", "brief").executeTakeFirst();
  const wantAi = Boolean(opts.useAi) && (await aiAvailable(db, opts.deps));
  if (existing?.input_hash === inputHash && (existing.generated_by === "ai" || !wantAi)) return { status: "unchanged" };

  let ai: VisitBriefView["ai"] = null;
  let promptVersion: string | null = null;
  if (wantAi) {
    const factIds = new Set(brief.facts.map((f) => f.id));
    const grounding = briefGrounding(brief);
    const res = await runExtractTask({
      db,
      who: { organizationId: input.organizationId, userId: null, requestId: opts.actor.requestId },
      purpose: "visit_brief",
      feature: "ai.visit_brief",
      task: "answer",
      prompt: visitBriefPrompt,
      context: [untrustedData("hechos", redactForModel(brief.facts.map((f) => `${f.id} [${f.section}]: ${f.text}`).join("\n")), 6000)],
      messages: [{ role: "user", content: "Prepará el brief de la visita con estos hechos." }],
      maxTokens: 700,
      entityType: "appointment",
      entityId: appointmentId,
      deps: opts.deps,
      verify: (v) => [
        ...v.points.flatMap((pt) => pt.fact_ids.filter((id) => !factIds.has(id)).map((id) => ({ kind: "unknown_fact", value: id }))),
        ...[v.headline, ...v.points.map((pt) => pt.text), ...v.interpretation].flatMap((t) => findViolations(t, grounding)),
      ],
    });
    if (res.ok) {
      ai = { points: res.value.points.map((pt) => ({ text: pt.text, factIds: pt.fact_ids })), interpretation: res.value.interpretation };
      promptVersion = res.promptRef;
    }
  }
  const generatedBy = ai ? "ai" : "rules";
  const content = JSON.stringify({ ...brief, ai });
  await db.transaction().execute(async (trx) => {
    const values = { content, generated_by: generatedBy, prompt_version: promptVersion, input_hash: inputHash, status: "proposed", generated_at: new Date() };
    await trx.insertInto("visit_ai_outputs").values({ appointment_id: appointmentId, kind: "brief", ...values }).onConflict((oc) => oc.columns(["appointment_id", "kind"]).doUpdateSet(values)).execute();
    await emitEvent(trx, opts.actor, {
      type: "visit.brief_prepared",
      aggregateType: "appointment",
      aggregateId: appointmentId,
      payload: { generatedBy, notRegistered: brief.notRegistered.length, facts: brief.facts.length, rulesVersion: VISIT_BRIEF_RULES_VERSION },
      dedupeKey: `visit.brief_prepared:${appointmentId}:${inputHash.slice(0, 24)}:${generatedBy}`,
    });
  });
  return { status: "prepared", generatedBy };
}

/** Brief para una persona: primero `loadVisit` (alcance). Si el guardado quedó viejo, se muestra el determinista actual. */
export async function getVisitBriefView(db: Database, actor: Actor, appointmentId: string): Promise<VisitBriefView | null> {
  const v = await loadVisit(db, actor, appointmentId);
  if (!(await isEnabled(db, BRIEF_FLAG))) return null;
  const input = await loadBriefInputById(db, v.id);
  if (!input) return null;
  const brief = buildDeterministicBrief(input);
  const stored = await db.selectFrom("visit_ai_outputs").select(["content", "input_hash", "generated_by", "generated_at"]).where("appointment_id", "=", v.id).where("kind", "=", "brief").executeTakeFirst();
  if (stored && stored.input_hash === briefHash(input)) {
    const c = stored.content as unknown as DeterministicBrief & { ai: VisitBriefView["ai"] };
    return { headline: c.headline, facts: c.facts, notRegistered: c.notRegistered, ai: c.ai ?? null, generatedBy: stored.generated_by as "rules" | "ai", generatedAt: new Date(stored.generated_at) };
  }
  return { ...brief, ai: null, generatedBy: "rules", generatedAt: null };
}

/** «Actualizar brief» a pedido (con IA si está disponible). */
export async function refreshVisitBrief(db: Database, actor: Actor, appointmentId: string, deps: TaskDeps = {}) {
  requirePermission(actor, "visits.operate");
  const v = await loadVisit(db, actor, appointmentId);
  if (!(await isEnabled(db, BRIEF_FLAG))) throw new AppError("unavailable", "El brief de visitas está desactivado");
  return prepareVisitBrief(db, v.id, { useAi: true, deps, actor });
}

export async function enqueueVisitBrief(db: Executor, appointmentId: string, reason: string): Promise<string | null> {
  return enqueue(db, { type: BRIEF_JOB, payload: { appointmentId }, dedupeKey: `${BRIEF_JOB}:${appointmentId}:${reason}`.slice(0, 200), maxAttempts: 3, timeoutMs: 90_000 });
}

registerJobHandler(BRIEF_JOB, async (payload, ctx) => {
  const { appointmentId } = z.object({ appointmentId: z.uuid() }).parse(payload);
  return prepareVisitBrief(ctx.db, appointmentId, { useAi: true, actor: ctx.actor });
});

registerAction("enqueue_visit_brief", async (_raw, ctx) => {
  if (ctx.event.aggregateType !== "appointment") return { skipped: "el evento no es de una cita" };
  if (!(await isEnabled(ctx.db, BRIEF_FLAG))) return { skipped: "flag ai_visit_brief apagado" };
  return { enqueued: Boolean(await enqueueVisitBrief(ctx.db, ctx.event.aggregateId, `event:${ctx.event.id}`)) };
});

/** Refresco ~2 h antes: visitas activas que empiezan entre 1 y 3 horas (la tarea corre cada hora). */
export async function enqueueUpcomingBriefs(db: Database, now = new Date()): Promise<{ enqueued: number }> {
  if (!(await isEnabled(db, BRIEF_FLAG))) return { enqueued: 0 };
  const setting = await db.selectFrom("settings").select("value").where("key", "=", "ai.visit_brief.refresh_hours_before").executeTakeFirst();
  const hours = Math.min(24, Math.max(1, Number(setting?.value) || 2));
  const rows = await sql<{ id: string }>`
    select id from appointments where kind = 'visit' and status in ('scheduled', 'confirmed')
       and starts_at >= ${new Date(now.getTime() + (hours - 1) * 3_600_000)} and starts_at < ${new Date(now.getTime() + (hours + 1) * 3_600_000)}
     limit 500`.execute(db);
  let enqueued = 0;
  for (const r of rows.rows) if (await enqueueVisitBrief(db, r.id, `pre:${hours}h`)) enqueued++;
  return { enqueued };
}

registerJobHandler("ai.visit_brief_refresh", async (_p, ctx) => enqueueUpcomingBriefs(ctx.db));
addScheduledTask({ type: "ai.visit_brief_refresh", every: "hourly", timeoutMs: 60_000 });

/** Brief resumido para el centro operativo (alcance del tablero: `visits.monitor`). */
export async function opsBriefSummaries(db: Database, actor: Actor, appointmentIds: string[]): Promise<Map<string, { notRegistered: number; generatedBy: string }>> {
  requirePermission(actor, "visits.monitor");
  if (!appointmentIds.length || !(await isEnabled(db, BRIEF_FLAG))) return new Map();
  const rows = await db
    .selectFrom("visit_ai_outputs as o")
    .innerJoin("appointments as a", "a.id", "o.appointment_id")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .select(["o.appointment_id", "o.generated_by", sql<number>`jsonb_array_length(o.content->'notRegistered')`.as("nr")])
    .where("o.kind", "=", "brief")
    .where("o.appointment_id", "in", appointmentIds)
    .where("u.organization_id", "=", actor.organizationId)
    .execute();
  return new Map(rows.map((r) => [r.appointment_id, { notRegistered: Number(r.nr), generatedBy: r.generated_by }]));
}

// ───────────────────────────── Informe estructurado (con clave) ─────────────────────────────

export type ReportProposalView = { summary: string; interest: Interest | null; positives: string | null; objections: string | null; nextStep: string | null; followUpAt: string | null };

const textHash = (t: string) => hashOf({ p: visitReportPrompt.version, t: t.trim() });

export async function aiReportAvailable(db: Database, deps: TaskDeps = {}): Promise<boolean> {
  return (await isEnabled(db, FOLLOWUP_FLAG)) && (await aiAvailable(db, deps));
}

/** Propuesta «Revisá y confirmá» a partir del comentario del agente. Nunca se guarda en el informe. */
export async function proposeVisitReport(db: Database, actor: Actor, raw: { appointmentId: string; text: string }, deps: TaskDeps = {}): Promise<ReportProposalView> {
  requirePermission(actor, "visits.operate");
  const input = z.object({ appointmentId: z.uuid(), text: z.string().trim().min(10, "Escribí un poco más para poder proponer campos").max(10_000) }).parse(raw);
  const v = await loadVisit(db, actor, input.appointmentId);
  assertCanManageVisit(actor, v);
  if (!(await isEnabled(db, FOLLOWUP_FLAG))) throw new AppError("unavailable", "Las sugerencias de IA de visitas están desactivadas");
  if (v.status !== "completed") throw conflict("El informe se carga cuando la visita está finalizada");
  const hash = textHash(input.text);
  const stored = await db.selectFrom("visit_ai_outputs").select(["content", "input_hash"]).where("appointment_id", "=", v.id).where("kind", "=", "report_proposal").executeTakeFirst();
  if (stored?.input_hash === hash) return stored.content as unknown as ReportProposalView;
  const org = await db.selectFrom("users").select("organization_id").where("id", "=", v.assigned_user_id).executeTakeFirstOrThrow();
  const res = await runExtractTask({
    db,
    who: { organizationId: org.organization_id, userId: actor.kind === "staff" ? actor.userId : null, requestId: actor.requestId },
    purpose: "visit_report",
    feature: "ai.visit_report",
    task: "extract",
    prompt: visitReportPrompt,
    messages: [{ role: "user", content: untrustedData("comentario_agente", redactForModel(input.text), 6000) }],
    maxTokens: 500,
    entityType: "appointment",
    entityId: v.id,
    deps,
  });
  if (!res.ok) throw new AppError("unavailable", res.reason === "not_configured" ? "La IA no está configurada: completá los campos a mano." : "No pudimos proponer los campos ahora: completalos a mano.");
  const x = res.value;
  const base = v.finished_at ?? new Date();
  const proposal: ReportProposalView = {
    summary: x.summary,
    interest: x.interest,
    positives: x.positives,
    objections: x.objections,
    nextStep: x.next_step,
    followUpAt: x.follow_up_days !== null ? utcToLocalInput(new Date(Math.ceil((base.getTime() + x.follow_up_days * 86_400_000) / 300_000) * 300_000)) : null,
  };
  await db.transaction().execute(async (trx) => {
    const values = { content: JSON.stringify(proposal), generated_by: "ai", prompt_version: res.promptRef, input_hash: hash, status: "proposed", generated_at: new Date() };
    await trx.insertInto("visit_ai_outputs").values({ appointment_id: v.id, kind: "report_proposal", ...values }).onConflict((oc) => oc.columns(["appointment_id", "kind"]).doUpdateSet(values)).execute();
    await emitEvent(trx, actor, {
      type: "visit.report_structured",
      aggregateType: "appointment",
      aggregateId: v.id,
      payload: { fields: ["interest", "positives", "objections", "nextStep", "followUpAt"].filter((k) => proposal[k as keyof ReportProposalView] !== null), prompt: res.promptRef },
      dedupeKey: `visit.report_structured:${v.id}:${hash.slice(0, 24)}`,
    });
  });
  return proposal;
}

/** Propuesta guardada para el texto actual del borrador (sin llamar al modelo). */
export async function storedReportProposal(db: Database, actor: Actor, appointmentId: string, text: string): Promise<ReportProposalView | null> {
  const v = await loadVisit(db, actor, appointmentId);
  if (!(await isEnabled(db, FOLLOWUP_FLAG))) return null;
  const row = await db.selectFrom("visit_ai_outputs").select(["content", "input_hash"]).where("appointment_id", "=", v.id).where("kind", "=", "report_proposal").executeTakeFirst();
  return row && row.input_hash === textHash(text) ? (row.content as unknown as ReportProposalView) : null;
}

// ───────────────────────────── Agradecimiento (con clave) ─────────────────────────────

export async function draftThanksWithAi(db: Database, actor: Actor, raw: { appointmentId: string }, deps: TaskDeps = {}): Promise<{ message: string }> {
  requirePermission(actor, "visits.operate");
  const { appointmentId } = z.object({ appointmentId: z.uuid() }).parse(raw);
  const v = await loadVisit(db, actor, appointmentId);
  assertCanManageVisit(actor, v);
  if (!(await isEnabled(db, FOLLOWUP_FLAG))) throw new AppError("unavailable", "Las sugerencias de IA de visitas están desactivadas");
  if (v.status !== "completed") throw conflict("El agradecimiento se prepara con la visita finalizada");
  const [contact, property, report, org] = await Promise.all([
    v.contact_id ? db.selectFrom("contacts").select(["first_name", "display_name"]).where("id", "=", v.contact_id).executeTakeFirst() : Promise.resolve(undefined),
    db.selectFrom("properties").select(["title", "code"]).where("id", "=", v.property_id!).executeTakeFirstOrThrow(),
    db.selectFrom("appointment_reports").select(["positives", "status"]).where("appointment_id", "=", v.id).executeTakeFirst(),
    db.selectFrom("users").select("organization_id").where("id", "=", v.assigned_user_id).executeTakeFirstOrThrow(),
  ]);
  const data = {
    cliente: firstName(contact?.first_name ?? contact?.display_name) ?? null,
    asesor: v.agent_name,
    propiedad: property.title,
    empresa: COMPANY_NAME,
    positivos_confirmados: report?.status === "confirmed" ? report.positives : null,
  };
  const hash = hashOf({ p: visitThanksPrompt.version, data });
  const stored = await db.selectFrom("visit_ai_outputs").select(["content", "input_hash"]).where("appointment_id", "=", v.id).where("kind", "=", "thanks_draft").executeTakeFirst();
  if (stored?.input_hash === hash) return stored.content as unknown as { message: string };
  const grounding = emptyFacts();
  addGroundedText(grounding, Object.values(data).filter(Boolean).join(" "));
  const res = await runExtractTask({
    db,
    who: { organizationId: org.organization_id, userId: actor.kind === "staff" ? actor.userId : null, requestId: actor.requestId },
    purpose: "visit_thanks",
    feature: "ai.visit_thanks",
    task: "extract",
    prompt: visitThanksPrompt,
    messages: [{ role: "user", content: untrustedData("visita", redactForModel(JSON.stringify(data)), 2000) }],
    maxTokens: 300,
    entityType: "appointment",
    entityId: v.id,
    deps,
    verify: (x) => findViolations(x.message, grounding),
  });
  if (!res.ok) throw new AppError("unavailable", res.reason === "guard_blocked" ? "La variante de la IA incluía datos que no constan: usá la plantilla." : "No pudimos redactar una variante ahora: usá la plantilla.");
  const content = { message: res.value.message.slice(0, 1000) };
  const values = { content: JSON.stringify(content), generated_by: "ai", prompt_version: res.promptRef, input_hash: hash, status: "proposed", generated_at: new Date() };
  await db.insertInto("visit_ai_outputs").values({ appointment_id: v.id, kind: "thanks_draft", ...values }).onConflict((oc) => oc.columns(["appointment_id", "kind"]).doUpdateSet(values)).execute();
  return content;
}

// ───────────────────────────── Seguimiento sugerido ─────────────────────────────

export async function followUpSuggestion(db: Database, actor: Actor, appointmentId: string): Promise<FollowUpSuggestion | null> {
  const v = await loadVisit(db, actor, appointmentId);
  if (!(await isEnabled(db, FOLLOWUP_FLAG))) return null;
  const r = await db.selectFrom("appointment_reports").select(["interest", "positives", "objections", "next_step", "follow_up_at", "status"]).where("appointment_id", "=", v.id).executeTakeFirst();
  if (r?.status !== "confirmed") return null;
  const [prop, contact] = await Promise.all([
    v.property_id ? db.selectFrom("properties").select("code").where("id", "=", v.property_id).executeTakeFirst() : Promise.resolve(undefined),
    v.contact_id ? db.selectFrom("contacts").select("display_name").where("id", "=", v.contact_id).executeTakeFirst() : Promise.resolve(undefined),
  ]);
  return suggestVisitFollowUp(
    { interest: (r.interest as Interest | null) ?? null, positives: r.positives, objections: r.objections, nextStep: r.next_step, followUpAt: r.follow_up_at ? new Date(r.follow_up_at) : null },
    v.finished_at ?? new Date(),
    { propertyCode: prop?.code ?? null, clientName: contact?.display_name ?? null },
  );
}

export function canSeeVisitAi(actor: Actor): boolean {
  return can(actor, "visits.operate") || can(actor, "visits.monitor");
}
