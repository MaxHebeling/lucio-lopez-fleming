/**
 * Núcleo operativo de visitas: mutaciones (docs/operations/VISITS.md).
 * Reglas: autorización en servidor (access.ts), transición validada (state.ts + trigger), transacción con lock de la
 * visita, auditoría + timeline + evento de dominio en la misma transacción, idempotencia ante dobles toques.
 * Nada se envía al cliente desde acá: el link y los mensajes los comparte una persona.
 */
import { z } from "zod";
import type { SchemaIn } from "../crm/types";
import { pgCode, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { hashToken, newToken } from "../auth/tokens";
import { emitEvent } from "../events";
import { AppError, conflict, invalid, notFound } from "../errors";
import { isEnabled } from "../flags";
import { applyVisitCompleted, rescheduleAppointment } from "../agenda/service";
import { createTask } from "../tasks/service";
import { isLocalDateTime, localToUtc, utcToLocalInput } from "../crm/time";
import { assertAssignedAgent, assertCanManageVisit, loadVisit, type VisitRow } from "./access";
import { evaluateGeofence, LOCATION_PROBLEM_REASONS, propertyPoint, type CheckinReason, type CheckinVerification } from "./geofence";
import { CLIENT_LINK_MAX_DAYS, suggestFollowUpAt } from "./rules";
import { getVisitSettings, type VisitSettings } from "./settings";
import { canTransition, isTerminal, VISIT_PHASE_LABEL, visitPhase } from "./state";
import { recordVisitEvent } from "./timeline";

export const VISITS_FLAG = "visits_operations";
export const CLIENT_LINK_FLAG = "client_visit_link";

export async function assertVisitsEnabled(db: Database | Tx): Promise<void> {
  if (!(await isEnabled(db, VISITS_FLAG))) throw new AppError("unavailable", "El portal de visitas está desactivado");
}

const idSchema = z.object({ appointmentId: z.uuid() });
export const visitIdSchema = idSchema;

function payload(v: VisitRow, extra: Record<string, unknown> = {}) {
  return { assignedUserId: v.assigned_user_id, propertyId: v.property_id, contactId: v.contact_id, link: `/crm/mis-visitas/${v.id}`, summary: v.title, ...extra };
}

function blocked(v: VisitRow): AppError {
  return conflict(`La visita está «${VISIT_PHASE_LABEL[visitPhase(v.status)]}»: esta acción ya no corresponde. Actualizá la pantalla.`);
}

const hhmm = (d: Date) => utcToLocalInput(d).slice(11);

/** Presencia solo dentro de la franja de la cita (± ventana): nunca registro de ubicación fuera de una visita activa. */
function assertPresenceWindow(v: VisitRow, s: VisitSettings, now = new Date()): void {
  const w = s.checkinWindowMinutes * 60_000;
  if (now.getTime() < v.starts_at.getTime() - w) throw invalid(`Todavía es temprano: podés registrarlo desde las ${hhmm(new Date(v.starts_at.getTime() - w))}`);
  if (now.getTime() > v.ends_at.getTime() + w) throw conflict("La franja de la visita ya pasó: pedí que la reprogramen o cerrala desde la Agenda");
}

async function withVisit<T>(db: Database, actor: Actor, appointmentId: string, fn: (trx: Tx, v: VisitRow) => Promise<T>): Promise<T> {
  requirePermission(actor, "visits.operate");
  await assertVisitsEnabled(db);
  return db.transaction().execute(async (trx) => fn(trx, await loadVisit(trx, actor, appointmentId, { forUpdate: true })));
}

// ───────────────────────────── En camino ─────────────────────────────

export async function markEnRoute(db: Database, actor: Actor, raw: SchemaIn<typeof idSchema>): Promise<{ changed: boolean }> {
  const input = idSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertAssignedAgent(actor, v);
    if (v.status === "en_route") return { changed: false };
    if (!canTransition(v.status, "en_route")) throw blocked(v);
    assertPresenceWindow(v, await getVisitSettings(trx));
    const now = new Date();
    await trx.updateTable("appointments").set({ status: "en_route", en_route_at: now }).where("id", "=", v.id).execute();
    await audit(trx, actor, { action: "VISIT_EN_ROUTE", entityType: "appointment", entityId: v.id, before: { status: v.status }, after: { status: "en_route" } });
    await recordVisitEvent(trx, actor, v.id, "en_route");
    await emitEvent(trx, actor, { type: "appointment.en_route", aggregateType: "appointment", aggregateId: v.id, payload: payload(v) });
    return { changed: true };
  });
}

