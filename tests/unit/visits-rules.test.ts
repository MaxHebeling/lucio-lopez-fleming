import { describe, expect, it } from "vitest";
import { ACTIVE_STATUSES, APPOINTMENT_STATUSES, canTransition, isTerminal, nextVisitActions, visitPhase } from "@/server/visits/state";
import { evaluateGeofence, formatDistance, haversineMeters, propertyPoint } from "@/server/visits/geofence";
import {
  clientLinkExpiresAt,
  clientPhase,
  evaluateVisitAlerts,
  firstName,
  isClientLinkValid,
  suggestFollowUpAt,
  thankYouTemplate,
  clientLinkShareText,
  type AlertSettings,
  type VisitSnapshot,
} from "@/server/visits/rules";
import { parseVisitSettings } from "@/server/visits/settings";
import { CLIENT_LINK_TOKEN_RE, isLinkPreviewBot, statusEtag } from "@/server/visits/public";
import { hashToken, newToken } from "@/server/auth/tokens";
import { nullVisitAi, structureVisitReport } from "@/server/visits/ai-extension";

describe("máquina de estados de la visita", () => {
  it("camino feliz y ramas válidas", () => {
    expect(canTransition("scheduled", "en_route")).toBe(true);
    expect(canTransition("en_route", "checked_in")).toBe(true);
    expect(canTransition("checked_in", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("scheduled", "checked_in")).toBe(true); // llegó sin marcar "salgo"
    expect(canTransition("en_route", "scheduled")).toBe(true); // reprogramada / reasignada
    expect(canTransition("checked_in", "no_show")).toBe(true);
  });

  it("transiciones inválidas y estados terminales", () => {
    expect(canTransition("scheduled", "in_progress")).toBe(false);
    expect(canTransition("in_progress", "no_show")).toBe(false);
    expect(canTransition("in_progress", "scheduled")).toBe(false);
    expect(canTransition("checked_in", "en_route")).toBe(false);
    for (const t of ["completed", "cancelled", "no_show"]) {
      expect(isTerminal(t)).toBe(true);
      for (const to of APPOINTMENT_STATUSES) expect(canTransition(t, to)).toBe(false);
    }
    expect(canTransition("scheduled", "desconocido")).toBe(false);
    expect(ACTIVE_STATUSES).not.toContain("completed");
  });

  it("acciones y etapas visibles", () => {
    expect(nextVisitActions("confirmed")).toEqual(["en_route", "check_in"]);
    expect(nextVisitActions("en_route")).toEqual(["check_in"]);
    expect(nextVisitActions("checked_in")).toEqual(["start"]);
    expect(nextVisitActions("in_progress")).toEqual(["finish"]);
    expect(nextVisitActions("completed")).toEqual([]);
    expect(visitPhase("confirmed")).toBe("scheduled");
  });
});

describe("geofence", () => {
  const prop = { lat: -24.788967, lng: -65.410478 };
  it("haversine razonable (1° de latitud ≈ 111 km)", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(110_000);
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(112_000);
    expect(haversineMeters(prop, prop)).toBe(0);
  });

  it("dentro, fuera, precisión mala y sin coordenadas", () => {
    const base = { radiusM: 150, maxAccuracyM: 200 };
    expect(evaluateGeofence({ ...base, property: prop, position: { ...prop, accuracy: 10 } })).toEqual({ status: "verified", reason: "within_radius", distanceM: 0 });
    const far = evaluateGeofence({ ...base, property: prop, position: { lat: -24.779, lng: prop.lng, accuracy: 10 } });
    expect(far).toMatchObject({ status: "needs_review", reason: "outside_radius" });
    expect(far.distanceM).toBeGreaterThan(1000);
    // 250 m con precisión 120: dentro de radio + precisión
    expect(evaluateGeofence({ ...base, property: prop, position: { lat: -24.786717, lng: prop.lng, accuracy: 120 } }).status).toBe("verified");
    // 250 m con precisión 50: fuera
    expect(evaluateGeofence({ ...base, property: prop, position: { lat: -24.786717, lng: prop.lng, accuracy: 50 } }).status).toBe("needs_review");
    // precisión peor que el tope, aunque esté encima
    expect(evaluateGeofence({ ...base, property: prop, position: { ...prop, accuracy: 201 } })).toMatchObject({ status: "needs_review", reason: "low_accuracy", distanceM: 0 });
    expect(evaluateGeofence({ ...base, property: null, position: { ...prop, accuracy: 5 } })).toEqual({ status: "needs_review", reason: "property_without_coordinates", distanceM: null });
  });

  it("coordenadas de propiedad: numeric como string, vacías y (0,0) importado", () => {
    expect(propertyPoint("-24.788967", "-65.410478")).toEqual(prop);
    expect(propertyPoint(null, "-65")).toBeNull();
    expect(propertyPoint("0", "0")).toBeNull();
    expect(propertyPoint("95", "0")).toBeNull();
  });

  it("formato de distancia", () => {
    expect(formatDistance(18)).toBe("aprox. 20 m");
    expect(formatDistance(1234)).toBe("aprox. 1,2 km");
    expect(formatDistance(null)).toBeNull();
  });
});

