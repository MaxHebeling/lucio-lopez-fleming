/**
 * Detección de anomalías (job horario `ai.anomalies_detect`, flag `ai_task_center`). Reglas en rules.ts.
 * - Deduplicadas por `dedupe_key` (una fila por situación): se resuelven solas y se reabren si vuelven.
 * - Aviso una sola vez por anomalía (warning/critical), con tope diario por persona (sin spam).
 * - Nunca usa ubicación de agentes (appointment_checkins) ni texto libre de clientes.
 */
import "server-only";
import { sql, type Database, type Executor } from "../../db";
import { can, type Actor, type StaffActor, type SystemActor } from "../../auth/actor";
import { emitEvent } from "../../events";
import { isEnabled } from "../../flags";
import { log } from "../../log";
import { notifyUser } from "../../notifications";
import { getManagementSettings, saltaDayStart, saltaToday, type ManagementSettings } from "../management-settings";
import {
  ANOMALY_LABEL,
  anomalyDedupeKey,
  CONTRADICTION_CODES,
  evaluateAiFailureSpike,
  evaluateContradictions,
  evaluateInquiryDrop,
  evaluateJobFailureSpike,
  evaluateLeadUncontacted,
  evaluateVisitWithoutFollowUp,
  notificationsAllowed,
  type AnomalyKind,
  type Evidence,
  type Verdict,
} from "./rules";

export const TASK_CENTER_FLAG = "ai_task_center";
const HOUR = 3_600_000;

type Detected = { kind: AnomalyKind; entityType: "lead" | "appointment" | "property" | "organization"; entityId: string | null; assignedUserId: string | null; verdict: NonNullable<Verdict> };

async function detectLeads(db: Executor, orgId: string, s: ManagementSettings, now: Date): Promise<Detected[]> {
  const rows = await sql<{ id: string; created_at: Date; assigned_user_id: string | null; source_name: string | null; code: number | null }>`
    select l.id, l.created_at, l.assigned_user_id, ls.name as source_name, p.code
      from leads l left join lead_sources ls on ls.key = l.source_key left join properties p on p.id = l.property_id
     where l.organization_id = ${orgId} and l.deleted_at is null and l.first_response_at is null
       and l.status in ('new', 'contacted', 'qualified')
       and l.created_at <= ${new Date(now.getTime() - s.leadUncontactedHours * HOUR)}
     order by l.created_at limit 1000`.execute(db);
  return rows.rows.flatMap((r) => {
    const verdict = evaluateLeadUncontacted({ hoursWithoutContact: Math.floor((now.getTime() - r.created_at.getTime()) / HOUR), sourceName: r.source_name, propertyCode: r.code }, s);
    return verdict ? [{ kind: "lead_uncontacted" as const, entityType: "lead" as const, entityId: r.id, assignedUserId: r.assigned_user_id, verdict }] : [];
  });
}

async function detectVisits(db: Executor, orgId: string, s: ManagementSettings, now: Date): Promise<Detected[]> {
  const rows = await sql<{ id: string; finished_at: Date; assigned_user_id: string; report_status: string | null; code: number | null }>`
    select a.id, coalesce(a.finished_at, a.ends_at) as finished_at, a.assigned_user_id, r.status as report_status, p.code
      from appointments a join users u on u.id = a.assigned_user_id
      left join appointment_reports r on r.appointment_id = a.id left join properties p on p.id = a.property_id
     where u.organization_id = ${orgId} and a.kind = 'visit' and a.status = 'completed' and a.follow_up_task_id is null
       and coalesce(a.finished_at, a.ends_at) between ${new Date(now.getTime() - 14 * 24 * HOUR)} and ${new Date(now.getTime() - s.visitFollowupHours * HOUR)}
       and not exists (select 1 from tasks t where t.entity_type = 'appointment' and t.entity_id = a.id)
     limit 1000`.execute(db);
  return rows.rows.flatMap((r) => {
    const verdict = evaluateVisitWithoutFollowUp({ hoursSinceFinished: Math.floor((now.getTime() - r.finished_at.getTime()) / HOUR), reportConfirmed: r.report_status === "confirmed", propertyCode: r.code }, s);
    return verdict ? [{ kind: "visit_without_followup" as const, entityType: "appointment" as const, entityId: r.id, assignedUserId: r.assigned_user_id, verdict }] : [];
  });
}

