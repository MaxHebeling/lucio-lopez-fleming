/**
 * «Tareas sugeridas» (Task Center): bandeja unificada por usuario sobre `sales_recommendations` generalizada.
 *
 * - Actualización idempotente (jobs `ai.task_center_refresh*`, reacciones de IA): upsert por (entidad, regla, huella);
 *   lo que dejó de aplicar pasa a `expired`. Las decisiones humanas no se tocan.
 * - Alcance: el agente ve lo asignado a él (y, en ventas, solo contactos dentro de su alcance comercial); con
 *   `tasks.read_all`, todo el equipo de SU organización. Cada origen exige además el permiso de su módulo.
 * - Aceptar crea (o devuelve) la tarea real con el servicio de tareas, sin duplicar; descartar (motivo opcional) y
 *   posponer (hasta fecha) quedan auditados con eventos `ai.recommendation.*`.
 */
import "server-only";
import { z } from "zod";
import type { RawBuilder } from "kysely";
import { sql, type Database, type Executor } from "../../db";
import { audit } from "../../audit";
import { can, requirePermission, requireStaff, type Actor, type StaffActor, type SystemActor } from "../../auth/actor";
import { leadScope, tryScope } from "../../crm/access";
import { utcToLocalInput } from "../../crm/time";
import { AppError, conflict, invalid, notFound } from "../../errors";
import { emitEvent } from "../../events";
import { isEnabled } from "../../flags";
import { log } from "../../log";
import { createTask } from "../../tasks/service";
import { contactInScopeSql } from "../../sales/scope";
import { createVisitFollowUp } from "../../visits/service";
import { markBriefsStale } from "../brief/cache";
import { getManagementSettings, type ManagementSettings } from "../management-settings";
import { TASK_CENTER_FLAG } from "../anomalies/service";
import { collectAnomalies, collectAssignments, collectMarketing, collectOpsAlerts, collectQuality, collectSales, collectVisits, type Collected } from "./collectors";
import { dedupeCandidates, rankSuggestions, snoozeUntil, SOURCE_LABEL, SUGGESTION_SOURCES, type SuggestionCandidate, type SuggestionPriority, type SuggestionSource, type TaskTemplate } from "./rules";

export { TASK_CENTER_FLAG };

// ───────────────────────────── Persistencia idempotente ─────────────────────────────

export type SyncStats = { source: SuggestionSource; seen: number; created: number; expired: number };

export async function syncCandidates(db: Database, system: SystemActor, collected: Collected, now = new Date()): Promise<SyncStats> {
  const orgId = system.organizationId;
  const candidates = dedupeCandidates(collected.candidates, orgId);
  let created = 0;
  const touched = new Set<string>();
  await db.transaction().execute(async (trx) => {
    for (const c of candidates) {
      const entityId = c.entityId ?? orgId;
      const row = await sql<{ id: string; inserted: boolean; assigned_user_id: string | null }>`
        insert into sales_recommendations(organization_id, contact_id, entity_type, entity_id, rule_key, fingerprint, priority, title, reason, evidence, status,
          source, assigned_user_id, link, task_template, last_seen_at)
        values (${orgId}, ${c.contactId ?? null}, ${c.entityType}, ${entityId}, ${c.ruleKey}, ${c.fingerprint}, ${c.priority}, ${c.title.slice(0, 200)},
          ${c.reason.slice(0, 500)}, ${JSON.stringify(c.evidence.slice(0, 10))}::jsonb, 'open',
          ${c.source}, ${c.assignedUserId}, ${c.link}, ${JSON.stringify(c.task)}::jsonb, ${now})
        on conflict (entity_type, entity_id, rule_key, fingerprint) do update set
          assigned_user_id = excluded.assigned_user_id, priority = excluded.priority, title = excluded.title, reason = excluded.reason,
          evidence = excluded.evidence, link = excluded.link, task_template = excluded.task_template, last_seen_at = excluded.last_seen_at,
          status = case when sales_recommendations.status <> 'expired' then sales_recommendations.status
                        when sales_recommendations.snoozed_until > ${now} then 'snoozed' else 'open' end,
          resolved_at = case when sales_recommendations.status = 'expired' then null else sales_recommendations.resolved_at end
        where sales_recommendations.organization_id = excluded.organization_id
        returning id, (xmax = 0) as inserted, assigned_user_id`.execute(trx);
      const r = row.rows[0];
      if (!r) continue;
      if (r.assigned_user_id) touched.add(r.assigned_user_id);
      if (r.inserted) {
        created++;
        await emitEvent(trx, system, {
          type: "ai.recommendation.created",
          aggregateType: "ai_recommendation",
          aggregateId: r.id,
          payload: { source: c.source, rule: c.ruleKey, priority: c.priority, entityType: c.entityType },
          dedupeKey: `ai.recommendation.created:${r.id}`,
        });
      }
    }
  });
  // Lo que dejó de aplicar (no apareció en esta corrida) se vence. Las decisiones humanas no se tocan.
  const scope = collected.evaluatedEntityIds;
  if (scope && !scope.length) return { source: collected.source, seen: candidates.length, created, expired: 0 };
  const expired = await sql`
    update sales_recommendations set status = 'expired', resolved_at = ${now}
     where organization_id = ${orgId} and source = ${collected.source} and status in ('open', 'snoozed')
       and coalesce(last_seen_at, created_at) < ${now}
       ${scope ? sql`and entity_id = any(${scope}::uuid[])` : sql``}`.execute(db);
  if (created) await markBriefsStale(db, [...touched]);
  return { source: collected.source, seen: candidates.length, created, expired: Number(expired.numAffectedRows ?? 0) };
}

