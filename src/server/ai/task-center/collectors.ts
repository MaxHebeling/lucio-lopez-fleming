/**
 * Colectores de «Tareas sugeridas»: cada uno REUTILIZA un módulo existente y devuelve candidatas con prioridad, motivo,
 * evidencia (sin datos personales ni texto libre de clientes), origen, responsable y la tarea que se crearía.
 * No escriben: la persistencia idempotente la hace service.ts.
 */
import "server-only";
import { sql, type Executor } from "../../db";
import { isEnabled } from "../../flags";
import { ALERT_LABEL, type AlertKind } from "../../visits/rules";
import { gatherNbaFacts, salesAssignee } from "../../sales/nba/service";
import { recommendNextActions } from "../../sales/nba/rules";
import { anomalyLink } from "../anomalies/service";
import type { AnomalyKind, Evidence } from "../anomalies/rules";
import type { ManagementSettings } from "../management-settings";
import { clip, suggestionFingerprint, type SuggestionCandidate, type SuggestionSource } from "./rules";

const HOUR = 3_600_000;

export type Collected = {
  source: SuggestionSource;
  candidates: SuggestionCandidate[];
  /** Entidades evaluadas: las sugerencias abiertas de este origen sobre ellas que no volvieron a aparecer se vencen. null = todo el origen. */
  evaluatedEntityIds: string[] | null;
};

// ───────────────────────────── Ventas · siguiente acción (Fase 2) ─────────────────────────────

/** Reglas de ventas que otro origen cubre mejor (sin duplicar): el seguimiento de la visita lo propone «Visitas». */
const SALES_RULES_COVERED_ELSEWHERE = new Set(["visit_followup"]);

export async function collectSales(db: Executor, orgId: string, s: ManagementSettings, now: Date, onlyContactIds?: string[]): Promise<Collected> {
  if (!(await isEnabled(db, "ai_matching"))) return { source: "sales_nba", candidates: [], evaluatedEntityIds: [] };
  const contacts = onlyContactIds?.length
    ? onlyContactIds
    : (
        await sql<{ contact_id: string }>`
          select contact_id from (
            select l.contact_id, max(l.updated_at) as at from leads l
             where l.organization_id = ${orgId} and l.deleted_at is null and l.status in ('new', 'contacted', 'qualified') group by l.contact_id
            union all
            select o.contact_id, max(o.updated_at) from opportunities o
             where o.organization_id = ${orgId} and o.deleted_at is null and o.status = 'open' group by o.contact_id
            union all
            select r.contact_id, max(r.updated_at) from sales_recommendations r
             where r.organization_id = ${orgId} and r.source = 'sales_nba' and r.status = 'open' and r.contact_id is not null group by r.contact_id
          ) x join contacts c on c.id = x.contact_id and c.deleted_at is null and c.merged_into_id is null
          group by contact_id order by max(at) desc limit ${s.maxContactsPerRun}`.execute(db)
      ).rows.map((r) => r.contact_id);
  const candidates: SuggestionCandidate[] = [];
  for (const contactId of contacts) {
    const facts = await gatherNbaFacts(db, orgId, { contactId, leadId: null, opportunityId: null, scopeUserId: null }, now);
    const recs = recommendNextActions(facts, 3).filter((r) => !SALES_RULES_COVERED_ELSEWHERE.has(r.ruleKey));
    if (!recs.length) continue;
    const assignedUserId = await salesAssignee(db, orgId, contactId, facts.lead?.id ?? null);
    for (const rec of recs) {
      candidates.push({
        source: "sales_nba",
        ruleKey: rec.ruleKey,
        entityType: "contact",
        entityId: contactId,
        contactId,
        assignedUserId,
        priority: rec.priority,
        title: rec.title,
        reason: clip(rec.reason, 500),
        evidence: rec.evidence.slice(0, 10),
        link: facts.lead ? `/crm/leads/${facts.lead.id}` : `/crm/contactos/${contactId}`,
        fingerprint: rec.fingerprint,
        task: rec.task,
      });
    }
  }
  return { source: "sales_nba", candidates, evaluatedEntityIds: contacts };
}