async function detectInquiryDrops(db: Executor, orgId: string, s: ManagementSettings, now: Date): Promise<Detected[]> {
  const recentFrom = new Date(now.getTime() - s.inquiryRecentDays * 24 * HOUR);
  const baselineFrom = new Date(recentFrom.getTime() - s.inquiryBaselineWeeks * 7 * 24 * HOUR);
  const rows = await sql<{ id: string; code: number; published_at: Date; agent_id: string | null; baseline: number; recent: number }>`
    select p.id, p.code, p.published_at,
           (select pa.user_id from property_agents pa join users u on u.id = pa.user_id where pa.property_id = p.id and pa.role = 'lead' and u.is_active and u.deleted_at is null) as agent_id,
           count(l.id) filter (where l.created_at >= ${baselineFrom} and l.created_at < ${recentFrom})::int as baseline,
           count(l.id) filter (where l.created_at >= ${recentFrom})::int as recent
      from properties p left join leads l on l.property_id = p.id and l.deleted_at is null and l.organization_id = ${orgId}
     where p.organization_id = ${orgId} and p.is_published and not p.is_demo and p.deleted_at is null and p.status = 'available'
       and p.published_at <= ${baselineFrom}
     group by p.id limit 2000`.execute(db);
  return rows.rows.flatMap((r) => {
    const check = evaluateInquiryDrop({ publishedDays: Math.floor((now.getTime() - r.published_at.getTime()) / (24 * HOUR)), baselineCount: r.baseline, recentCount: r.recent, propertyCode: r.code }, s);
    return check.status === "drop" ? [{ kind: "property_inquiry_drop" as const, entityType: "property" as const, entityId: r.id, assignedUserId: r.agent_id, verdict: check.verdict }] : [];
  });
}

async function detectContradictions(db: Executor, orgId: string): Promise<Detected[]> {
  const rows = await sql<{ id: string; code: number; agent_id: string | null; findings: Array<{ code: string; title: string }> }>`
    select p.id, p.code, q.findings,
           (select pa.user_id from property_agents pa join users u on u.id = pa.user_id where pa.property_id = p.id and pa.role = 'lead' and u.is_active and u.deleted_at is null) as agent_id
      from property_quality_reports q join properties p on p.id = q.property_id
     where q.organization_id = ${orgId} and p.organization_id = ${orgId} and p.is_published and not p.is_demo and p.deleted_at is null
       and exists (select 1 from jsonb_array_elements(q.findings) f where f->>'code' = any(${[...CONTRADICTION_CODES]}))
     limit 2000`.execute(db);
  return rows.rows.flatMap((r) => {
    const verdict = evaluateContradictions({ findings: Array.isArray(r.findings) ? r.findings : [], propertyCode: r.code });
    return verdict ? [{ kind: "data_contradiction" as const, entityType: "property" as const, entityId: r.id, assignedUserId: r.agent_id, verdict }] : [];
  });
}

async function detectSystem(db: Executor, s: ManagementSettings, now: Date): Promise<Detected[]> {
  const [jobs, ai] = await Promise.all([
    sql<{ last24: number; prev7: number }>`
      select count(*) filter (where finished_at >= ${new Date(now.getTime() - 24 * HOUR)})::int as last24,
             count(*) filter (where finished_at < ${new Date(now.getTime() - 24 * HOUR)} and finished_at >= ${new Date(now.getTime() - 8 * 24 * HOUR)})::int as prev7
        from jobs where status = 'dead' and finished_at >= ${new Date(now.getTime() - 8 * 24 * HOUR)}`.execute(db),
    sql<{ requests: number; failures: number }>`
      select count(*)::int as requests, count(*) filter (where status in ('error', 'timeout', 'invalid_output'))::int as failures
        from ai_interactions where created_at >= ${new Date(now.getTime() - 24 * HOUR)} and coalesce(provider, 'anthropic') <> 'deterministic'
         and coalesce(fallback_reason, '') not in ('not_configured', 'flag_disabled')`.execute(db),
  ]);
  const out: Detected[] = [];
  const j = evaluateJobFailureSpike({ dead24h: jobs.rows[0]?.last24 ?? 0, deadPrevious7d: jobs.rows[0]?.prev7 ?? 0 }, s);
  if (j) out.push({ kind: "job_failure_spike", entityType: "organization", entityId: null, assignedUserId: null, verdict: j });
  const a = evaluateAiFailureSpike({ requests24h: ai.rows[0]?.requests ?? 0, failures24h: ai.rows[0]?.failures ?? 0 }, s);
  if (a) out.push({ kind: "ai_failure_spike", entityType: "organization", entityId: null, assignedUserId: null, verdict: a });
  return out;
}