// ───────────────────────────── Check-in ─────────────────────────────

export const MAX_CHECKIN_ATTEMPTS = 3;

export const checkInSchema = z.object({
  appointmentId: z.uuid(),
  idempotencyKey: z.string().min(8).max(200),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(1_000_000),
  deviceTimestamp: z.coerce.number().int().positive().nullish(),
});

export const locationProblemSchema = z
  .object({
    appointmentId: z.uuid(),
    idempotencyKey: z.string().min(8).max(200),
    reason: z.enum(LOCATION_PROBLEM_REASONS),
    detail: z.string().trim().max(500).nullish().transform((v) => v || null),
  })
  .refine((v) => v.reason !== "other" || (v.detail?.length ?? 0) >= 3, { message: "Contá brevemente qué pasó", path: ["detail"] });

export type CheckinResult = {
  changed: boolean;
  checkin: { id: string; attempt: number; status: CheckinVerification; reason: CheckinReason; distanceM: number | null; serverAt: Date };
};

type CheckinRow = { id: string; attempt: number; verification_status: string; reason: string; distance_m: number | null; server_at: Date };

const toResult = (changed: boolean, r: CheckinRow): CheckinResult => ({
  changed,
  checkin: { id: r.id, attempt: r.attempt, status: r.verification_status as CheckinVerification, reason: r.reason as CheckinReason, distanceM: r.distance_m, serverAt: r.server_at },
});

const CHECKIN_COLS = ["id", "attempt", "verification_status", "reason", "distance_m", "server_at"] as const;

/**
 * Registra un intento de llegada. Primer intento: la visita pasa a check-in (aunque no se verifique: nunca bloquea).
 * Reintentos (hasta 3) solo mientras la visita sigue en check-in y el último intento no quedó verificado.
 */
async function registerCheckin(
  db: Database,
  actor: Actor,
  appointmentId: string,
  idempotencyKey: string,
  build: (trx: Tx, v: VisitRow, s: VisitSettings) => Promise<{ status: CheckinVerification; reason: CheckinReason; distanceM: number | null; lat: number | null; lng: number | null; accuracy: number | null; deviceAt: Date | null; detail: string | null }>,
): Promise<CheckinResult> {
  requirePermission(actor, "visits.operate");
  await assertVisitsEnabled(db);
  const replay = await db.selectFrom("appointment_checkins").select([...CHECKIN_COLS, "appointment_id", "user_id"]).where("idempotency_key", "=", idempotencyKey).executeTakeFirst();
  if (replay) {
    if (replay.appointment_id !== appointmentId || replay.user_id !== actorUserId(actor)) throw invalid("Clave de operación inválida");
    return toResult(false, replay);
  }
  try {
    return await db.transaction().execute(async (trx) => {
      const v = await loadVisit(trx, actor, appointmentId, { forUpdate: true });
      assertAssignedAgent(actor, v);
      const attempts = await trx.selectFrom("appointment_checkins").select(CHECKIN_COLS).where("appointment_id", "=", v.id).orderBy("attempt", "desc").execute();
      const last = attempts[0];
      const first = v.status === "scheduled" || v.status === "confirmed" || v.status === "en_route";
      if (!first) {
        if (v.status !== "checked_in" && v.status !== "in_progress") throw blocked(v);
        if (!last) throw blocked(v);
        // Doble toque o pantalla vieja: si ya está verificado o la visita avanzó, se devuelve lo registrado.
        if (last.verification_status === "verified" || v.status === "in_progress") return toResult(false, last);
        if (attempts.length >= MAX_CHECKIN_ATTEMPTS) throw conflict("Ya se registraron los 3 intentos de llegada. El check-in queda para revisión: podés iniciar la visita.");
      }
      const s = await getVisitSettings(trx);
      assertPresenceWindow(v, s);
      const r = await build(trx, v, s);
      const row = await trx
        .insertInto("appointment_checkins")
        .values({
          appointment_id: v.id,
          user_id: v.assigned_user_id,
          attempt: (last?.attempt ?? 0) + 1,
          device_at: r.deviceAt,
          latitude: r.lat,
          longitude: r.lng,
          accuracy_m: r.accuracy === null ? null : Math.round(r.accuracy * 10) / 10,
          distance_m: r.distanceM,
          radius_m: s.radiusM,
          max_accuracy_m: s.maxAccuracyM,
          verification_status: r.status,
          reason: r.reason,
          reason_detail: r.detail,
          idempotency_key: idempotencyKey,
        })
        .returning(CHECKIN_COLS)
        .executeTakeFirstOrThrow();
      // Timeline, auditoría y evento: estado, motivo y distancia. Nunca coordenadas.
      const info = { verification: r.status, reason: r.reason, distanceM: r.distanceM, attempt: row.attempt };
      if (first) {
        await trx.updateTable("appointments").set({ status: "checked_in", checked_in_at: row.server_at }).where("id", "=", v.id).execute();
        await recordVisitEvent(trx, actor, v.id, r.status === "no_location" ? "location_problem" : "checked_in", info);
        if (r.status === "no_location") await recordVisitEvent(trx, actor, v.id, "checked_in", info);
        await emitEvent(trx, actor, { type: "agent.checked_in", aggregateType: "appointment", aggregateId: v.id, payload: payload(v, info) });
      } else {
        await recordVisitEvent(trx, actor, v.id, r.status === "no_location" ? "location_problem" : "checkin_retry", info);
      }
      await audit(trx, actor, { action: "VISIT_CHECKED_IN", entityType: "appointment", entityId: v.id, before: { status: v.status }, after: { status: "checked_in", ...info } });
      return toResult(true, row);
    });
  } catch (e) {
    if (pgCode(e) === "23505") {
      const again = await db.selectFrom("appointment_checkins").select(CHECKIN_COLS).where("idempotency_key", "=", idempotencyKey).executeTakeFirst();
      if (again) return toResult(false, again);
      throw conflict("Otro intento de llegada se registró al mismo tiempo. Actualizá la pantalla.");
    }
    throw e;
  }
}