// ───────────────────────────── Visitas · cierre (núcleo operativo + Fase 4b) ─────────────────────────────

/** `appointmentId`: solo esa visita y sin la espera de 1 h para el informe (reacción a appointment.finished). */
export async function collectVisits(db: Executor, orgId: string, now: Date, opts: { appointmentId?: string } = {}): Promise<Collected> {
  if (!(await isEnabled(db, "visits_operations"))) return { source: "visit", candidates: [], evaluatedEntityIds: null };
  const rows = await sql<{
    id: string;
    finished_at: Date;
    assigned_user_id: string;
    code: number | null;
    report_status: string | null;
    interest: string | null;
    follow_up_at: Date | null;
    has_task: boolean;
    follow_up_task_id: string | null;
    has_thanks: boolean;
  }>`
    select a.id, coalesce(a.finished_at, a.ends_at) as finished_at, a.assigned_user_id, p.code, r.status as report_status, r.interest, r.follow_up_at,
           exists (select 1 from tasks t where t.entity_type = 'appointment' and t.entity_id = a.id and t.status <> 'cancelled') as has_task,
           a.follow_up_task_id,
           exists (select 1 from appointment_thanks th where th.appointment_id = a.id) as has_thanks
      from appointments a join users u on u.id = a.assigned_user_id
      left join properties p on p.id = a.property_id left join appointment_reports r on r.appointment_id = a.id
     where u.organization_id = ${orgId} and a.kind = 'visit' and a.status = 'completed'
       and coalesce(a.finished_at, a.ends_at) >= ${new Date(now.getTime() - 14 * 24 * HOUR)}
       ${opts.appointmentId ? sql`and a.id = ${opts.appointmentId}` : sql``}
     limit 2000`.execute(db);
  const out: SuggestionCandidate[] = [];
  for (const v of rows.rows) {
    const prop = v.code ? ` (Prop. ${v.code})` : "";
    const hours = Math.floor((now.getTime() - v.finished_at.getTime()) / HOUR);
    const base = { source: "visit" as const, entityType: "appointment" as const, entityId: v.id, assignedUserId: v.assigned_user_id, link: `/crm/mis-visitas/${v.id}` };
    if (v.report_status !== "confirmed" && (hours >= 1 || opts.appointmentId)) {
      out.push({
        ...base,
        ruleKey: "visit_report",
        priority: hours >= 24 ? "high" : "medium",
        title: `Cargar el informe de la visita${prop}`,
        reason: `La visita terminó hace ${hours} h y el informe ${v.report_status === "draft" ? "está en borrador" : "no está cargado"}: sin informe no hay seguimiento ni datos para el cliente.`,
        evidence: ["Visita finalizada", v.report_status === "draft" ? "Informe en borrador" : "Sin informe"],
        fingerprint: suggestionFingerprint(["visit_report", v.id]),
        task: { kind: "task", title: `Cargar el informe de la visita${prop}`, dueInHours: 4, priority: "high" },
      });
    }
    if (v.report_status === "confirmed" && !v.follow_up_task_id && !v.has_task) {
      const due = v.follow_up_at && v.follow_up_at.getTime() > now.getTime() ? Math.max(1, Math.round((v.follow_up_at.getTime() - now.getTime()) / HOUR)) : 24;
      out.push({
        ...base,
        ruleKey: "visit_followup",
        priority: v.interest === "high" ? "high" : "medium",
        title: `Crear el seguimiento de la visita${prop}`,
        reason: `El informe está confirmado${v.interest === "high" ? " con interés alto" : ""} y todavía no hay una tarea de seguimiento.`,
        evidence: ["Informe confirmado", ...(v.interest ? [`Interés ${v.interest === "high" ? "alto" : v.interest === "medium" ? "medio" : "bajo"}`] : []), "Sin tarea de seguimiento"],
        fingerprint: suggestionFingerprint(["visit_followup", v.id]),
        task: { kind: "follow_up", title: `Seguimiento de la visita${prop}`, dueInHours: due, priority: "normal" },
      });
    }
    if (!v.has_thanks && hours < 7 * 24) {
      out.push({
        ...base,
        ruleKey: "visit_thanks",
        priority: "low",
        title: `Preparar el agradecimiento de la visita${prop}`,
        reason: "La plantilla del agradecimiento está lista para revisar y guardar. Se envía solo si una persona lo decide.",
        evidence: ["Visita finalizada", "Agradecimiento sin preparar"],
        fingerprint: suggestionFingerprint(["visit_thanks", v.id]),
        task: { kind: "whatsapp", title: `Preparar y enviar el agradecimiento${prop}`, dueInHours: 24, priority: "low" },
      });
    }
  }
  return { source: "visit", candidates: out, evaluatedEntityIds: null };
}

