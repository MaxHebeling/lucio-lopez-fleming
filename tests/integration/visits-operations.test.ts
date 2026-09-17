import { describe, expect, it } from "vitest";
import { sql, type Database } from "@/server/db";
import type { StaffActor } from "@/server/auth/actor";
import { resetFlagCache } from "@/server/flags";
import { createContact } from "@/server/contacts/crud";
import { createOpportunity } from "@/server/opportunities/service";
import { cancelAppointment, completeAppointment, createAppointment } from "@/server/agenda/service";
import { dispatchPendingEvents } from "@/server/automation/engine";
import { runJobs } from "@/server/jobs/runner";
import "@/server/jobs/handlers";
import { utcToLocalInput } from "@/server/crm/time";
import {
  checkIn,
  createClientLink,
  createVisitFollowUp,
  finishVisit,
  markEnRoute,
  markThanksSent,
  reassignVisit,
  reportLocationProblem,
  revokeClientLink,
  rotateClientLink,
  saveThanks,
  saveVisitReport,
  startVisit,
} from "@/server/visits/service";
import { getOpsBoard, getVisitDetail, listMyVisits } from "@/server/visits/queries";
import { getClientVisitStatus, getClientVisitView, CLIENT_LINK_RATE } from "@/server/visits/public";
import { computeVisitAlerts, purgeCheckinLocations, recordExpiredClientLinks } from "@/server/visits/jobs";
import { organizationId } from "@/server/org";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { key, makeProperty, uniquePhone } from "../helpers/crm";

// Plaza 9 de Julio, Salta
const PROP = { lat: -24.788967, lng: -65.410478 };
// ≈ 55 m al noreste
const NEAR = { lat: -24.7886, lng: -65.41012 };
// ≈ 1,1 km
const FAR = { lat: -24.779, lng: -65.410478 };