const DAY = 86_400_000;

export async function checkIn(db: Database, actor: Actor, raw: SchemaIn<typeof checkInSchema>): Promise<CheckinResult> {
  const input = checkInSchema.parse(raw);
  return registerCheckin(db, actor, input.appointmentId, input.idempotencyKey, async (trx, v, s) => {
    const prop = v.property_id ? await trx.selectFrom("properties").select(["latitude", "longitude"]).where("id", "=", v.property_id).executeTakeFirst() : undefined;
    const g = evaluateGeofence({ property: propertyPoint(prop?.latitude, prop?.longitude), position: { lat: input.latitude, lng: input.longitude, accuracy: input.accuracy }, radiusM: s.radiusM, maxAccuracyM: s.maxAccuracyM });
    const deviceAt = input.deviceTimestamp && Math.abs(input.deviceTimestamp - Date.now()) < DAY ? new Date(input.deviceTimestamp) : null;
    return { status: g.status, reason: g.reason, distanceM: g.distanceM, lat: input.latitude, lng: input.longitude, accuracy: input.accuracy, deviceAt, detail: null };
  });
}

/** GPS denegado, sin señal o sin soporte: registra `no_location` con motivo y NO bloquea la visita. */
export async function reportLocationProblem(db: Database, actor: Actor, raw: SchemaIn<typeof locationProblemSchema>): Promise<CheckinResult> {
  const input = locationProblemSchema.parse(raw);
  return registerCheckin(db, actor, input.appointmentId, input.idempotencyKey, async () => ({
    status: "no_location",
    reason: input.reason,
    distanceM: null,
    lat: null,
    lng: null,
    accuracy: null,
    deviceAt: null,
    detail: input.detail,
  }));
}

// ───────────────────────────── Iniciar / finalizar ─────────────────────────────

export async function startVisit(db: Database, actor: Actor, raw: SchemaIn<typeof idSchema>): Promise<{ changed: boolean }> {
  const input = idSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertAssignedAgent(actor, v);
    if (v.status === "in_progress") return { changed: false };
    if (!canTransition(v.status, "in_progress")) throw blocked(v);
    await trx.updateTable("appointments").set({ status: "in_progress", started_at: new Date() }).where("id", "=", v.id).execute();
    await audit(trx, actor, { action: "VISIT_STARTED", entityType: "appointment", entityId: v.id, before: { status: v.status }, after: { status: "in_progress" } });
    await recordVisitEvent(trx, actor, v.id, "started");
    await emitEvent(trx, actor, { type: "appointment.started", aggregateType: "appointment", aggregateId: v.id, payload: payload(v), dedupeKey: `appointment.started:${v.id}` });
    return { changed: true };
  });
}