// ───────────────────────────── Alertas del centro operativo ─────────────────────────────

const OPS_ALERT_KINDS: AlertKind[] = ["unassigned_upcoming", "no_checkin", "checkin_needs_review", "not_finished", "overrun"];

export async function collectOpsAlerts(db: Executor, orgId: string): Promise<Collected> {
  if (!(await isEnabled(db, "visits_operations"))) return { source: "ops_alert", candidates: [], evaluatedEntityIds: null };
  const rows = await sql<{ id: string; kind: AlertKind; severity: string; appointment_id: string; code: number | null; starts_at: Date }>`
    select al.id, al.kind, al.severity, a.id as appointment_id, p.code, a.starts_at
      from visit_alerts al join appointments a on a.id = al.appointment_id join users u on u.id = a.assigned_user_id
      left join properties p on p.id = a.property_id
     where u.organization_id = ${orgId} and al.resolved_at is null and al.kind = any(${OPS_ALERT_KINDS})
     limit 1000`.execute(db);
  return {
    source: "ops_alert",
    evaluatedEntityIds: null,
    candidates: rows.rows.map((r) => ({
      source: "ops_alert",
      ruleKey: `alert_${r.kind}`,
      entityType: "appointment",
      entityId: r.appointment_id,
      assignedUserId: null,
      priority: r.severity === "critical" ? "high" : "medium",
      title: `${ALERT_LABEL[r.kind]}${r.code ? ` · Prop. ${r.code}` : ""}`,
      reason: r.kind === "unassigned_upcoming" ? "La visita está por empezar y su agente no está activo: reasignala desde el centro operativo." : "Alerta abierta del centro operativo: revisá la visita.",
      evidence: [ALERT_LABEL[r.kind], `Severidad ${r.severity === "critical" ? "crítica" : "advertencia"}`],
      link: `/crm/mis-visitas/${r.appointment_id}`,
      fingerprint: suggestionFingerprint(["ops_alert", r.id]),
      task: { kind: "task", title: `Revisar: ${ALERT_LABEL[r.kind]}${r.code ? ` (Prop. ${r.code})` : ""}`, dueInHours: 1, priority: r.severity === "critical" ? "urgent" : "high" },
    })),
  };
}

// ───────────────────────────── Asignaciones pendientes ─────────────────────────────