export const FAST_SOURCES: SuggestionSource[] = ["visit", "ops_alert", "assignment", "anomaly", "marketing"];
export const SLOW_SOURCES: SuggestionSource[] = ["sales_nba", "property_quality"];

/** Recalcula los orígenes indicados (por defecto todos). Nunca lanza por un origen: lo registra y sigue. */
export async function refreshSuggestions(db: Database, system: SystemActor, opts: { sources?: SuggestionSource[]; now?: Date } = {}): Promise<SyncStats[] | { skipped: string }> {
  if (!(await isEnabled(db, TASK_CENTER_FLAG))) return { skipped: "flag" };
  const now = opts.now ?? new Date();
  const s = await getManagementSettings(db);
  const orgId = system.organizationId;
  const run: Record<SuggestionSource, () => Promise<Collected>> = {
    sales_nba: () => collectSales(db, orgId, s, now),
    visit: () => collectVisits(db, orgId, now),
    property_quality: () => collectQuality(db, orgId, s),
    marketing: () => collectMarketing(db, orgId),
    ops_alert: () => collectOpsAlerts(db, orgId),
    assignment: () => collectAssignments(db, orgId, now),
    anomaly: () => collectAnomalies(db, orgId),
  };
  const out: SyncStats[] = [];
  for (const source of opts.sources ?? [...SUGGESTION_SOURCES]) {
    try {
      out.push(await syncCandidates(db, system, await run[source](), now));
    } catch (e) {
      log.error("ai.task_center_source_failed", { source, error: (e as Error).message });
    }
  }
  return out;
}

/** Recalcula la siguiente acción de contactos puntuales (reacciones: lead nuevo, visita, informe). */
export async function refreshContactSuggestions(db: Database, system: SystemActor, contactIds: string[], now = new Date()): Promise<SyncStats | null> {
  if (!contactIds.length || !(await isEnabled(db, TASK_CENTER_FLAG))) return null;
  const s = await getManagementSettings(db);
  return syncCandidates(db, system, await collectSales(db, system.organizationId, s, now, contactIds), now);
}

/** Alta directa de candidatas (reacciones), sin vencer las demás del origen. */
export async function upsertSuggestions(db: Database, system: SystemActor, source: SuggestionSource, candidates: SuggestionCandidate[], now = new Date()): Promise<SyncStats | null> {
  if (!candidates.length || !(await isEnabled(db, TASK_CENTER_FLAG))) return null;
  return syncCandidates(db, system, { source, candidates, evaluatedEntityIds: [] }, now);
}

