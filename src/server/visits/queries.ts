/** Lecturas del portal de visitas y del centro operativo (alcance resuelto en el servidor). */
import { sql, type Executor } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { addDays, localDate, localDayRange } from "../crm/time";
import type { CrmMediaRef } from "../media/crm-preview";
import { loadVisit, visitScope } from "./access";
import { propertyPoint } from "./geofence";
import { clientLinkExpiresAt, firstName, suggestFollowUpAt, thankYouTemplate, type AlertKind, type Interest } from "./rules";
import { getVisitSettings } from "./settings";
import { VISIT_EVENT_KINDS, type VisitEventKind } from "./timeline";

const coverSql = sql<CrmMediaRef | null>`(select jsonb_build_object('file_id', pm.file_id, 'source_url', pm.source_url, 'file_storage_driver', f.storage_driver, 'file_storage_key', f.storage_key, 'file_visibility', f.visibility)
  from property_media pm left join files f on f.id = pm.file_id and f.deleted_at is null
  where pm.property_id = p.id and pm.deleted_at is null and pm.kind = 'image' and pm.status <> 'failed' order by pm.is_cover desc, pm.sort_order, pm.created_at limit 1)`;

const lastCheckinSql = sql<{ status: string; distance_m: number | null; reason: string } | null>`(select jsonb_build_object('status', ck.verification_status, 'distance_m', ck.distance_m, 'reason', ck.reason)
  from appointment_checkins ck where ck.appointment_id = a.id order by ck.attempt desc limit 1)`;

export type VisitListView = "hoy" | "proximas";

export async function listMyVisits(db: Executor, actor: Actor, opts: { view: VisitListView; team?: boolean; now?: Date }) {
  const scope = visitScope(actor);
  const now = opts.now ?? new Date();
  const today = localDate(now);
  const range = opts.view === "hoy" ? localDayRange(today, 1) : { from: localDayRange(addDays(today, 1), 1).from, to: localDayRange(addDays(today, 15), 1).from };
  let q = db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .innerJoin("properties as p", "p.id", "a.property_id")
    .leftJoin("contacts as c", "c.id", "a.contact_id")
    .select([
      "a.id",
      "a.title",
      "a.status",
      "a.starts_at",
      "a.ends_at",
      "a.assigned_user_id",
      "u.full_name as agent_name",
      "p.code as property_code",
      "p.title as property_title",
      "c.display_name as contact_name",
      coverSql.as("cover"),
      lastCheckinSql.as("last_checkin"),
    ])
    .where("a.kind", "=", "visit")
    .where("u.organization_id", "=", actor.organizationId)
    .where("a.starts_at", ">=", range.from)
    .where("a.starts_at", "<", range.to)
    .where("a.status", "<>", "cancelled");
  // Sin "equipo" (o sin alcance total) se ven solo las propias.
  if (!scope.all || !opts.team) q = q.where("a.assigned_user_id", "=", scope.userId);
  const rows = await q.orderBy("a.starts_at").limit(300).execute();
  return { rows, scopeAll: scope.all, today };
}