describe("token del link del cliente", () => {
  it("≥ 32 bytes base64url y hash SHA-256 hex", () => {
    const t = newToken(32);
    expect(t).toMatch(CLIENT_LINK_TOKEN_RE);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken(32)).not.toBe(t);
    expect(CLIENT_LINK_TOKEN_RE.test("../../etc/passwd")).toBe(false);
  });

  it("vencimiento: fin (o fin real) + margen, con tope absoluto; revocado = inválido", () => {
    const endsAt = new Date("2026-09-17T15:00:00Z");
    const hard = new Date("2026-10-01T00:00:00Z");
    expect(clientLinkExpiresAt({ endsAt, finishedAt: null, hardExpiresAt: hard, graceHours: 48 }).toISOString()).toBe("2026-09-19T15:00:00.000Z");
    expect(clientLinkExpiresAt({ endsAt, finishedAt: new Date("2026-09-17T16:30:00Z"), hardExpiresAt: hard, graceHours: 48 }).toISOString()).toBe("2026-09-19T16:30:00.000Z");
    expect(clientLinkExpiresAt({ endsAt: new Date("2026-12-01T00:00:00Z"), finishedAt: null, hardExpiresAt: hard, graceHours: 48 })).toEqual(hard);
    const p = { revokedAt: null, endsAt, finishedAt: null, hardExpiresAt: hard, graceHours: 48 };
    expect(isClientLinkValid(p, new Date("2026-09-19T14:59:59Z"))).toBe(true);
    expect(isClientLinkValid(p, new Date("2026-09-19T15:00:00Z"))).toBe(false);
    expect(isClientLinkValid({ ...p, revokedAt: new Date() }, new Date("2026-09-17T12:00:00Z"))).toBe(false);
  });

  it("fase para el cliente: nada en vivo después de cerrar", () => {
    expect(clientPhase("confirmed")).toBe("scheduled");
    expect(clientPhase("in_progress")).toBe("in_progress");
    for (const s of ["completed", "cancelled", "no_show"]) expect(clientPhase(s)).toBe("closed");
  });

  it("previsualizadores no cuentan como apertura; ETag estable por contenido", () => {
    expect(isLinkPreviewBot("WhatsApp/2.23.20 A")).toBe(true);
    expect(isLinkPreviewBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLinkPreviewBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(false);
    expect(statusEtag({ phase: "en_route", checkedInAt: null })).toBe(statusEtag({ phase: "en_route", checkedInAt: null }));
    expect(statusEtag({ phase: "en_route", checkedInAt: null })).not.toBe(statusEtag({ phase: "checked_in", checkedInAt: null }));
  });
});

describe("plantillas y seguimiento", () => {
  it("agradecimiento por plantilla con nombre de pila, agente, propiedad y empresa", () => {
    expect(firstName("Ana María Pérez")).toBe("Ana");
    expect(firstName("  ")).toBeNull();
    const t = thankYouTemplate({ clientFirstName: "Ana", agentName: "Juan López", propertyTitle: "Casa en Tres Cerritos" });
    expect(t).toBe(
      "Hola Ana, muchas gracias por tomarte el tiempo de conocer Casa en Tres Cerritos con nosotros. Quedo a disposición para cualquier consulta o para coordinar una nueva visita. Un saludo, Juan López · Lucio López Fleming.",
    );
    expect(thankYouTemplate({ clientFirstName: null, agentName: "Juan", propertyTitle: null })).toMatch(/^Hola, muchas gracias por tomarte el tiempo de hacer la visita/);
    expect(clientLinkShareText({ clientFirstName: "Ana", url: "https://x/visita/abc" })).toBe("Hola Ana, te comparto el enlace para seguir tu visita con Lucio López Fleming: https://x/visita/abc");
  });

  it("seguimiento: alto 24 h, medio/sin dato 48 h, bajo 7 días, redondeado a 5 min", () => {
    const from = new Date("2026-09-17T15:02:00Z");
    expect(suggestFollowUpAt("high", from).toISOString()).toBe("2026-09-18T15:05:00.000Z");
    expect(suggestFollowUpAt("medium", from).toISOString()).toBe("2026-09-19T15:05:00.000Z");
    expect(suggestFollowUpAt(null, from).toISOString()).toBe("2026-09-19T15:05:00.000Z");
    expect(suggestFollowUpAt("low", from).toISOString()).toBe("2026-09-24T15:05:00.000Z");
  });

  it("extensión de IA: implementación nula, sin propuestas inventadas", async () => {
    expect(await structureVisitReport("Le gustó la casa")).toBeNull();
    expect(await nullVisitAi.buildVisitBrief({ appointmentId: "x" })).toBeNull();
  });
});