// ───────────────────────────── Alcance ─────────────────────────────

export type Visibility = { staff: StaffActor; team: boolean; predicate: RawBuilder<boolean> };

export async function suggestionVisibility(db: Executor, actor: Actor, wantTeam: boolean): Promise<Visibility> {
  requireStaff(actor);
  const staff = actor;
  if (!can(staff, "tasks.manage") && !can(staff, "tasks.read_all")) throw new AppError("forbidden", "Tu rol no tiene acceso a las tareas sugeridas");
  const team = wantTeam && can(staff, "tasks.read_all");
  const org = staff.organizationId;
  const me = staff.userId;
  const parts: RawBuilder<boolean>[] = [];
  const leads = can(staff, "contacts.read") ? tryScope(leadScope, staff) : null;
  if (leads) {
    parts.push(sql<boolean>`(r.source = 'sales_nba' and exists (select 1 from contacts c where c.id = r.contact_id and c.organization_id = ${org}
      and c.deleted_at is null and ${contactInScopeSql(leads, "c")}))`);
  }
  const visits = await isEnabled(db, "visits_operations");
  if (visits && can(staff, "visits.operate")) {
    const allVisits = can(staff, "visits.monitor") || can(staff, "agenda.read_all");
    parts.push(sql<boolean>`(r.source = 'visit' and exists (select 1 from appointments a join users u on u.id = a.assigned_user_id
      where a.id = r.entity_id and u.organization_id = ${org} ${allVisits ? sql`` : sql`and a.assigned_user_id = ${me}`}))`);
  }
  if (visits && can(staff, "visits.monitor")) parts.push(sql<boolean>`(r.source = 'ops_alert')`);
  if (can(staff, "leads.assign")) parts.push(sql<boolean>`(r.source = 'assignment')`);
  if (can(staff, "properties.read")) {
    parts.push(sql<boolean>`(r.source in ('property_quality', 'marketing', 'anomaly') and r.entity_type = 'property'
      and exists (select 1 from properties p where p.id = r.entity_id and p.organization_id = ${org} and p.deleted_at is null))`);
  }
  if (can(staff, "automations.read") || can(staff, "ai.read_usage")) parts.push(sql<boolean>`(r.source = 'anomaly' and r.entity_type = 'organization')`);
  const any = parts.length ? sql.join(parts, sql` or `) : sql`false`;
  const predicate = sql<boolean>`(r.organization_id = ${org} and (${any}) ${team ? sql`` : sql`and r.assigned_user_id = ${me}`})`;
  return { staff, team, predicate };
}

// ───────────────────────────── Lectura ─────────────────────────────

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const suggestionFiltersSchema = z.object({
  vista: z.preprocess(emptyToUndef, z.enum(["mias", "equipo"]).optional()),
  origen: z.preprocess(emptyToUndef, z.enum(["ventas", "visitas", "calidad", "marketing", "alertas", "asignaciones", "anomalias"]).optional()),
  prioridad: z.preprocess(emptyToUndef, z.enum(["alta", "media", "baja"]).optional()),
  regla: z.preprocess(emptyToUndef, z.string().regex(/^[a-z_]{3,40}$/).optional()),
  estado: z.preprocess(emptyToUndef, z.enum(["pendientes", "pospuestas"]).optional()),
});
export type SuggestionFilters = z.infer<typeof suggestionFiltersSchema>;

const SOURCE_BY_PARAM: Record<string, SuggestionSource> = { ventas: "sales_nba", visitas: "visit", calidad: "property_quality", marketing: "marketing", alertas: "ops_alert", asignaciones: "assignment", anomalias: "anomaly" };
const PRIORITY_BY_PARAM: Record<string, SuggestionPriority> = { alta: "high", media: "medium", baja: "low" };