export async function collectAssignments(db: Executor, orgId: string, now: Date): Promise<Collected> {
  const rows = await sql<{ id: string; created_at: Date; source_name: string | null; code: number | null }>`
    select l.id, l.created_at, ls.name as source_name, p.code
      from leads l left join lead_sources ls on ls.key = l.source_key left join properties p on p.id = l.property_id
     where l.organization_id = ${orgId} and l.deleted_at is null and l.status = 'new' and l.assigned_user_id is null
       and l.created_at <= ${new Date(now.getTime() - 30 * 60_000)}
     order by l.created_at limit 500`.execute(db);
  return {
    source: "assignment",
    evaluatedEntityIds: null,
    candidates: rows.rows.map((r) => {
      const hours = Math.floor((now.getTime() - r.created_at.getTime()) / HOUR);
      return {
        source: "assignment",
        ruleKey: "assign_lead",
        entityType: "lead",
        entityId: r.id,
        assignedUserId: null,
        priority: hours >= 2 ? "high" : "medium",
        title: "Asignar el lead a un agente",
        reason: `Consulta nueva sin agente asignado${hours >= 1 ? ` hace ${hours} h` : ""}: nadie la va a responder hasta que se asigne.`,
        evidence: ["Lead nuevo sin asignar", ...(r.source_name ? [`Origen: ${r.source_name}`] : []), ...(r.code ? [`Propiedad #${r.code}`] : [])],
        link: `/crm/leads/${r.id}`,
        fingerprint: suggestionFingerprint(["assign_lead", r.id]),
        task: { kind: "task", title: "Asignar el lead a un agente", dueInHours: 1, priority: "high" },
      };
    }),
  };
}

// ───────────────────────────── Calidad de la publicación (Fase 3) ─────────────────────────────

type Finding = { code?: string; severity?: string; title?: string };

export async function collectQuality(db: Executor, orgId: string, s: ManagementSettings): Promise<Collected> {
  if (!(await isEnabled(db, "ai_property_quality"))) return { source: "property_quality", candidates: [], evaluatedEntityIds: null };
  const rows = await sql<{ id: string; code: number; score: number; rules_version: string; findings: Finding[]; agent_id: string | null }>`
    select p.id, p.code, q.score, q.rules_version, q.findings,
           (select pa.user_id from property_agents pa join users u on u.id = pa.user_id where pa.property_id = p.id and pa.role = 'lead' and u.is_active and u.deleted_at is null) as agent_id
      from property_quality_reports q join properties p on p.id = q.property_id
     where p.organization_id = ${orgId} and p.is_published and not p.is_demo and p.deleted_at is null and p.status in ('available', 'reserved')
       and q.score < ${s.lowQualityScore}
     order by q.score limit 1000`.execute(db);
  return {
    source: "property_quality",
    evaluatedEntityIds: null,
    candidates: rows.rows.map((r) => {
      const top = (Array.isArray(r.findings) ? r.findings : []).filter((f) => f.severity === "error" || f.severity === "warning").slice(0, 3);
      return {
        source: "property_quality",
        ruleKey: "improve_listing",
        entityType: "property",
        entityId: r.id,
        assignedUserId: r.agent_id,
        priority: r.score < 40 ? "medium" : "low",
        title: `Mejorar la ficha #${r.code} (calidad ${r.score}/100)`,
        reason: `La publicación tiene calidad baja (${r.score}/100).${top.length ? ` Lo más importante: ${top.map((f) => clip(f.title ?? "", 60).toLowerCase()).join(", ")}.` : ""}`,
        evidence: [`Calidad ${r.score}/100 (baja: menos de ${s.lowQualityScore})`, ...top.map((f) => clip(f.title ?? "", 120))],
        link: `/crm/propiedades/${r.id}`,
        fingerprint: suggestionFingerprint(["improve_listing", r.id, r.rules_version]),
        task: { kind: "task", title: `Mejorar la ficha #${r.code}`, dueInHours: 72, priority: "normal" },
      };
    }),
  };
}

// ───────────────────────────── Marketing (creadas por la reacción a property.published) ─────────────────────────────