describe("alertas deterministas", () => {
  const s: AlertSettings = { upcomingHours: 24, noCheckinMinutes: 15, overrunMinutes: 60, notFinishedMinutes: 120, reportHours: 12 };
  const start = new Date("2026-09-17T13:00:00Z");
  const base: VisitSnapshot = {
    status: "scheduled",
    startsAt: start,
    endsAt: new Date("2026-09-17T14:00:00Z"),
    startedAt: null,
    finishedAt: null,
    agentActive: true,
    lastCheckinStatus: null,
    reportStatus: null,
    hasFollowUp: false,
  };
  const at = (iso: string) => new Date(iso);

  it("sin check-in X minutos después del inicio (y no antes)", () => {
    expect(evaluateVisitAlerts(base, at("2026-09-17T13:14:00Z"), s)).toEqual([]);
    expect(evaluateVisitAlerts(base, at("2026-09-17T13:15:00Z"), s)).toEqual(["no_checkin"]);
    expect(evaluateVisitAlerts({ ...base, status: "en_route" }, at("2026-09-17T13:30:00Z"), s)).toEqual(["no_checkin"]);
  });

  it("agente inactivo con visita próxima", () => {
    expect(evaluateVisitAlerts({ ...base, agentActive: false }, at("2026-09-16T14:00:00Z"), s)).toEqual(["unassigned_upcoming"]);
    expect(evaluateVisitAlerts({ ...base, agentActive: false }, at("2026-09-15T12:00:00Z"), s)).toEqual([]);
  });

  it("check-in para revisar, visita larga y pasada sin finalizar", () => {
    expect(evaluateVisitAlerts({ ...base, status: "checked_in", lastCheckinStatus: "needs_review" }, at("2026-09-17T13:05:00Z"), s)).toEqual(["checkin_needs_review"]);
    expect(evaluateVisitAlerts({ ...base, status: "checked_in", lastCheckinStatus: "verified" }, at("2026-09-17T13:05:00Z"), s)).toEqual([]);
    const running = { ...base, status: "in_progress", startedAt: at("2026-09-17T13:10:00Z"), lastCheckinStatus: "verified" };
    expect(evaluateVisitAlerts(running, at("2026-09-17T15:09:00Z"), s)).toEqual([]);
    expect(evaluateVisitAlerts(running, at("2026-09-17T15:10:00Z"), s)).toEqual(["overrun"]);
    expect(evaluateVisitAlerts({ ...base, status: "checked_in", lastCheckinStatus: "verified" }, at("2026-09-17T16:00:00Z"), s)).toEqual(["not_finished"]);
    expect(evaluateVisitAlerts(base, at("2026-09-17T16:00:00Z"), s)).toEqual(["not_finished"]);
  });

  it("finalizada sin informe y luego sin seguimiento; terminales sin alertas en vivo", () => {
    const done = { ...base, status: "completed", finishedAt: at("2026-09-17T14:00:00Z") };
    expect(evaluateVisitAlerts(done, at("2026-09-18T01:59:00Z"), s)).toEqual([]);
    expect(evaluateVisitAlerts(done, at("2026-09-18T02:00:00Z"), s)).toEqual(["no_report"]);
    expect(evaluateVisitAlerts({ ...done, reportStatus: "draft" }, at("2026-09-18T02:00:00Z"), s)).toEqual(["no_report"]);
    expect(evaluateVisitAlerts({ ...done, reportStatus: "confirmed" }, at("2026-09-18T02:00:00Z"), s)).toEqual(["no_followup"]);
    expect(evaluateVisitAlerts({ ...done, reportStatus: "confirmed", hasFollowUp: true }, at("2026-09-18T02:00:00Z"), s)).toEqual([]);
    expect(evaluateVisitAlerts({ ...base, status: "cancelled" }, at("2026-09-17T16:00:00Z"), s)).toEqual([]);
  });
});

describe("configuración", () => {
  it("valores por defecto y rangos seguros", () => {
    const d = parseVisitSettings(new Map());
    expect(d).toMatchObject({ radiusM: 150, maxAccuracyM: 200, locationRetentionDays: 30, clientLinkGraceHours: 48 });
    const custom = parseVisitSettings(new Map<string, unknown>([["visits.geofence_radius_m", 300], ["visits.geofence_max_accuracy_m", "999999"], ["visits.location_retention_days", "7"]]));
    expect(custom).toMatchObject({ radiusM: 300, maxAccuracyM: 200, locationRetentionDays: 7 });
  });
});