export type SuggestionView = {
  id: string;
  source: SuggestionSource;
  sourceLabel: string;
  ruleKey: string;
  priority: SuggestionPriority;
  title: string;
  reason: string;
  evidence: string[];
  link: string | null;
  entityLabel: string | null;
  assignedName: string | null;
  createdAt: Date;
  snoozedUntil: Date | null;
  status: "open" | "snoozed";
};

export async function listSuggestions(db: Executor, actor: Actor, raw: unknown, now = new Date()) {
  const parsed = suggestionFiltersSchema.safeParse(raw ?? {});
  const f: SuggestionFilters = parsed.success ? parsed.data : {};
  const v = await suggestionVisibility(db, actor, f.vista === "equipo");
  const snoozed = f.estado === "pospuestas";
  const rows = await sql<{
    id: string;
    source: SuggestionSource;
    rule_key: string;
    priority: SuggestionPriority;
    title: string;
    reason: string;
    evidence: string[];
    link: string | null;
    created_at: Date;
    snoozed_until: Date | null;
    status: string;
    assigned_name: string | null;
    entity_label: string | null;
  }>`
    select r.id, r.source, r.rule_key, r.priority, r.title, r.reason, r.evidence, r.link, r.created_at, r.snoozed_until, r.status,
           u.full_name as assigned_name,
           case r.entity_type
             when 'contact' then (select display_name from contacts where id = r.entity_id)
             when 'lead' then (select c.display_name from leads l join contacts c on c.id = l.contact_id where l.id = r.entity_id)
             when 'property' then (select '#' || code || ' · ' || title from properties where id = r.entity_id)
             when 'appointment' then (select title from appointments where id = r.entity_id)
           end as entity_label
      from sales_recommendations r left join users u on u.id = r.assigned_user_id
     where ${v.predicate}
       and ${snoozed ? sql`r.status = 'snoozed' and r.snoozed_until > ${now}` : sql`(r.status = 'open' or (r.status = 'snoozed' and r.snoozed_until <= ${now}))`}
       ${f.origen ? sql`and r.source = ${SOURCE_BY_PARAM[f.origen]}` : sql``}
       ${f.prioridad ? sql`and r.priority = ${PRIORITY_BY_PARAM[f.prioridad]}` : sql``}
       ${f.regla ? sql`and r.rule_key = ${f.regla}` : sql``}
     order by r.created_at limit 500`.execute(db);
  const items: SuggestionView[] = rankSuggestions(
    rows.rows.map((r) => ({
      id: r.id,
      source: r.source,
      sourceLabel: SOURCE_LABEL[r.source] ?? r.source,
      ruleKey: r.rule_key,
      priority: r.priority,
      title: r.title,
      reason: r.reason,
      evidence: Array.isArray(r.evidence) ? r.evidence : [],
      link: r.link,
      entityLabel: r.entity_label,
      assignedName: r.assigned_name,
      createdAt: r.created_at,
      snoozedUntil: r.snoozed_until,
      status: r.status === "snoozed" && r.snoozed_until && r.snoozed_until > now ? ("snoozed" as const) : ("open" as const),
    })),
    now,
  );
  return { items, team: v.team, canTeam: can(v.staff, "tasks.read_all"), canDecide: can(v.staff, "tasks.manage"), filters: f };
}

/** Conteos por origen y prioridad de lo pendiente (Resumen de hoy, Centro de comando). */
export async function suggestionCounts(db: Executor, actor: Actor, opts: { team: boolean }, now = new Date()) {
  const v = await suggestionVisibility(db, actor, opts.team);
  const rows = await sql<{ source: SuggestionSource; priority: SuggestionPriority; n: number; contacts: number }>`
    select r.source, r.priority, count(*)::int as n, count(distinct r.contact_id)::int as contacts
      from sales_recommendations r
     where ${v.predicate} and (r.status = 'open' or (r.status = 'snoozed' and r.snoozed_until <= ${now}))
     group by 1, 2`.execute(db);
  return { rows: rows.rows, team: v.team };
}

// ───────────────────────────── Decisiones ─────────────────────────────