/** Solo vence las sugerencias de marketing cuya propiedad ya no está publicada o que no tienen borradores abiertos. */
export async function collectMarketing(db: Executor, orgId: string): Promise<Collected> {
  const rows = await sql<{ id: string; entity_id: string; code: number; priority: string; title: string; reason: string; evidence: string[]; link: string; fingerprint: string; task_template: SuggestionCandidate["task"]; assigned_user_id: string | null }>`
    select r.id, r.entity_id, p.code, r.priority, r.title, r.reason, r.evidence, r.link, r.fingerprint, r.task_template, r.assigned_user_id
      from sales_recommendations r join properties p on p.id = r.entity_id
     where r.organization_id = ${orgId} and r.source = 'marketing' and r.status in ('open', 'snoozed')
       and p.is_published and p.deleted_at is null and r.created_at >= now() - interval '14 days'
       and (exists (select 1 from property_marketing_drafts d where d.property_id = p.id and d.status = 'draft')
         or exists (select 1 from social_posts sp where sp.property_id = p.id and sp.status in ('draft', 'in_review')))`.execute(db);
  return {
    source: "marketing",
    evaluatedEntityIds: null,
    candidates: rows.rows.map((r) => ({
      source: "marketing",
      ruleKey: "marketing_review",
      entityType: "property",
      entityId: r.entity_id,
      assignedUserId: r.assigned_user_id,
      priority: r.priority as SuggestionCandidate["priority"],
      title: r.title,
      reason: r.reason,
      evidence: r.evidence,
      link: r.link,
      fingerprint: r.fingerprint,
      task: r.task_template,
    })),
  };
}

// ───────────────────────────── Anomalías ─────────────────────────────

/**
 * Anomalías sin sugerencia equivalente en otro origen. `lead_uncontacted` y `visit_without_followup` ya están cubiertas
 * por «Responder la consulta / Contactar hoy» (Ventas) y «Crear el seguimiento de la visita» (Visitas): no se duplican.
 */
export const ANOMALY_TO_SUGGEST: AnomalyKind[] = ["property_inquiry_drop", "data_contradiction", "job_failure_spike", "ai_failure_spike"];

const ANOMALY_TASK: Record<string, (code: string) => { title: string; dueInHours: number }> = {
  property_inquiry_drop: (c) => ({ title: `Revisar la publicación ${c}: bajaron las consultas`, dueInHours: 72 }),
  data_contradiction: (c) => ({ title: `Corregir datos contradictorios de la ficha ${c}`, dueInHours: 72 }),
  job_failure_spike: () => ({ title: "Revisar las tareas automáticas fallidas", dueInHours: 4 }),
  ai_failure_spike: () => ({ title: "Revisar las fallas de la IA", dueInHours: 4 }),
};

export async function collectAnomalies(db: Executor, orgId: string): Promise<Collected> {
  const rows = await sql<{ id: string; kind: AnomalyKind; entity_type: string; entity_id: string | null; severity: string; title: string; evidence: Evidence[]; assigned_user_id: string | null; code: number | null }>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.severity, a.title, a.evidence, a.assigned_user_id, p.code
      from ai_anomalies a left join properties p on p.id = a.entity_id and a.entity_type = 'property'
     where a.organization_id = ${orgId} and a.resolved_at is null and a.kind = any(${ANOMALY_TO_SUGGEST})`.execute(db);
  return {
    source: "anomaly",
    evaluatedEntityIds: null,
    candidates: rows.rows.map((r) => {
      const t = ANOMALY_TASK[r.kind]!(r.code ? `#${r.code}` : "");
      return {
        source: "anomaly",
        ruleKey: r.kind,
        entityType: r.entity_type === "property" ? "property" : "organization",
        entityId: r.entity_type === "property" ? r.entity_id : null,
        assignedUserId: r.assigned_user_id,
        priority: r.severity === "critical" ? "high" : r.severity === "warning" ? "medium" : "low",
        title: clip(r.title, 200),
        reason: "Anomalía detectada con reglas deterministas; revisá la evidencia antes de decidir.",
        evidence: (r.evidence ?? []).slice(0, 6).map((e) => clip(`${e.label}: ${e.value}`, 200)),
        link: anomalyLink(r.kind, r.entity_id),
        fingerprint: suggestionFingerprint(["anomaly", r.id]),
        task: { kind: "task", title: t.title, dueInHours: t.dueInHours, priority: r.severity === "critical" ? "urgent" : "normal" },
      };
    }),
  };
}
