/**
 * Tareas periódicas del núcleo de visitas (idempotentes; con el flag apagado no hacen nada):
 * - visits.alerts (cada 5 min): calcula alertas deterministas, las resuelve solas y notifica una vez por visita.
 * - visits.links_expire (horaria): registra el vencimiento de links (timeline + client_link.expired).
 * - visits.location_retention (diaria): anonimiza coordenadas crudas de check-ins vencidas la retención.
 */
import { sql, type Database } from "../db";
import type { Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { isEnabled } from "../flags";
import { registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { notifyRole, notifyUser } from "../notifications";
import { ALERT_LABEL, ALERT_SEVERITY, clientLinkExpiresAt, evaluateVisitAlerts, NOTIFIED_ALERTS, type AlertKind } from "./rules";
import { getVisitSettings } from "./settings";
import { recordVisitEvent } from "./timeline";

const ACTIVE = ["scheduled", "confirmed", "en_route", "checked_in", "in_progress"];

export async function computeVisitAlerts(db: Database, actor: Actor, now = new Date()): Promise<{ open: number; opened: number; resolved: number; notified: number }> {
  if (!(await isEnabled(db, "visits_operations"))) return { open: 0, opened: 0, resolved: 0, notified: 0 };
  const s = await getVisitSettings(db);
  const horizon = new Date(now.getTime() + s.upcomingHours * 3_600_000);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await db
    .selectFrom("appointments as a")
    .innerJoin("users as u", "u.id", "a.assigned_user_id")
    .innerJoin("properties as p", "p.id", "a.property_id")
    .leftJoin("appointment_reports as r", "r.appointment_id", "a.id")
    .select([
      "a.id",
      "a.status",
      "a.starts_at",
      "a.ends_at",
      "a.started_at",
      "a.finished_at",
      "a.follow_up_task_id",
      "a.assigned_user_id",
      "a.title",
      "p.code as property_code",
      sql<boolean>`(u.is_active and u.deleted_at is null)`.as("agent_active"),
      "r.status as report_status",
      sql<string | null>`(select ck.verification_status from appointment_checkins ck where ck.appointment_id = a.id order by ck.attempt desc limit 1)`.as("last_checkin_status"),
    ])
    .where("a.kind", "=", "visit")
    .where((eb) =>
      eb.or([
        eb.and([eb("a.status", "in", ACTIVE), eb("a.starts_at", "<=", horizon), eb("a.starts_at", ">=", since)]),
        eb.and([eb("a.status", "=", "completed"), eb("a.finished_at", ">=", since)]),
        eb.exists(eb.selectFrom("visit_alerts as al").select("al.id").whereRef("al.appointment_id", "=", "a.id").where("al.resolved_at", "is", null)),
      ]),
    )
    .limit(2000)
    .execute();

  let opened = 0;
  let resolved = 0;
  let notified = 0;
  let open = 0;
  for (const v of rows) {
    const kinds = evaluateVisitAlerts(
      {
        status: v.status,
        startsAt: v.starts_at,
        endsAt: v.ends_at,
        startedAt: v.started_at,
        finishedAt: v.finished_at,
        agentActive: v.agent_active,
        lastCheckinStatus: v.last_checkin_status,
        reportStatus: (v.report_status as "draft" | "confirmed" | null) ?? null,
        hasFollowUp: Boolean(v.follow_up_task_id),
      },
      now,
      s,
    );
    await db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable("visit_alerts")
        .set({ resolved_at: now })
        .where("appointment_id", "=", v.id)
        .where("resolved_at", "is", null)
        .$if(kinds.length > 0, (q) => q.where("kind", "not in", kinds))
        .executeTakeFirst();
      resolved += Number(r.numUpdatedRows);
      for (const kind of kinds) {
        const row = await sql<{ id: string; notified_at: Date | null; inserted: boolean }>`
          insert into visit_alerts(appointment_id, kind, severity, detected_at)
          values (${v.id}, ${kind}, ${ALERT_SEVERITY[kind]}, ${now})
          on conflict (appointment_id, kind) do update set resolved_at = null
          returning id, notified_at, (xmax = 0) as inserted`.execute(trx);
        const a = row.rows[0]!;
        open++;
        if (a.inserted) opened++;
        // Notificación única por (visita, tipo): notified_at no se borra aunque la alerta se resuelva y reaparezca.
        if (NOTIFIED_ALERTS.has(kind) && !a.notified_at) {
          await notifyAlert(trx, v, kind);
          await trx.updateTable("visit_alerts").set({ notified_at: now }).where("id", "=", a.id).execute();
          notified++;
        }
      }
    });
  }
  return { open, opened, resolved, notified };
}