let ipSeq = 0;
const freshIp = () => `10.20.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

async function setup(db: Database, opts: { coords?: boolean; hideAddress?: boolean; startsInMinutes?: number; duration?: number } = {}) {
  const admin = await createStaff(db, ["administrador"]);
  const agent = await createStaff(db, ["agente"]);
  const prop = await makeProperty(db, admin, "Casa en Tres Cerritos con jardín");
  await db
    .updateTable("properties")
    .set({
      address_street: "Los Ceibos",
      address_number: "1234",
      hide_exact_address: opts.hideAddress ?? true,
      latitude: opts.coords === false ? null : String(PROP.lat),
      longitude: opts.coords === false ? null : String(PROP.lng),
    })
    .where("id", "=", prop.id)
    .execute();
  const contact = await createContact(db, admin, { firstName: "Mariana", lastName: "Gómez", phones: [{ phone: uniquePhone(), isWhatsapp: true }], idempotencyKey: key() });
  const startsAt = utcToLocalInput(new Date(Date.now() + (opts.startsInMinutes ?? 10) * 60_000));
  const visit = await createAppointment(db, admin, { kind: "visit", startsAt, durationMinutes: opts.duration ?? 60, propertyId: prop.id, contactId: contact.id, assignedUserId: agent.userId, idempotencyKey: key() });
  return { admin, agent, prop, contact, visitId: visit.id };
}

async function toInProgress(db: Database, agent: StaffActor, visitId: string) {
  await markEnRoute(db, agent, { appointmentId: visitId });
  await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 15 });
  await startVisit(db, agent, { appointmentId: visitId });
}

describe("visitas: flujo completo del agente", () => {
  it("en camino → check-in verificado → en curso → finalizada → informe → seguimiento → agradecimiento", async () => {
    const db = testDb();
    const { agent, contact, prop, visitId, admin } = await setup(db);
    const opp = await createOpportunity(db, admin, { contactId: contact.id, pipelineKey: "ventas", propertyId: prop.id, assignedUserId: agent.userId, idempotencyKey: key() });
    await db.updateTable("appointments").set({ opportunity_id: opp.id }).where("id", "=", visitId).execute();

    expect((await listMyVisits(db, agent, { view: "hoy" })).rows.map((r) => r.id)).toContain(visitId);
    expect(await markEnRoute(db, agent, { appointmentId: visitId })).toEqual({ changed: true });
    expect(await markEnRoute(db, agent, { appointmentId: visitId })).toEqual({ changed: false });

    const k = key();
    const ci = await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: k, latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 12, deviceTimestamp: Date.now() });
    expect(ci.changed).toBe(true);
    expect(ci.checkin).toMatchObject({ status: "verified", reason: "within_radius", attempt: 1 });
    expect(ci.checkin.distanceM).toBeGreaterThan(45);
    expect(ci.checkin.distanceM).toBeLessThan(65);
    // Doble toque (misma clave) y segundo check-in con otra clave: no duplican
    expect((await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: k, latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 12 })).changed).toBe(false);
    expect((await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: FAR.lat, longitude: FAR.lng, accuracy: 12 })).changed).toBe(false);
    expect(await db.selectFrom("appointment_checkins").select("id").where("appointment_id", "=", visitId).execute()).toHaveLength(1);

    expect(await startVisit(db, agent, { appointmentId: visitId })).toEqual({ changed: true });
    expect(await startVisit(db, agent, { appointmentId: visitId })).toEqual({ changed: false });
    await expect(saveVisitReport(db, agent, { appointmentId: visitId, body: "Todavía en curso" })).rejects.toThrow(/finalizada/);
    expect(await finishVisit(db, agent, { appointmentId: visitId })).toMatchObject({ changed: true, opportunityAdvanced: true });
    expect(await finishVisit(db, agent, { appointmentId: visitId })).toMatchObject({ changed: false });

    // La automatización visit_followup NO crea la tarea: la confirma una persona
    await dispatchPendingEvents(db);
    await runJobs(db, { budgetMs: 60_000 });
    expect(await db.selectFrom("tasks").select("id").where("entity_id", "=", visitId).execute()).toHaveLength(0);

    await expect(createVisitFollowUp(db, agent, { appointmentId: visitId, dueAt: "2030-01-01T10:00" })).rejects.toThrow(/Confirmá el informe/);
    const draft = await saveVisitReport(db, agent, { appointmentId: visitId, body: "Le gustó la luz del living; duda por el precio.", interest: "high", positives: "Luz, jardín", objections: "Precio", nextStep: "Enviar comparables", dictated: true });
    expect(draft.status).toBe("draft");
    const confirmed = await saveVisitReport(db, agent, { appointmentId: visitId, body: "Le gustó la luz del living; duda por el precio.", interest: "high", positives: "Luz, jardín", objections: "Precio", nextStep: "Enviar comparables", confirm: true });
    expect(confirmed.status).toBe("confirmed");
    const detail = await getVisitDetail(db, agent, visitId);
    expect(detail.report).toMatchObject({ status: "confirmed", interest: "high", dictated: true });
    // Sugerencia determinista: alto → 24 h después de finalizar
    const finishedAt = detail.visit.finished_at!;
    expect(Math.abs(confirmed.followUpAt!.getTime() - (finishedAt.getTime() + 24 * 3_600_000))).toBeLessThan(5 * 60_000);
    expect(detail.visit.result).toBe("Le gustó la luz del living; duda por el precio.");

    const due = utcToLocalInput(confirmed.followUpAt!);
    const fu = await createVisitFollowUp(db, agent, { appointmentId: visitId, dueAt: due });
    expect(await createVisitFollowUp(db, agent, { appointmentId: visitId, dueAt: due })).toEqual({ taskId: fu.taskId, replayed: true });
    const task = await db.selectFrom("tasks").select(["kind", "assigned_user_id", "entity_type", "entity_id", "status"]).where("id", "=", fu.taskId).executeTakeFirstOrThrow();
    expect(task).toEqual({ kind: "follow_up", assigned_user_id: agent.userId, entity_type: "appointment", entity_id: visitId, status: "open" });

    expect(detail.thanksTemplate).toMatch(/^Hola Mariana, muchas gracias/);
    await expect(markThanksSent(db, agent, { appointmentId: visitId, channel: "whatsapp" })).rejects.toThrow(/Guardá el mensaje/);
    expect(await saveThanks(db, agent, { appointmentId: visitId, message: detail.thanksTemplate })).toEqual({ changed: true });
    expect(await markThanksSent(db, agent, { appointmentId: visitId, channel: "whatsapp" })).toEqual({ changed: true });
    expect(await markThanksSent(db, agent, { appointmentId: visitId, channel: "whatsapp" })).toEqual({ changed: false });

    const timeline = (await db.selectFrom("appointment_events").select("kind").where("appointment_id", "=", visitId).orderBy("id").execute()).map((e) => e.kind);
    expect(timeline).toEqual(["scheduled", "assigned", "en_route", "checked_in", "started", "finished", "report_saved", "report_confirmed", "followup_created", "thanks_saved", "thanks_marked_sent"]);
    const events = (await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", visitId).orderBy("id").execute()).map((e) => e.event_type);
    expect(events).toEqual(["visit.scheduled", "appointment.created", "appointment.assigned", "appointment.en_route", "agent.checked_in", "appointment.started", "appointment.finished", "visit.completed", "followup.created"]);
    const audits = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", visitId).orderBy("id").execute()).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(["VISIT_EN_ROUTE", "VISIT_CHECKED_IN", "VISIT_STARTED", "VISIT_FINISHED", "VISIT_REPORT_CONFIRMED", "VISIT_FOLLOWUP_CREATED", "VISIT_THANKS_MARKED_SENT"]));

    // Las coordenadas crudas solo viven en appointment_checkins: ni timeline, ni auditoría, ni eventos, ni el detalle.
    const blob = JSON.stringify([
      await db.selectFrom("appointment_events").select("data").where("appointment_id", "=", visitId).execute(),
      await db.selectFrom("audit_logs").select(["before", "after", "metadata"]).where("entity_id", "=", visitId).execute(),
      await db.selectFrom("domain_events").select("payload").where("aggregate_id", "=", visitId).execute(),
      detail,
    ]);
    expect(blob).not.toContain("-24.7886");
    expect(blob).not.toContain("-65.41012");
  });

  it("transiciones inválidas: rechazadas por el servicio y por la base", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db);
    await expect(startVisit(db, agent, { appointmentId: visitId })).rejects.toThrow(/Programada/);
    await expect(finishVisit(db, agent, { appointmentId: visitId })).rejects.toThrow(/Programada/);
    await expect(sql`update appointments set status = 'in_progress' where id = ${visitId}`.execute(db)).rejects.toThrow(/Transición de estado inválida/);
    await toInProgress(db, agent, visitId);
    await expect(markEnRoute(db, agent, { appointmentId: visitId })).rejects.toThrow(/En curso/);
    await finishVisit(db, agent, { appointmentId: visitId });
    await expect(sql`update appointments set status = 'scheduled' where id = ${visitId}`.execute(db)).rejects.toThrow(/completed → scheduled/);
    await expect(sql`update appointment_events set kind = 'started' where appointment_id = ${visitId}`.execute(db)).rejects.toThrow(/solo inserción/);
  });

  it("presencia solo en la franja de la visita", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db, { startsInMinutes: 6 * 60 });
    await expect(markEnRoute(db, agent, { appointmentId: visitId })).rejects.toThrow(/Todavía es temprano/);
    await expect(checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 10 })).rejects.toThrow(/Todavía es temprano/);
    expect(await db.selectFrom("appointment_checkins").select("id").where("appointment_id", "=", visitId).execute()).toHaveLength(0);
  });
});

describe("visitas: geofence y fallback", () => {
  it("fuera de radio y precisión mala quedan para revisión; hasta 3 intentos; no bloquean la visita", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db);
    const far = await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: FAR.lat, longitude: FAR.lng, accuracy: 20 });
    expect(far.checkin).toMatchObject({ status: "needs_review", reason: "outside_radius" });
    const vague = await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 900 });
    expect(vague.checkin).toMatchObject({ status: "needs_review", reason: "low_accuracy", attempt: 2 });
    const ok = await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 10 });
    expect(ok.checkin).toMatchObject({ status: "verified", attempt: 3 });
    const row = await db.selectFrom("appointments").select(["status", "checked_in_at"]).where("id", "=", visitId).executeTakeFirstOrThrow();
    expect(row.status).toBe("checked_in");
    const timeline = (await db.selectFrom("appointment_events").select("kind").where("appointment_id", "=", visitId).orderBy("id").execute()).map((e) => e.kind);
    expect(timeline.filter((k) => k === "checkin_retry")).toHaveLength(2);
  });

  it("precisión dentro del tope: verificado si distancia ≤ radio + precisión", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db);
    // ≈ 250 m: fuera de 150 m, pero dentro de 150 + 120 de precisión
    const r = await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: -24.786717, longitude: PROP.lng, accuracy: 120 });
    expect(r.checkin.status).toBe("verified");
  });

  it("propiedad sin coordenadas → requiere revisión con motivo explícito", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db, { coords: false });
    const r = await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 10 });
    expect(r.checkin).toMatchObject({ status: "needs_review", reason: "property_without_coordinates", distanceM: null });
  });

  it("GPS denegado → no_location sin coordenadas, la visita sigue; «otro» exige detalle; 4º intento rechazado", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db);
    await expect(reportLocationProblem(db, agent, { appointmentId: visitId, idempotencyKey: key(), reason: "other" })).rejects.toThrow();
    const r = await reportLocationProblem(db, agent, { appointmentId: visitId, idempotencyKey: key(), reason: "permission_denied" });
    expect(r.checkin).toMatchObject({ status: "no_location", reason: "permission_denied", distanceM: null });
    const row = await db.selectFrom("appointment_checkins").select(["latitude", "longitude", "accuracy_m"]).where("appointment_id", "=", visitId).executeTakeFirstOrThrow();
    expect(row).toEqual({ latitude: null, longitude: null, accuracy_m: null });
    await reportLocationProblem(db, agent, { appointmentId: visitId, idempotencyKey: key(), reason: "timeout" });
    await reportLocationProblem(db, agent, { appointmentId: visitId, idempotencyKey: key(), reason: "other", detail: "Sin señal en el barrio" });
    await expect(reportLocationProblem(db, agent, { appointmentId: visitId, idempotencyKey: key(), reason: "timeout" })).rejects.toThrow(/3 intentos/);
    expect(await startVisit(db, agent, { appointmentId: visitId })).toEqual({ changed: true });
    // Ya en curso: otro intento devuelve el último sin registrar nada
    expect((await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 5 })).changed).toBe(false);
  });
});

describe("visitas: permisos (IDOR, organización, presencia)", () => {
  it("un agente no ve ni opera visitas de otro; admin ve todas pero no registra presencia ajena; otra organización = 404", async () => {
    const db = testDb();
    const { agent, visitId, admin } = await setup(db);
    const other = await createStaff(db, ["agente"]);
    const idem = { appointmentId: visitId };
    const notFound = { code: "not_found" };
    await expect(getVisitDetail(db, other, visitId)).rejects.toMatchObject(notFound);
    await expect(markEnRoute(db, other, idem)).rejects.toMatchObject(notFound);
    await expect(checkIn(db, other, { ...idem, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 5 })).rejects.toMatchObject(notFound);
    await expect(reportLocationProblem(db, other, { ...idem, idempotencyKey: key(), reason: "timeout" })).rejects.toMatchObject(notFound);
    await expect(startVisit(db, other, idem)).rejects.toMatchObject(notFound);
    await expect(finishVisit(db, other, idem)).rejects.toMatchObject(notFound);
    await expect(createClientLink(db, other, idem)).rejects.toMatchObject(notFound);
    await expect(rotateClientLink(db, other, idem)).rejects.toMatchObject(notFound);
    await expect(revokeClientLink(db, other, idem)).rejects.toMatchObject(notFound);
    await expect(saveVisitReport(db, other, { ...idem, body: "intento" })).rejects.toMatchObject(notFound);
    await expect(saveThanks(db, other, { ...idem, message: "Gracias por venir a la visita" })).rejects.toMatchObject(notFound);
    await expect(markThanksSent(db, other, { ...idem, channel: "copy" })).rejects.toMatchObject(notFound);
    await expect(createVisitFollowUp(db, other, { ...idem, dueAt: "2030-01-01T10:00" })).rejects.toMatchObject(notFound);
    await expect(reassignVisit(db, other, { ...idem, assignedUserId: other.userId })).rejects.toMatchObject({ code: "forbidden" });
    expect((await listMyVisits(db, other, { view: "hoy", team: true })).rows.map((r) => r.id)).not.toContain(visitId);
    // Crearla no alcanza: el admin que la agendó para el agente la ve por alcance total, pero la presencia es del agente
    expect((await getVisitDetail(db, admin, visitId)).visit.id).toBe(visitId);
    await expect(markEnRoute(db, admin, idem)).rejects.toMatchObject({ code: "forbidden" });
    await expect(checkIn(db, admin, { ...idem, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 5 })).rejects.toMatchObject({ code: "forbidden" });
    // Roles sin visits.operate/monitor
    const marketing = await createStaff(db, ["marketing"]);
    await expect(getVisitDetail(db, marketing, visitId)).rejects.toMatchObject({ code: "forbidden" });
    const readonly = await createStaff(db, ["solo_lectura"]);
    await expect(listMyVisits(db, readonly, { view: "hoy" })).rejects.toMatchObject({ code: "forbidden" });

    // Otra organización: un administrador de otra org no la encuentra
    const org2 = await db.insertInto("organizations").values({ name: "Otra inmobiliaria", slug: `otra-${Date.now()}` }).returning("id").executeTakeFirstOrThrow();
    const foreign: StaffActor = { ...admin, organizationId: org2.id, userId: admin.userId };
    await expect(getVisitDetail(db, foreign, visitId)).rejects.toMatchObject(notFound);
    expect((await getOpsBoard(db, foreign, { date: utcToLocalInput(new Date()).slice(0, 10) })).rows.map((r) => r.id)).not.toContain(visitId);
    expect(agent.organizationId).toBe(await organizationId(db));
  });

  it("reasignación desde el centro operativo: valida superposición, deja timeline y cambia quién la ve", async () => {
    const db = testDb();
    const { agent, visitId, admin, prop } = await setup(db, { startsInMinutes: 60 });
    const b = await createStaff(db, ["agente"]);
    // B ya tiene una cita en esa franja
    const busy = await createAppointment(db, admin, { kind: "call", startsAt: utcToLocalInput(new Date(Date.now() + 70 * 60_000)), durationMinutes: 30, assignedUserId: b.userId, idempotencyKey: key() });
    await expect(reassignVisit(db, admin, { appointmentId: visitId, assignedUserId: b.userId })).rejects.toThrow(/ya tiene una cita/);
    await cancelAppointment(db, admin, { appointmentId: busy.id, reason: "Liberar agenda" });
    await markEnRoute(db, agent, { appointmentId: visitId });
    expect(await reassignVisit(db, admin, { appointmentId: visitId, assignedUserId: b.userId })).toEqual({ changed: true });
    await expect(getVisitDetail(db, agent, visitId)).rejects.toMatchObject({ code: "not_found" });
    expect((await getVisitDetail(db, b, visitId)).visit).toMatchObject({ assigned_user_id: b.userId, status: "scheduled" });
    const kinds = (await db.selectFrom("appointment_events").select("kind").where("appointment_id", "=", visitId).execute()).map((e) => e.kind);
    expect(kinds).toContain("reassigned");
    expect(prop.id).toBeTruthy();
  });
});

describe("visitas: link temporal del cliente", () => {
  it("token solo como hash; vista live sin dirección oculta; rotar/revocar; adivinado; tras finalizar solo cierre", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db, { hideAddress: true });
    const link = await createClientLink(db, agent, { appointmentId: visitId });
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(createClientLink(db, agent, { appointmentId: visitId })).rejects.toThrow(/rotalo/);
    // El token en claro no está en ninguna tabla
    const dump = JSON.stringify([
      await db.selectFrom("appointment_public_links").selectAll().execute(),
      await db.selectFrom("audit_logs").select(["before", "after", "metadata"]).where("entity_id", "=", visitId).execute(),
      await db.selectFrom("domain_events").select("payload").where("aggregate_id", "=", visitId).execute(),
      await db.selectFrom("appointment_events").select("data").where("appointment_id", "=", visitId).execute(),
    ]);
    expect(dump).not.toContain(link.token);

    const ip = freshIp();
    const view = await getClientVisitView(db, link.token, { ip, userAgent: "Mozilla/5.0 (iPhone)", countOpen: true });
    expect(view).toMatchObject({ kind: "live", phase: "scheduled", clientFirstName: "Mariana", agent: { fullName: agent.fullName } });
    if (view?.kind !== "live") throw new Error("esperaba live");
    expect(view.property.street).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/1234|Los Ceibos|latitude|-24\.78/);
    expect(view.checkedInAt).toBeNull();
    // Previsualizador de WhatsApp no cuenta; el cliente sí, una vez por minuto
    await getClientVisitView(db, link.token, { ip, userAgent: "WhatsApp/2.23", countOpen: true });
    await getClientVisitView(db, link.token, { ip, userAgent: "Mozilla/5.0 (iPhone)", countOpen: true });
    expect((await db.selectFrom("appointment_public_links").select("open_count").where("id", "=", link.linkId).executeTakeFirstOrThrow()).open_count).toBe(1);

    await markEnRoute(db, agent, { appointmentId: visitId });
    expect(await getClientVisitStatus(db, link.token, { ip })).toEqual({ phase: "en_route", checkedInAt: null });
    await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 10 });
    const st = await getClientVisitStatus(db, link.token, { ip });
    expect(st?.phase).toBe("checked_in");
    expect(st?.checkedInAt).toMatch(/^\d{4}-/);

    // Adivinado / formato inválido → misma respuesta (null)
    expect(await getClientVisitView(db, "A".repeat(43), { ip })).toBeNull();
    expect(await getClientVisitView(db, "../../etc", { ip })).toBeNull();

    // Rotar: el anterior deja de funcionar
    const rotated = await rotateClientLink(db, agent, { appointmentId: visitId });
    expect(await getClientVisitView(db, link.token, { ip })).toBeNull();
    expect(await getClientVisitStatus(db, rotated.token, { ip })).toMatchObject({ phase: "checked_in" });

    await startVisit(db, agent, { appointmentId: visitId });
    await finishVisit(db, agent, { appointmentId: visitId });
    const closed = await getClientVisitView(db, rotated.token, { ip });
    expect(closed).toEqual({ kind: "closed", clientFirstName: "Mariana", propertyTitle: expect.any(String), agent: { fullName: agent.fullName }, message: null, contact: expect.any(Object) });
    expect(await getClientVisitStatus(db, rotated.token, { ip })).toEqual({ phase: "closed", checkedInAt: null });
    await saveThanks(db, agent, { appointmentId: visitId, message: "Hola Mariana, gracias por venir a conocer la casa." });
    expect(await getClientVisitView(db, rotated.token, { ip })).toMatchObject({ kind: "closed", message: "Hola Mariana, gracias por venir a conocer la casa." });

    // Revocar
    await revokeClientLink(db, agent, { appointmentId: visitId });
    expect(await getClientVisitView(db, rotated.token, { ip })).toBeNull();
    await expect(createClientLink(db, agent, { appointmentId: visitId })).rejects.toThrow(/terminó/);
  });

  it("dirección visible cuando no está oculta; contacto autorizado según perfil público", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db, { hideAddress: false });
    const link = await createClientLink(db, agent, { appointmentId: visitId });
    const ip = freshIp();
    let view = await getClientVisitView(db, link.token, { ip });
    if (view?.kind !== "live") throw new Error("esperaba live");
    expect(view.property.street).toBe("Los Ceibos 1234");
    // Perfil no público: nunca el teléfono del agente
    await db.updateTable("users").set({ phone: "+54 387 555-0000", whatsapp_e164: "+5493875550000", public_profile: false }).where("id", "=", agent.userId).execute();
    view = await getClientVisitView(db, link.token, { ip });
    expect(JSON.stringify(view)).not.toContain("5550000");
    await db.updateTable("users").set({ public_profile: true }).where("id", "=", agent.userId).execute();
    view = await getClientVisitView(db, link.token, { ip });
    expect(view?.contact).toMatchObject({ source: "agent", whatsappUrl: expect.stringContaining("wa.me/5493875550000") });
  });

  it("expira por tiempo, cancelada muestra cierre, flag apagado = null, rate limit de fallos bloquea también válidos", async () => {
    const db = testDb();
    const { agent, visitId, admin } = await setup(db);
    const link = await createClientLink(db, agent, { appointmentId: visitId });
    const ip = freshIp();
    await cancelAppointment(db, admin, { appointmentId: visitId, reason: "El cliente no puede" });
    expect(await getClientVisitView(db, link.token, { ip })).toMatchObject({ kind: "closed", message: null });
    // Fin + margen (48 h) ya pasado
    expect(await getClientVisitView(db, link.token, { ip, now: new Date(Date.now() + 60 * 3_600_000) })).toBeNull();

    await db.updateTable("feature_flags").set({ enabled: false }).where("key", "=", "client_visit_link").execute();
    resetFlagCache();
    expect(await getClientVisitView(db, link.token, { ip })).toBeNull();
    await db.updateTable("feature_flags").set({ enabled: true }).where("key", "=", "client_visit_link").execute();
    resetFlagCache();

    const attacker = freshIp();
    for (let i = 0; i < CLIENT_LINK_RATE.failuresPerIp; i++) expect(await getClientVisitView(db, `${"x".repeat(40)}${String(i).padStart(3, "0")}`, { ip: attacker })).toBeNull();
    expect(await getClientVisitView(db, link.token, { ip: attacker })).toBeNull();
    expect(await getClientVisitView(db, link.token, { ip: freshIp() })).not.toBeNull();
  });
});

describe("visitas: jobs (alertas, vencimiento de links, retención de ubicación)", () => {
  it("alertas deterministas, deduplicadas, resueltas solas y notificadas una sola vez", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    const { agent, visitId } = await setup(db, { startsInMinutes: -20, duration: 60 });
    const r1 = await computeVisitAlerts(db, system);
    expect(r1.opened).toBeGreaterThanOrEqual(1);
    const open = async () => (await db.selectFrom("visit_alerts").select(["kind", "resolved_at", "notified_at"]).where("appointment_id", "=", visitId).execute()).filter((a) => !a.resolved_at).map((a) => a.kind);
    expect(await open()).toEqual(["no_checkin"]);
    const notifs = async () => (await db.selectFrom("notifications").select("user_id").where("entity_id", "=", visitId).where("kind", "=", "visit.alert.no_checkin").execute()).length;
    const n1 = await notifs();
    expect(n1).toBeGreaterThanOrEqual(2); // agente + administración
    await computeVisitAlerts(db, system);
    expect(await notifs()).toBe(n1);
    expect(await db.selectFrom("visit_alerts").select("id").where("appointment_id", "=", visitId).execute()).toHaveLength(1);

    // Llega con GPS denegado: se resuelve "sin check-in" y aparece "check-in para revisar"
    await reportLocationProblem(db, agent, { appointmentId: visitId, idempotencyKey: key(), reason: "permission_denied" });
    await computeVisitAlerts(db, system);
    expect(await open()).toEqual(["checkin_needs_review"]);
    await startVisit(db, agent, { appointmentId: visitId });
    await finishVisit(db, agent, { appointmentId: visitId });
    // 13 h después: finalizada sin informe
    await computeVisitAlerts(db, system, new Date(Date.now() + 13 * 3_600_000));
    expect(await open()).toEqual(["no_report"]);
    await saveVisitReport(db, agent, { appointmentId: visitId, body: "Interés bajo", interest: "low", confirm: true });
    await computeVisitAlerts(db, system, new Date(Date.now() + 13 * 3_600_000));
    expect(await open()).toEqual(["no_followup"]);
    // Resuelta y reaparecida no vuelve a notificar
    const noCheckinNotified = await db.selectFrom("visit_alerts").select("notified_at").where("appointment_id", "=", visitId).where("kind", "=", "no_checkin").executeTakeFirstOrThrow();
    expect(noCheckinNotified.notified_at).not.toBeNull();

    // Agente desactivado con visita próxima
    const { visitId: v2, agent: a2 } = await setup(db, { startsInMinutes: 180 });
    await db.updateTable("users").set({ is_active: false }).where("id", "=", a2.userId).execute();
    await computeVisitAlerts(db, system);
    expect((await db.selectFrom("visit_alerts").select("kind").where("appointment_id", "=", v2).execute()).map((a) => a.kind)).toEqual(["unassigned_upcoming"]);
    const board = await getOpsBoard(db, (await setup(db)).admin, { date: utcToLocalInput(new Date(Date.now() + 180 * 60_000)).slice(0, 10) });
    expect(board.openAlerts.some((a) => a.appointment_id === v2 && a.kind === "unassigned_upcoming")).toBe(true);
  });

  it("vencimiento de links: evento una sola vez; retención anonimiza coordenadas y conserva estado y distancia", async () => {
    const db = testDb();
    const system = await testSystemActor(db);
    const { agent, visitId } = await setup(db);
    const link = await createClientLink(db, agent, { appointmentId: visitId });
    await checkIn(db, agent, { appointmentId: visitId, idempotencyKey: key(), latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 10 });
    const later = new Date(Date.now() + 72 * 3_600_000);
    expect(await recordExpiredClientLinks(db, system, later)).toBeGreaterThanOrEqual(1);
    expect(await recordExpiredClientLinks(db, system, later)).toBe(0);
    expect((await db.selectFrom("appointment_public_links").select("expired_recorded_at").where("id", "=", link.linkId).executeTakeFirstOrThrow()).expired_recorded_at).not.toBeNull();
    expect((await db.selectFrom("domain_events").select("id").where("event_type", "=", "client_link.expired").where("aggregate_id", "=", visitId).execute()).length).toBe(1);
    expect(link.linkId).toBeTruthy();

    expect(await purgeCheckinLocations(db, new Date())).toBe(0);
    const purged = await purgeCheckinLocations(db, new Date(Date.now() + 31 * 86_400_000));
    expect(purged).toBeGreaterThanOrEqual(1);
    const ck = await db.selectFrom("appointment_checkins").select(["latitude", "longitude", "accuracy_m", "distance_m", "verification_status", "coords_purged_at"]).where("appointment_id", "=", visitId).executeTakeFirstOrThrow();
    expect(ck).toMatchObject({ latitude: null, longitude: null, accuracy_m: null, verification_status: "verified" });
    expect(ck.distance_m).toBeGreaterThan(0);
    expect(ck.coords_purged_at).not.toBeNull();
  });
});

describe("visitas: compatibilidad con la Agenda", () => {
  it("con el flag apagado la Agenda se comporta como antes (sin timeline ni eventos nuevos)", async () => {
    const db = testDb();
    await db.updateTable("feature_flags").set({ enabled: false }).where("key", "=", "visits_operations").execute();
    resetFlagCache();
    try {
      const { visitId, agent } = await setup(db);
      expect((await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", visitId).execute()).map((e) => e.event_type)).toEqual(["visit.scheduled"]);
      expect(await db.selectFrom("appointment_events").select("id").where("appointment_id", "=", visitId).execute()).toHaveLength(0);
      await expect(markEnRoute(db, agent, { appointmentId: visitId })).rejects.toMatchObject({ code: "unavailable" });
      const system = await testSystemActor(db);
      expect(await computeVisitAlerts(db, system)).toEqual({ open: 0, opened: 0, resolved: 0, notified: 0 });
    } finally {
      await db.updateTable("feature_flags").set({ enabled: true }).where("key", "=", "visits_operations").execute();
      resetFlagCache();
    }
  });

  it("una visita en curso se puede cerrar desde la Agenda y aparece como finalizada", async () => {
    const db = testDb();
    const { agent, visitId } = await setup(db, { startsInMinutes: -5 });
    await toInProgress(db, agent, visitId);
    await completeAppointment(db, agent, { appointmentId: visitId, result: "Cerrada desde la agenda" });
    const v = await db.selectFrom("appointments").select(["status", "finished_at"]).where("id", "=", visitId).executeTakeFirstOrThrow();
    expect(v.status).toBe("completed");
    expect(v.finished_at).not.toBeNull();
  });
});