export async function getVisitDetail(db: Executor, actor: Actor, id: string, now = new Date()) {
  const v = await loadVisit(db, actor, id);
  const scope = visitScope(actor);
  const settings = await getVisitSettings(db);
  const [property, contact, phones, checkins, link, report, thanks, task, events] = await Promise.all([
    db
      .selectFrom("properties as p")
      .leftJoin("locations as l", "l.id", "p.location_id")
      .select(["p.id", "p.code", "p.title", "p.address_street", "p.address_number", "p.hide_exact_address", "p.latitude", "p.longitude", "l.name as location_name", coverSql.as("cover")])
      .where("p.id", "=", v.property_id!)
      .executeTakeFirstOrThrow(),
    v.contact_id ? db.selectFrom("contacts").select(["id", "display_name", "first_name"]).where("id", "=", v.contact_id).executeTakeFirst() : Promise.resolve(undefined),
    v.contact_id
      ? db.selectFrom("contact_phones").select(["id", "phone_raw", "phone_e164", "is_whatsapp", "is_primary"]).where("contact_id", "=", v.contact_id).orderBy("is_primary", "desc").execute()
      : Promise.resolve([]),
    // Al portal vuelven estado, motivo, distancia y precisión: nunca las coordenadas crudas.
    db
      .selectFrom("appointment_checkins")
      .select(["id", "attempt", "server_at", "verification_status", "reason", "reason_detail", "distance_m", "accuracy_m", "radius_m"])
      .where("appointment_id", "=", v.id)
      .orderBy("attempt", "desc")
      .execute(),
    db
      .selectFrom("appointment_public_links")
      .select(["id", "created_at", "expires_at", "last_opened_at", "open_count"])
      .where("appointment_id", "=", v.id)
      .where("revoked_at", "is", null)
      .executeTakeFirst(),
    db.selectFrom("appointment_reports").selectAll().where("appointment_id", "=", v.id).executeTakeFirst(),
    db.selectFrom("appointment_thanks").select(["message", "updated_at", "marked_sent_at", "sent_channel"]).where("appointment_id", "=", v.id).executeTakeFirst(),
    v.follow_up_task_id ? db.selectFrom("tasks").select(["id", "title", "due_at", "status"]).where("id", "=", v.follow_up_task_id).executeTakeFirst() : Promise.resolve(undefined),
    db
      .selectFrom("appointment_events as e")
      .leftJoin("users as u", "u.id", "e.actor_user_id")
      .select(["e.id", "e.kind", "e.actor_kind", "e.data", "e.occurred_at", "u.full_name as actor_name"])
      .where("e.appointment_id", "=", v.id)
      .orderBy("e.occurred_at", "desc")
      .orderBy("e.id", "desc")
      .limit(100)
      .execute(),
  ]);
  const agent = await db.selectFrom("users").select(["full_name"]).where("id", "=", v.assigned_user_id).executeTakeFirstOrThrow();
  const linkExpiresAt = link ? clientLinkExpiresAt({ endsAt: v.ends_at, finishedAt: v.finished_at, hardExpiresAt: link.expires_at, graceHours: settings.clientLinkGraceHours }) : null;
  const isAssigned = actor.kind === "staff" && actor.userId === v.assigned_user_id;
  const canManage = can(actor, "visits.operate") && (scope.all || isAssigned);
  const clientFirst = firstName(contact?.first_name ?? contact?.display_name);
  return {
    visit: v,
    agentName: agent.full_name,
    property: { ...property, hasCoordinates: Boolean(propertyPoint(property.latitude, property.longitude)) },
    contact,
    phones,
    checkins,
    link: link && linkExpiresAt ? { ...link, effectiveExpiresAt: linkExpiresAt, expired: linkExpiresAt.getTime() <= now.getTime() } : null,
    report,
    suggestedFollowUpAt: suggestFollowUpAt((report?.interest as Interest | null) ?? null, v.finished_at ?? now),
    thanks: thanks ?? null,
    thanksTemplate: thankYouTemplate({ clientFirstName: clientFirst, agentName: agent.full_name, propertyTitle: property.title }),
    clientFirstName: clientFirst,
    followUpTask: task ?? null,
    events: events.filter((e): e is typeof e & { kind: VisitEventKind } => (VISIT_EVENT_KINDS as readonly string[]).includes(e.kind)),
    permissions: { isAssigned, canManage, canMonitor: can(actor, "visits.monitor"), scopeAll: scope.all, canCreateTasks: can(actor, "tasks.manage") },
    settings: { radiusM: settings.radiusM, maxAccuracyM: settings.maxAccuracyM, checkinWindowMinutes: settings.checkinWindowMinutes },
  };
}

export type VisitDetail = Awaited<ReturnType<typeof getVisitDetail>>;

// ───────────────────────────── Centro operativo ─────────────────────────────

export async function getOpsBoard(db: Executor, actor: Actor, opts: { date: string; agentId?: string | null }) {
  requirePermission(actor, "visits.monitor");
  visitScope(actor);
  const range = localDayRange(opts.date, 1);
  let q = db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .innerJoin("properties as p", "p.id", "a.property_id")
    .leftJoin("contacts as c", "c.id", "a.contact_id")
    .leftJoin("appointment_reports as r", "r.appointment_id", "a.id")
    .select([
      "a.id",
      "a.status",
      "a.starts_at",
      "a.ends_at",
      "a.en_route_at",
      "a.checked_in_at",
      "a.started_at",
      "a.finished_at",
      "a.follow_up_task_id",
      "a.assigned_user_id",
      "u.full_name as agent_name",
      "u.is_active as agent_active",
      "p.code as property_code",
      "p.title as property_title",
      "c.display_name as contact_name",
      "r.status as report_status",
      lastCheckinSql.as("last_checkin"),
      sql<AlertKind[]>`coalesce((select array_agg(al.kind order by al.detected_at) from visit_alerts al where al.appointment_id = a.id and al.resolved_at is null), '{}')`.as("alerts"),
    ])
    .where("a.kind", "=", "visit")
    .where("u.organization_id", "=", actor.organizationId)
    .where("a.starts_at", ">=", range.from)
    .where("a.starts_at", "<", range.to);
  if (opts.agentId) q = q.where("a.assigned_user_id", "=", opts.agentId);
  const rows = await q.orderBy("a.starts_at").limit(500).execute();

  let alertsQ = db
    .selectFrom("visit_alerts as al")
    .innerJoin("appointments as a", "a.id", "al.appointment_id")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .innerJoin("properties as p", "p.id", "a.property_id")
    .select(["al.id", "al.kind", "al.severity", "al.detected_at", "a.id as appointment_id", "a.starts_at", "a.status", "u.full_name as agent_name", "p.code as property_code"])
    .where("al.resolved_at", "is", null)
    .where("u.organization_id", "=", actor.organizationId);
  if (opts.agentId) alertsQ = alertsQ.where("a.assigned_user_id", "=", opts.agentId);
  const openAlerts = await alertsQ
    .orderBy(sql`case al.severity when 'critical' then 0 when 'warning' then 1 else 2 end`)
    .orderBy("al.detected_at", "desc")
    .limit(200)
    .execute();
  return { rows, openAlerts };
}

export async function listTimeline(db: Executor, actor: Actor, id: string) {
  const v = await loadVisit(db, actor, id);
  return db.selectFrom("appointment_events").select(["kind", "actor_kind", "data", "occurred_at"]).where("appointment_id", "=", v.id).orderBy("occurred_at").orderBy("id").execute();
}