async function notifyAlert(trx: Parameters<typeof notifyUser>[0], v: { id: string; assigned_user_id: string; title: string; property_code: number }, kind: AlertKind): Promise<void> {
  const n = {
    kind: `visit.alert.${kind}`,
    title: ALERT_LABEL[kind],
    body: `${v.title} (Prop. ${v.property_code})`,
    link: `/crm/mis-visitas/${v.id}`,
    entityType: "appointment",
    entityId: v.id,
    dedupeKey: `visit_alert:${kind}:${v.id}`,
  };
  if (kind !== "unassigned_upcoming") await notifyUser(trx, v.assigned_user_id, n);
  await notifyRole(trx, "administrador", { ...n, link: "/crm/centro-operativo" });
  await notifyRole(trx, "direccion", { ...n, link: "/crm/centro-operativo" });
}

export async function recordExpiredClientLinks(db: Database, actor: Actor, now = new Date()): Promise<number> {
  if (!(await isEnabled(db, "visits_operations"))) return 0;
  const s = await getVisitSettings(db);
  const rows = await db
    .selectFrom("appointment_public_links as l")
    .innerJoin("appointments as a", "a.id", "l.appointment_id")
    .select(["l.id", "l.expires_at", "a.id as appointment_id", "a.ends_at", "a.finished_at", "a.assigned_user_id", "a.title"])
    .where("l.revoked_at", "is", null)
    .where("l.expired_recorded_at", "is", null)
    .where("a.ends_at", "<", now)
    .limit(1000)
    .execute();
  let n = 0;
  for (const l of rows) {
    const exp = clientLinkExpiresAt({ endsAt: l.ends_at, finishedAt: l.finished_at, hardExpiresAt: l.expires_at, graceHours: s.clientLinkGraceHours });
    if (exp.getTime() > now.getTime()) continue;
    await db.transaction().execute(async (trx) => {
      const r = await trx.updateTable("appointment_public_links").set({ expired_recorded_at: now }).where("id", "=", l.id).where("expired_recorded_at", "is", null).executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) return;
      await recordVisitEvent(trx, actor, l.appointment_id, "client_link_expired", { linkId: l.id }, `client_link_expired:${l.id}`);
      await emitEvent(trx, actor, {
        type: "client_link.expired",
        aggregateType: "appointment",
        aggregateId: l.appointment_id,
        payload: { linkId: l.id, assignedUserId: l.assigned_user_id, link: `/crm/mis-visitas/${l.appointment_id}`, summary: l.title },
        dedupeKey: `client_link.expired:${l.id}`,
      });
      n++;
    });
  }
  return n;
}

/** Anonimiza coordenadas crudas vencidas: quedan estado, motivo y distancia. Corre aunque el flag esté apagado. */
export async function purgeCheckinLocations(db: Database, now = new Date()): Promise<number> {
  const s = await getVisitSettings(db);
  const cutoff = new Date(now.getTime() - s.locationRetentionDays * 86_400_000);
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const r = await sql`
      update appointment_checkins set latitude = null, longitude = null, accuracy_m = null, coords_purged_at = ${now}
       where id in (select id from appointment_checkins where server_at < ${cutoff} and (latitude is not null or accuracy_m is not null) limit 1000)`.execute(db);
    const n = Number(r.numAffectedRows ?? 0);
    total += n;
    if (n < 1000) break;
  }
  return total;
}

registerJobHandler("visits.alerts", async (_p, ctx) => computeVisitAlerts(ctx.db, ctx.actor));
registerJobHandler("visits.links_expire", async (_p, ctx) => ({ expired: await recordExpiredClientLinks(ctx.db, ctx.actor) }));
registerJobHandler("visits.location_retention", async (_p, ctx) => ({ purged: await purgeCheckinLocations(ctx.db) }));

addScheduledTask({ type: "visits.alerts", every: "every_5_minutes", timeoutMs: 60_000 });
addScheduledTask({ type: "visits.links_expire", every: "hourly" });
addScheduledTask({ type: "visits.location_retention", every: "daily" });