const ANOMALY_LINK: Record<AnomalyKind, (id: string | null) => string> = {
  lead_uncontacted: (id) => `/crm/leads/${id}`,
  visit_without_followup: (id) => `/crm/mis-visitas/${id}`,
  property_inquiry_drop: (id) => `/crm/propiedades/${id}`,
  data_contradiction: (id) => `/crm/propiedades/${id}`,
  job_failure_spike: () => "/crm/sistema/jobs?status=dead",
  ai_failure_spike: () => "/crm/integraciones/ia",
};

export function anomalyLink(kind: AnomalyKind, entityId: string | null): string {
  return ANOMALY_LINK[kind](entityId);
}

async function notifyAnomaly(db: Executor, orgId: string, a: { id: string; kind: AnomalyKind; entityId: string | null; title: string; assignedUserId: string | null; severity: string }, cap: number, today: string): Promise<number> {
  const targets = a.assignedUserId
    ? [a.assignedUserId]
    : (
        await sql<{ id: string }>`
          select distinct u.id from users u join user_roles ur on ur.user_id = u.id
           where u.organization_id = ${orgId} and ur.role_key in ('administrador', 'direccion', 'super_admin') and u.is_active and u.deleted_at is null and u.kind = 'staff'`.execute(db)
      ).rows.map((r) => r.id);
  let sent = 0;
  for (const userId of targets) {
    const n = await sql<{ n: number }>`select count(*)::int as n from notifications where user_id = ${userId} and kind like 'ai.anomaly.%' and created_at >= ${saltaDayStart(today)}`.execute(db);
    if (notificationsAllowed(n.rows[0]?.n ?? 0, cap) <= 0) continue;
    await notifyUser(db, userId, { kind: `ai.anomaly.${a.kind}`, title: a.title, body: ANOMALY_LABEL[a.kind], link: anomalyLink(a.kind, a.entityId), entityType: "ai_anomaly", entityId: a.id, dedupeKey: `ai_anomaly:${a.id}` });
    sent++;
  }
  return sent;
}

export type DetectResult = { open: number; opened: number; resolved: number; notified: number; byKind: Record<string, number> };