export async function finishVisit(db: Database, actor: Actor, raw: SchemaIn<typeof idSchema>): Promise<{ changed: boolean; opportunityAdvanced: boolean }> {
  const input = idSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertCanManageVisit(actor, v);
    if (v.status === "completed") return { changed: false, opportunityAdvanced: false };
    if (v.status !== "in_progress") throw blocked(v);
    await trx.updateTable("appointments").set({ status: "completed", finished_at: new Date() }).where("id", "=", v.id).execute();
    await audit(trx, actor, { action: "VISIT_FINISHED", entityType: "appointment", entityId: v.id, before: { status: v.status }, after: { status: "completed" } });
    await recordVisitEvent(trx, actor, v.id, "finished");
    await emitEvent(trx, actor, { type: "appointment.finished", aggregateType: "appointment", aggregateId: v.id, payload: payload(v), dedupeKey: `appointment.finished:${v.id}` });
    const opportunityAdvanced = await applyVisitCompleted(trx, actor, v, { result: null, followUpMode: "manual" });
    return { changed: true, opportunityAdvanced };
  });
}

// ───────────────────────────── Link del cliente ─────────────────────────────

export type CreatedClientLink = { linkId: string; token: string; path: string };

async function insertLink(trx: Tx, actor: Actor, v: VisitRow): Promise<CreatedClientLink> {
  const token = newToken(32);
  const now = new Date();
  const row = await trx
    .insertInto("appointment_public_links")
    .values({ appointment_id: v.id, token_hash: hashToken(token), created_by: actorUserId(actor), created_at: now, expires_at: new Date(now.getTime() + CLIENT_LINK_MAX_DAYS * DAY) })
    .returning("id")
    .executeTakeFirstOrThrow();
  // El token no va a la base, ni a la auditoría, ni al evento: solo al agente que lo pidió.
  await emitEvent(trx, actor, { type: "client_link.created", aggregateType: "appointment", aggregateId: v.id, payload: payload(v, { linkId: row.id }), dedupeKey: `client_link.created:${row.id}` });
  return { linkId: row.id, token, path: `/visita/${token}` };
}

async function linkGuard(db: Database, actor: Actor, appointmentId: string, fn: (trx: Tx, v: VisitRow) => Promise<CreatedClientLink>): Promise<CreatedClientLink> {
  if (!(await isEnabled(db, CLIENT_LINK_FLAG))) throw new AppError("unavailable", "El link del cliente está desactivado");
  try {
    return await withVisit(db, actor, appointmentId, async (trx, v) => {
      assertCanManageVisit(actor, v);
      if (isTerminal(v.status)) throw conflict("La visita ya terminó: no se generan links nuevos");
      return fn(trx, v);
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("Ya hay un link activo para esta visita. Actualizá la pantalla.");
    throw e;
  }
}

export async function createClientLink(db: Database, actor: Actor, raw: SchemaIn<typeof idSchema>): Promise<CreatedClientLink> {
  const input = idSchema.parse(raw);
  return linkGuard(db, actor, input.appointmentId, async (trx, v) => {
    const active = await trx.selectFrom("appointment_public_links").select("id").where("appointment_id", "=", v.id).where("revoked_at", "is", null).executeTakeFirst();
    if (active) throw conflict("Ya hay un link activo. Por seguridad no se puede volver a mostrar: rotalo para generar uno nuevo.");
    const link = await insertLink(trx, actor, v);
    await audit(trx, actor, { action: "VISIT_CLIENT_LINK_CREATED", entityType: "appointment", entityId: v.id, after: { linkId: link.linkId } });
    await recordVisitEvent(trx, actor, v.id, "client_link_created", { linkId: link.linkId });
    return link;
  });
}

/** Rota: el link anterior deja de funcionar en el acto y se genera uno nuevo. */
export async function rotateClientLink(db: Database, actor: Actor, raw: SchemaIn<typeof idSchema>): Promise<CreatedClientLink> {
  const input = idSchema.parse(raw);
  return linkGuard(db, actor, input.appointmentId, async (trx, v) => {
    const revoked = await trx
      .updateTable("appointment_public_links")
      .set({ revoked_at: new Date(), revoked_by: actorUserId(actor), revoke_reason: "rotated" })
      .where("appointment_id", "=", v.id)
      .where("revoked_at", "is", null)
      .returning("id")
      .execute();
    const link = await insertLink(trx, actor, v);
    await audit(trx, actor, { action: "VISIT_CLIENT_LINK_ROTATED", entityType: "appointment", entityId: v.id, before: { linkIds: revoked.map((r) => r.id) }, after: { linkId: link.linkId } });
    await recordVisitEvent(trx, actor, v.id, revoked.length ? "client_link_rotated" : "client_link_created", { linkId: link.linkId });
    return link;
  });
}

export async function revokeClientLink(db: Database, actor: Actor, raw: SchemaIn<typeof idSchema>): Promise<{ changed: boolean }> {
  const input = idSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertCanManageVisit(actor, v);
    const revoked = await trx
      .updateTable("appointment_public_links")
      .set({ revoked_at: new Date(), revoked_by: actorUserId(actor), revoke_reason: "manual" })
      .where("appointment_id", "=", v.id)
      .where("revoked_at", "is", null)
      .returning("id")
      .execute();
    if (!revoked.length) return { changed: false };
    await audit(trx, actor, { action: "VISIT_CLIENT_LINK_REVOKED", entityType: "appointment", entityId: v.id, before: { linkIds: revoked.map((r) => r.id) } });
    await recordVisitEvent(trx, actor, v.id, "client_link_revoked", { linkId: revoked[0]!.id });
    return { changed: true };
  });
}