type LoadedSuggestion = {
  id: string;
  organization_id: string;
  source: SuggestionSource;
  rule_key: string;
  fingerprint: string;
  entity_type: string;
  entity_id: string;
  contact_id: string | null;
  assigned_user_id: string | null;
  status: string;
  task_id: string | null;
  title: string;
  reason: string;
  link: string | null;
  task_template: TaskTemplate | null;
  snoozed_until: Date | null;
};

async function loadVisible(db: Executor, actor: Actor, id: string): Promise<{ row: LoadedSuggestion; v: Visibility }> {
  if (!z.uuid().safeParse(id).success) throw notFound("Sugerencia");
  const v = await suggestionVisibility(db, actor, true);
  const r = await sql<LoadedSuggestion>`
    select r.id, r.organization_id, r.source, r.rule_key, r.fingerprint, r.entity_type, r.entity_id, r.contact_id, r.assigned_user_id, r.status,
           r.task_id, r.title, r.reason, r.link, r.task_template, r.snoozed_until
      from sales_recommendations r where r.id = ${id} and ${v.predicate}`.execute(db);
  if (!r.rows[0]) throw notFound("Sugerencia");
  return { row: r.rows[0], v };
}

const TASK_ENTITY: Record<string, "contact" | "lead" | "opportunity" | "property" | "appointment" | undefined> = { contact: "contact", lead: "lead", opportunity: "opportunity", property: "property", appointment: "appointment" };