export async function detectAnomalies(db: Database, system: SystemActor, now = new Date()): Promise<DetectResult | { skipped: string }> {
  if (!(await isEnabled(db, TASK_CENTER_FLAG))) return { skipped: "flag" };
  const orgId = system.organizationId;
  const s = await getManagementSettings(db);
  const found = (await Promise.all([detectLeads(db, orgId, s, now), detectVisits(db, orgId, s, now), detectInquiryDrops(db, orgId, s, now), detectContradictions(db, orgId), detectSystem(db, s, now)])).flat();
  const today = saltaToday(now);
  const keys = new Set<string>();
  const byKind: Record<string, number> = {};
  let opened = 0;
  let notified = 0;
  for (const d of found) {
    const key = anomalyDedupeKey(d.kind, d.entityId);
    keys.add(key);
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    await db.transaction().execute(async (trx) => {
      const row = await sql<{ id: string; inserted: boolean; reopened: boolean; notified_at: Date | null }>`
        insert into ai_anomalies(organization_id, kind, entity_type, entity_id, dedupe_key, severity, title, evidence, assigned_user_id, detected_at, last_seen_at)
        values (${orgId}, ${d.kind}, ${d.entityType}, ${d.entityId}, ${key}, ${d.verdict.severity}, ${d.verdict.title}, ${JSON.stringify(d.verdict.evidence satisfies Evidence[])}::jsonb, ${d.assignedUserId}, ${now}, ${now})
        on conflict (dedupe_key) do update set severity = excluded.severity, title = excluded.title, evidence = excluded.evidence,
          assigned_user_id = excluded.assigned_user_id, last_seen_at = excluded.last_seen_at, resolved_at = null,
          detected_at = case when ai_anomalies.resolved_at is not null then excluded.detected_at else ai_anomalies.detected_at end
        returning id, (xmax = 0) as inserted, false as reopened, notified_at`.execute(trx);
      const r = row.rows[0]!;
      if (r.inserted) {
        opened++;
        await emitEvent(trx, system, { type: "ai.anomaly.detected", aggregateType: "ai_anomaly", aggregateId: r.id, payload: { kind: d.kind, severity: d.verdict.severity, entityType: d.entityType }, dedupeKey: `ai.anomaly.detected:${r.id}` });
      }
      if (!r.notified_at && d.verdict.severity !== "info") {
        notified += await notifyAnomaly(trx, orgId, { id: r.id, kind: d.kind, entityId: d.entityId, title: d.verdict.title, assignedUserId: d.assignedUserId, severity: d.verdict.severity }, s.maxNotificationsPerUserPerDay, today);
        // Se marca aunque el tope diario haya frenado el aviso: la anomalía queda visible en Tareas sugeridas y el
        // Centro de comando, y no se acumulan avisos viejos para el día siguiente.
        await trx.updateTable("ai_anomalies").set({ notified_at: now }).where("id", "=", r.id).execute();
      }
    });
  }
  const resolved = await sql`update ai_anomalies set resolved_at = ${now} where organization_id = ${orgId} and resolved_at is null and last_seen_at < ${now}`.execute(db);
  const open = found.length;
  log.info("ai.anomalies_detected", { open, opened, resolved: Number(resolved.numAffectedRows ?? 0), notified, byKind });
  return { open, opened, resolved: Number(resolved.numAffectedRows ?? 0), notified, byKind };
}

export type AnomalyView = { id: string; kind: AnomalyKind; label: string; severity: "info" | "warning" | "critical"; title: string; evidence: Evidence[]; link: string; detectedAt: Date; assignedName: string | null };

/** Anomalías abiertas visibles: dirección/equipo (ai.executive o tasks.read_all) toda la organización; el resto, las suyas. */
export async function listOpenAnomalies(db: Executor, actor: Actor, opts: { limit?: number } = {}): Promise<AnomalyView[]> {
  if (actor.kind !== "staff") return [];
  const staff = actor as StaffActor;
  const team = can(staff, "ai.executive") || can(staff, "tasks.read_all");
  const ops = can(staff, "automations.read") || can(staff, "ai.read_usage");
  const rows = await db
    .selectFrom("ai_anomalies as a")
    .leftJoin("users as u", "u.id", "a.assigned_user_id")
    .select(["a.id", "a.kind", "a.severity", "a.title", "a.evidence", "a.entity_id", "a.entity_type", "a.detected_at", "u.full_name as assigned_name"])
    .where("a.organization_id", "=", staff.organizationId)
    .where("a.resolved_at", "is", null)
    .$if(!team, (q) => q.where("a.assigned_user_id", "=", staff.userId))
    .$if(!ops, (q) => q.where("a.entity_type", "<>", "organization"))
    .$if(!can(staff, "leads.read_all") && !can(staff, "leads.read_own"), (q) => q.where("a.entity_type", "<>", "lead"))
    .orderBy(sql`case a.severity when 'critical' then 0 when 'warning' then 1 else 2 end`)
    .orderBy("a.detected_at", "desc")
    .limit(Math.min(200, opts.limit ?? 50))
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as AnomalyKind,
    label: ANOMALY_LABEL[r.kind as AnomalyKind] ?? r.kind,
    severity: r.severity as AnomalyView["severity"],
    title: r.title,
    evidence: (r.evidence as Evidence[]) ?? [],
    link: anomalyLink(r.kind as AnomalyKind, r.entity_id),
    detectedAt: r.detected_at,
    assignedName: r.assigned_name,
  }));
}