// ───────────────────────────── Informe post-visita ─────────────────────────────

const optText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`).nullish().transform((v) => v || null);

export const reportSchema = z.object({
  appointmentId: z.uuid(),
  body: z.string().trim().min(3, "Contá cómo fue la visita (mínimo 3 caracteres)").max(10_000, "Máximo 10.000 caracteres"),
  interest: z.enum(["low", "medium", "high"]).nullish().transform((v) => v ?? null),
  positives: optText(2000),
  objections: optText(2000),
  nextStep: optText(500),
  followUpAt: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || isLocalDateTime(v), "Fecha y hora inválidas"),
  dictated: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional().transform((v) => v === true || v === "true"),
  confirm: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional().transform((v) => v === true || v === "true"),
});

export async function saveVisitReport(db: Database, actor: Actor, raw: SchemaIn<typeof reportSchema>): Promise<{ status: "draft" | "confirmed"; followUpAt: Date | null }> {
  const input = reportSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertCanManageVisit(actor, v);
    if (v.status !== "completed") throw conflict("El informe se carga cuando la visita está finalizada");
    const prev = await trx.selectFrom("appointment_reports").selectAll().where("appointment_id", "=", v.id).forUpdate().executeTakeFirst();
    const now = new Date();
    let followUpAt = input.followUpAt ? localToUtc(input.followUpAt) : null;
    if (input.confirm && !followUpAt) followUpAt = suggestFollowUpAt(input.interest, v.finished_at ?? now);
    const values = {
      body: input.body,
      interest: input.interest,
      positives: input.positives,
      objections: input.objections,
      next_step: input.nextStep,
      follow_up_at: followUpAt,
      dictated: input.dictated || Boolean(prev?.dictated),
      status: input.confirm ? ("confirmed" as const) : ("draft" as const),
      confirmed_by: input.confirm ? actorUserId(actor) : null,
      confirmed_at: input.confirm ? now : null,
      updated_by: actorUserId(actor),
    };
    if (prev) await trx.updateTable("appointment_reports").set(values).where("appointment_id", "=", v.id).execute();
    else await trx.insertInto("appointment_reports").values({ appointment_id: v.id, author_user_id: actorUserId(actor)!, ...values }).execute();
    // Compatibilidad con la Agenda: el resultado de la cita muestra el informe confirmado si estaba vacío.
    if (input.confirm && !v.result) await trx.updateTable("appointments").set({ result: input.body.slice(0, 5000) }).where("id", "=", v.id).execute();
    await audit(trx, actor, {
      action: input.confirm ? "VISIT_REPORT_CONFIRMED" : "VISIT_REPORT_SAVED",
      entityType: "appointment",
      entityId: v.id,
      before: prev ? { status: prev.status, interest: prev.interest } : null,
      after: { status: values.status, interest: input.interest, followUpAt: followUpAt?.toISOString() ?? null, dictated: values.dictated },
    });
    await recordVisitEvent(trx, actor, v.id, input.confirm ? "report_confirmed" : "report_saved", { interest: input.interest });
    // Informe confirmado por una persona → reacción de IA (datos del perfil SUGERIDOS y seguimiento sugerido).
    // Payload sin texto del informe ni datos del cliente: solo ids y marcas.
    if (input.confirm && prev?.status !== "confirmed") {
      await emitEvent(trx, actor, {
        type: "visit.report_confirmed",
        aggregateType: "appointment",
        aggregateId: v.id,
        payload: { assignedUserId: v.assigned_user_id, propertyId: v.property_id, contactId: v.contact_id, interest: input.interest, hasObjections: Boolean(input.objections), hasNextStep: Boolean(input.nextStep), link: `/crm/mis-visitas/${v.id}` },
        dedupeKey: `visit.report_confirmed:${v.id}:${now.toISOString()}`,
      });
    }
    return { status: values.status, followUpAt };
  });
}

// ───────────────────────────── Seguimiento ─────────────────────────────

export const followUpSchema = z.object({
  appointmentId: z.uuid(),
  dueAt: z.string().refine(isLocalDateTime, "Fecha y hora inválidas"),
  title: z.string().trim().min(2, "Mínimo 2 caracteres").max(200).nullish().transform((v) => v || null),
});

/** Crea (solo si una persona lo confirma) la tarea de seguimiento reutilizando `tasks` y la vincula a la visita. */
export async function createVisitFollowUp(db: Database, actor: Actor, raw: SchemaIn<typeof followUpSchema>): Promise<{ taskId: string; replayed: boolean }> {
  const input = followUpSchema.parse(raw);
  requirePermission(actor, "visits.operate");
  requirePermission(actor, "tasks.manage");
  await assertVisitsEnabled(db);
  const v = await loadVisit(db, actor, input.appointmentId);
  assertCanManageVisit(actor, v);
  if (v.follow_up_task_id) return { taskId: v.follow_up_task_id, replayed: true };
  if (v.status !== "completed") throw conflict("El seguimiento se crea con la visita finalizada");
  const report = await db.selectFrom("appointment_reports").select("status").where("appointment_id", "=", v.id).executeTakeFirst();
  if (report?.status !== "confirmed") throw conflict("Confirmá el informe antes de crear el seguimiento");
  const prop = v.property_id ? await db.selectFrom("properties").select("code").where("id", "=", v.property_id).executeTakeFirst() : undefined;
  const contact = v.contact_id ? await db.selectFrom("contacts").select("display_name").where("id", "=", v.contact_id).executeTakeFirst() : undefined;
  const title = input.title ?? ["Seguimiento de visita", prop ? `Prop. ${prop.code}` : null, contact?.display_name].filter(Boolean).join(" · ").slice(0, 200);
  // Clave determinística: reintentos y dobles toques devuelven la misma tarea.
  const task = await createTask(db, actor, {
    title,
    kind: "follow_up",
    priority: "normal",
    dueAt: input.dueAt,
    assignedUserId: v.assigned_user_id,
    entityType: "appointment",
    entityId: v.id,
    description: `Seguimiento de la visita del ${utcToLocalInput(v.starts_at).replace("T", " ")} (/crm/mis-visitas/${v.id}).`,
    idempotencyKey: `visit-followup:${v.id}`,
  });
  return db.transaction().execute(async (trx) => {
    const locked = await loadVisit(trx, actor, v.id, { forUpdate: true });
    if (locked.follow_up_task_id) return { taskId: locked.follow_up_task_id, replayed: true };
    await trx.updateTable("appointments").set({ follow_up_task_id: task.id }).where("id", "=", v.id).execute();
    await audit(trx, actor, { action: "VISIT_FOLLOWUP_CREATED", entityType: "appointment", entityId: v.id, after: { taskId: task.id, dueAt: input.dueAt } });
    await recordVisitEvent(trx, actor, v.id, "followup_created", { taskId: task.id }, `followup_created:${v.id}`);
    await emitEvent(trx, actor, { type: "followup.created", aggregateType: "appointment", aggregateId: v.id, payload: payload(v, { taskId: task.id, dueAt: localToUtc(input.dueAt).toISOString() }), dedupeKey: `followup.created:${v.id}` });
    return { taskId: task.id, replayed: task.replayed };
  });
}

// ───────────────────────────── Agradecimiento ─────────────────────────────

export const thanksSchema = z.object({
  appointmentId: z.uuid(),
  message: z.string().trim().min(10, "Mínimo 10 caracteres").max(1000, "Máximo 1000 caracteres"),
});

export async function saveThanks(db: Database, actor: Actor, raw: SchemaIn<typeof thanksSchema>): Promise<{ changed: boolean }> {
  const input = thanksSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertCanManageVisit(actor, v);
    if (v.status !== "completed") throw conflict("El agradecimiento se prepara con la visita finalizada");
    const prev = await trx.selectFrom("appointment_thanks").select(["message"]).where("appointment_id", "=", v.id).forUpdate().executeTakeFirst();
    if (prev?.message === input.message) return { changed: false };
    await trx
      .insertInto("appointment_thanks")
      .values({ appointment_id: v.id, message: input.message, updated_by: actorUserId(actor)! })
      .onConflict((oc) => oc.column("appointment_id").doUpdateSet({ message: input.message, updated_by: actorUserId(actor)! }))
      .execute();
    await audit(trx, actor, { action: "VISIT_THANKS_SAVED", entityType: "appointment", entityId: v.id, before: prev ? { message: prev.message } : null, after: { message: input.message } });
    await recordVisitEvent(trx, actor, v.id, "thanks_saved", {}, `thanks_saved:${v.id}`);
    return { changed: true };
  });
}

export const thanksSentSchema = z.object({ appointmentId: z.uuid(), channel: z.enum(["whatsapp", "copy", "other"]) });

/** Lo registra la persona que lo envió (la plataforma no envía nada por su cuenta). */
export async function markThanksSent(db: Database, actor: Actor, raw: SchemaIn<typeof thanksSentSchema>): Promise<{ changed: boolean }> {
  const input = thanksSentSchema.parse(raw);
  return withVisit(db, actor, input.appointmentId, async (trx, v) => {
    assertCanManageVisit(actor, v);
    const t = await trx.selectFrom("appointment_thanks").select(["marked_sent_at"]).where("appointment_id", "=", v.id).forUpdate().executeTakeFirst();
    if (!t) throw conflict("Guardá el mensaje de agradecimiento antes de marcarlo como enviado");
    if (t.marked_sent_at) return { changed: false };
    await trx.updateTable("appointment_thanks").set({ marked_sent_at: new Date(), marked_sent_by: actorUserId(actor), sent_channel: input.channel }).where("appointment_id", "=", v.id).execute();
    await audit(trx, actor, { action: "VISIT_THANKS_MARKED_SENT", entityType: "appointment", entityId: v.id, after: { channel: input.channel } });
    await recordVisitEvent(trx, actor, v.id, "thanks_marked_sent", { channel: input.channel }, `thanks_marked_sent:${v.id}`);
    return { changed: true };
  });
}

// ───────────────────────────── Reasignación (centro operativo) ─────────────────────────────

export const reassignSchema = z.object({ appointmentId: z.uuid(), assignedUserId: z.uuid() });

/** Reutiliza la reprogramación de la Agenda (misma franja, otro agente): valida superposición y audita. */
export async function reassignVisit(db: Database, actor: Actor, raw: SchemaIn<typeof reassignSchema>): Promise<{ changed: boolean }> {
  const input = reassignSchema.parse(raw);
  requirePermission(actor, "visits.monitor");
  await assertVisitsEnabled(db);
  const v = await loadVisit(db, actor, input.appointmentId);
  if (v.assigned_user_id === input.assignedUserId) return { changed: false };
  const target = await db.selectFrom("users").select("organization_id").where("id", "=", input.assignedUserId).executeTakeFirst();
  if (!target || target.organization_id !== v.agent_organization_id) throw notFound("Agente");
  const r = await rescheduleAppointment(db, actor, {
    appointmentId: v.id,
    startsAt: utcToLocalInput(v.starts_at),
    durationMinutes: Math.round((v.ends_at.getTime() - v.starts_at.getTime()) / 60_000),
    assignedUserId: input.assignedUserId,
    reason: "Reasignada desde el centro operativo",
  });
  return { changed: Boolean(r?.changed) };
}