export const acceptSuggestionSchema = z.object({ id: z.uuid() });
export const dismissSuggestionSchema = z.object({ id: z.uuid(), note: z.string().trim().max(300).optional().transform((v) => v || null) });
export const snoozeSuggestionSchema = z.object({ id: z.uuid(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí una fecha") });

export async function acceptSuggestion(db: Database, actor: Actor, raw: unknown, now = new Date()): Promise<{ taskId: string; replayed: boolean }> {
  requirePermission(actor, "tasks.manage");
  const input = acceptSuggestionSchema.parse(raw);
  const { row, v } = await loadVisible(db, actor, input.id);
  if (row.status === "accepted" && row.task_id) return { taskId: row.task_id, replayed: true };
  if (row.status !== "open" && row.status !== "snoozed") throw conflict("Esta sugerencia ya no está pendiente. Actualizá la página.");
  const tmpl: TaskTemplate = row.task_template ?? { kind: "task", title: row.title, dueInHours: 24, priority: "normal" };
  const dueAt = utcToLocalInput(new Date(now.getTime() + Math.max(1, tmpl.dueInHours) * 3_600_000));
  // Tareas de otra persona solo con «ver todo el equipo»; si no, la toma quien acepta.
  const assignee = row.assigned_user_id && (row.assigned_user_id === v.staff.userId || can(v.staff, "tasks.read_all")) ? row.assigned_user_id : v.staff.userId;

  let task: { id: string; replayed: boolean };
  if (row.source === "visit" && row.rule_key === "visit_followup") {
    // Mismo servicio y clave que «Crear tarea de seguimiento» de la visita: no hay forma de duplicarla.
    const r = await createVisitFollowUp(db, actor, { appointmentId: row.entity_id, dueAt, title: tmpl.title });
    task = { id: r.taskId, replayed: r.replayed };
  } else {
    const entityType = TASK_ENTITY[row.entity_type];
    task = await createTask(db, actor, {
      title: tmpl.title.slice(0, 200),
      description: `${row.reason}\n\nSugerida en «Tareas sugeridas» · ${SOURCE_LABEL[row.source]}${row.link ? ` (${row.link})` : ""}.`,
      kind: tmpl.kind,
      priority: tmpl.priority,
      dueAt,
      assignedUserId: assignee,
      entityType: entityType ?? null,
      entityId: entityType ? row.entity_id : null,
      // Ventas usa la MISMA clave que «Aceptar y crear tarea» del lead/contacto: aceptar en los dos lados no duplica.
      idempotencyKey: row.source === "sales_nba" && row.contact_id ? `nba:${row.contact_id}:${row.rule_key}:${row.fingerprint}` : `ai-rec:${row.id}`,
    });
  }
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("sales_recommendations")
      .set({ status: "accepted", task_id: task.id, decided_by: v.staff.userId, decided_at: now, snoozed_until: null })
      .where("id", "=", row.id)
      .execute();
    await audit(trx, v.staff, { action: "AI_RECOMMENDATION_ACCEPTED", entityType: "ai_recommendation", entityId: row.id, before: { status: row.status }, after: { status: "accepted", source: row.source, rule: row.rule_key, taskId: task.id } });
    await emitEvent(trx, v.staff, { type: "ai.recommendation.accepted", aggregateType: "ai_recommendation", aggregateId: row.id, payload: { source: row.source, rule: row.rule_key, taskId: task.id, replayed: task.replayed }, dedupeKey: `ai.recommendation.accepted:${row.id}` });
  });
  await markBriefsStale(db, [v.staff.userId, assignee]);
  return { taskId: task.id, replayed: task.replayed };
}

export async function dismissSuggestion(db: Database, actor: Actor, raw: unknown, now = new Date()): Promise<{ changed: boolean }> {
  requirePermission(actor, "tasks.manage");
  const input = dismissSuggestionSchema.parse(raw);
  const { row, v } = await loadVisible(db, actor, input.id);
  if (row.status === "dismissed") return { changed: false };
  if (row.status !== "open" && row.status !== "snoozed") throw conflict("Esta sugerencia ya no está pendiente. Actualizá la página.");
  await db.transaction().execute(async (trx) => {
    await trx.updateTable("sales_recommendations").set({ status: "dismissed", dismiss_note: input.note, decided_by: v.staff.userId, decided_at: now, snoozed_until: null }).where("id", "=", row.id).execute();
    // La nota es interna: la auditoría registra si hubo motivo, no su texto.
    await audit(trx, v.staff, { action: "AI_RECOMMENDATION_DISMISSED", entityType: "ai_recommendation", entityId: row.id, before: { status: row.status }, after: { status: "dismissed", source: row.source, rule: row.rule_key, withNote: Boolean(input.note) } });
    await emitEvent(trx, v.staff, { type: "ai.recommendation.dismissed", aggregateType: "ai_recommendation", aggregateId: row.id, payload: { source: row.source, rule: row.rule_key, withNote: Boolean(input.note) }, dedupeKey: `ai.recommendation.dismissed:${row.id}:${now.toISOString()}` });
  });
  await markBriefsStale(db, [v.staff.userId]);
  return { changed: true };
}

export async function snoozeSuggestion(db: Database, actor: Actor, raw: unknown, now = new Date(), settings?: ManagementSettings): Promise<{ until: Date }> {
  requirePermission(actor, "tasks.manage");
  const input = snoozeSuggestionSchema.parse(raw);
  const s = settings ?? (await getManagementSettings(db));
  const check = snoozeUntil(input.until, now, s.maxSnoozeDays);
  if (!check.ok) throw invalid(check.message, { until: [check.message] });
  const { row, v } = await loadVisible(db, actor, input.id);
  if (row.status !== "open" && row.status !== "snoozed") throw conflict("Esta sugerencia ya no está pendiente. Actualizá la página.");
  await db.transaction().execute(async (trx) => {
    await trx.updateTable("sales_recommendations").set({ status: "snoozed", snoozed_until: check.until, decided_by: v.staff.userId, decided_at: now }).where("id", "=", row.id).execute();
    await audit(trx, v.staff, { action: "AI_RECOMMENDATION_SNOOZED", entityType: "ai_recommendation", entityId: row.id, before: { status: row.status }, after: { status: "snoozed", source: row.source, rule: row.rule_key, until: check.until.toISOString() } });
    await emitEvent(trx, v.staff, { type: "ai.recommendation.snoozed", aggregateType: "ai_recommendation", aggregateId: row.id, payload: { source: row.source, rule: row.rule_key, until: check.until.toISOString() }, dedupeKey: `ai.recommendation.snoozed:${row.id}:${now.toISOString()}` });
  });
  await markBriefsStale(db, [v.staff.userId]);
  return { until: check.until };
}
