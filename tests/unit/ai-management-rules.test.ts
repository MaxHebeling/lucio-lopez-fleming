/**
 * IA Fases 5 y 6 — reglas puras: anomalías con n chico, prioridades y dedupe de Tareas sugeridas, protección contra
 * loops, métricas ejecutivas con definiciones, «Resumen de hoy» y activación de reacciones. Más un control estático:
 * el código de gestión nunca lee datos de ubicación de agentes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANOMALY_SETTINGS as S,
  evaluateAiFailureSpike,
  evaluateContradictions,
  evaluateInquiryDrop,
  evaluateJobFailureSpike,
  evaluateLeadUncontacted,
  evaluateVisitWithoutFollowUp,
  notificationsAllowed,
  poissonCdf,
} from "@/server/ai/anomalies/rules";
import { dedupeCandidates, rankSuggestions, snoozeUntil, suggestionScore, type SuggestionCandidate } from "@/server/ai/task-center/rules";
import { dispatchAllowed, loopGuard, normalizeMaxDepth } from "@/server/automation/loop-guard";
import { compareCounts, formatComparison, formatHours, formatRate, median, periodRange, rate, robustMedian } from "@/server/ai/executive/metrics";
import { buildBriefItems, factsHash, firstName, greeting, narrativeViolations, saltaHour } from "@/server/ai/brief/rules";
import { parseManagementSettings } from "@/server/ai/management-settings";

const NOW = new Date("2026-09-17T15:00:00Z"); // jueves 12:00 en Salta

describe("anomalías: prudencia con muestras chicas", () => {
  it("Poisson: P(X ≤ k)", () => {
    expect(poissonCdf(0, 6)).toBeCloseTo(Math.exp(-6), 6);
    expect(poissonCdf(2, 1)).toBeCloseTo(Math.exp(-1) * (1 + 1 + 0.5), 6);
    expect(poissonCdf(-1, 3)).toBe(0);
    expect(poissonCdf(3, 0)).toBe(1);
  });

  it("caída de consultas: sin ventana, sin muestra o con esperado bajo NO afirma nada", () => {
    const base = { propertyCode: 101, recentCount: 0 };
    // Publicada hace poco: la ventana (8 semanas + 14 días) no entra.
    expect(evaluateInquiryDrop({ ...base, publishedDays: 60, baselineCount: 40 }, S)).toEqual({ status: "insufficient", reason: "window" });
    // Base chica (7 < 8): aunque ahora tenga 0, no se dice nada.
    expect(evaluateInquiryDrop({ ...base, publishedDays: 200, baselineCount: 7 }, S)).toEqual({ status: "insufficient", reason: "sample" });
    // 8 consultas en 8 semanas → esperables 2 en 14 días (< 4): tampoco.
    expect(evaluateInquiryDrop({ ...base, publishedDays: 200, baselineCount: 8 }, S)).toEqual({ status: "insufficient", reason: "expected" });
  });

  it("caída de consultas: fuerte y poco probable por azar → anomalía con evidencia; leve → normal", () => {
    // 24 en 8 semanas = 3/semana → ≈ 6 esperables en 14 días.
    const drop = evaluateInquiryDrop({ propertyCode: 101, publishedDays: 200, baselineCount: 24, recentCount: 0 }, S);
    expect(drop.status).toBe("drop");
    if (drop.status !== "drop") throw new Error("esperaba drop");
    expect(drop.expected).toBeCloseTo(6, 5);
    expect(drop.pValue).toBeLessThan(0.05);
    expect(drop.verdict.severity).toBe("warning");
    expect(drop.verdict.evidence.map((e) => e.label)).toEqual(expect.arrayContaining(["Consultas en los últimos 14 días", "Aclaración"]));
    expect(JSON.stringify(drop.verdict)).toContain("no indica la causa");
    // 2 de 6 esperables: ratio 0,33 > 0,25 → no es anomalía.
    expect(evaluateInquiryDrop({ propertyCode: 101, publishedDays: 200, baselineCount: 24, recentCount: 2 }, S).status).toBe("normal");
    // 1 de 6: ratio 0,17 pero P(X≤1) = 1,7 % → anomalía.
    expect(evaluateInquiryDrop({ propertyCode: 101, publishedDays: 200, baselineCount: 24, recentCount: 1 }, S).status).toBe("drop");
  });

  it("lead sin contacto: umbral de aviso y crítico; visita sin seguimiento; picos", () => {
    expect(evaluateLeadUncontacted({ hoursWithoutContact: 23, sourceName: null, propertyCode: null }, S)).toBeNull();
    expect(evaluateLeadUncontacted({ hoursWithoutContact: 30, sourceName: "Sitio web", propertyCode: 12 }, S)!.severity).toBe("warning");
    expect(evaluateLeadUncontacted({ hoursWithoutContact: 72, sourceName: null, propertyCode: null }, S)!.severity).toBe("critical");
    expect(evaluateVisitWithoutFollowUp({ hoursSinceFinished: 47, reportConfirmed: true, propertyCode: 1 }, S)).toBeNull();
    expect(evaluateVisitWithoutFollowUp({ hoursSinceFinished: 50, reportConfirmed: false, propertyCode: 1 }, S)!.evidence).toContainEqual({ label: "Informe", value: "sin confirmar" });
    // Jobs: mínimo absoluto y triple del promedio.
    expect(evaluateJobFailureSpike({ dead24h: 4, deadPrevious7d: 0 }, S)).toBeNull();
    expect(evaluateJobFailureSpike({ dead24h: 6, deadPrevious7d: 21 }, S)).toBeNull(); // promedio 3 → 6 < 9
    expect(evaluateJobFailureSpike({ dead24h: 10, deadPrevious7d: 7 }, S)!.severity).toBe("warning");
    expect(evaluateJobFailureSpike({ dead24h: 25, deadPrevious7d: 0 }, S)!.severity).toBe("critical");
    // IA: con pocos pedidos no se evalúa
    expect(evaluateAiFailureSpike({ requests24h: 10, failures24h: 10 }, S)).toBeNull();
    expect(evaluateAiFailureSpike({ requests24h: 40, failures24h: 10 }, S)).toBeNull();
    expect(evaluateAiFailureSpike({ requests24h: 40, failures24h: 12 }, S)!.title).toContain("30 %");
  });

  it("datos contradictorios reutilizan los hallazgos de calidad; tope diario de avisos", () => {
    expect(evaluateContradictions({ propertyCode: 5, findings: [{ code: "description_short", title: "x" }] })).toBeNull();
    const v = evaluateContradictions({ propertyCode: 5, findings: [{ code: "covered_gt_total", title: "Superficie cubierta mayor que la total" }] })!;
    expect(v.severity).toBe("info");
    expect(v.evidence).toEqual([{ label: "Inconsistencia", value: "Superficie cubierta mayor que la total" }]);
    expect(notificationsAllowed(0, 5)).toBe(5);
    expect(notificationsAllowed(5, 5)).toBe(0);
    expect(notificationsAllowed(9, 5)).toBe(0);
  });

  it("settings: valores fuera de rango usan el default y el crítico nunca queda debajo del aviso", () => {
    const s = parseManagementSettings(new Map<string, unknown>([["ai.anomalies.inquiry_min_baseline", 2], ["ai.anomalies.lead_uncontacted_hours", 48], ["ai.anomalies.lead_uncontacted_critical_hours", 24]]));
    expect(s.inquiryMinBaseline).toBe(8);
    expect(s.leadUncontactedCriticalHours).toBe(48);
  });
});

const cand = (over: Partial<SuggestionCandidate>): SuggestionCandidate => ({
  source: "visit",
  ruleKey: "visit_report",
  entityType: "appointment",
  entityId: "00000000-0000-4000-8000-000000000001",
  assignedUserId: null,
  priority: "medium",
  title: "t",
  reason: "r",
  evidence: [],
  link: "/crm",
  fingerprint: "a".repeat(32),
  task: { kind: "task", title: "t", dueInHours: 1, priority: "normal" },
  ...over,
});

describe("Tareas sugeridas: prioridad, orden y dedupe", () => {
  it("la prioridad manda sobre el origen y la antigüedad", () => {
    const old = new Date(NOW.getTime() - 30 * 24 * 3_600_000);
    const lowOld = { priority: "low" as const, source: "ops_alert" as const, createdAt: old };
    const mediumNew = { priority: "medium" as const, source: "property_quality" as const, createdAt: NOW };
    expect(suggestionScore(mediumNew, NOW)).toBeGreaterThan(suggestionScore(lowOld, NOW));
    const highQuality = { priority: "high" as const, source: "property_quality" as const, createdAt: NOW };
    const highAlert = { priority: "high" as const, source: "ops_alert" as const, createdAt: NOW };
    const highSalesOld = { priority: "high" as const, source: "sales_nba" as const, createdAt: new Date(NOW.getTime() - 10 * 3_600_000) };
    expect(rankSuggestions([highQuality, lowOld, highSalesOld, mediumNew, highAlert], NOW)).toEqual([highAlert, highSalesOld, highQuality, mediumNew, lowOld]);
  });

  it("dedupe: una por (entidad, regla, huella), gana la de mayor prioridad", () => {
    const a = cand({ priority: "low" });
    const b = cand({ priority: "high", title: "alta" });
    const other = cand({ fingerprint: "b".repeat(32) });
    const out = dedupeCandidates([a, b, other], "org");
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.fingerprint === "a".repeat(32))!.title).toBe("alta");
  });

  it("posponer: fecha futura, máximo de días y formato", () => {
    expect(snoozeUntil("2026-09-20", NOW, 90)).toEqual({ ok: true, until: new Date("2026-09-20T11:00:00Z") });
    expect(snoozeUntil("2026-09-16", NOW, 90)).toMatchObject({ ok: false });
    expect(snoozeUntil("2027-09-20", NOW, 90)).toMatchObject({ ok: false, message: "Se puede posponer hasta 90 días" });
    expect(snoozeUntil("mañana", NOW, 90)).toMatchObject({ ok: false });
  });
});

describe("protección contra loops", () => {
  it("profundidad máxima y misma cadena", () => {
    expect(normalizeMaxDepth("3")).toBe(3);
    expect(normalizeMaxDepth(99)).toBe(3);
    expect(dispatchAllowed(0, 3)).toBe(true);
    expect(dispatchAllowed(3, 3)).toBe(false);
    expect(loopGuard({ automationKey: "a", depth: 0, maxDepth: 3, chainAutomations: [] })).toEqual({ allowed: true });
    expect(loopGuard({ automationKey: "a", depth: 2, maxDepth: 3, chainAutomations: ["b", null] })).toEqual({ allowed: true });
    expect(loopGuard({ automationKey: "a", depth: 2, maxDepth: 3, chainAutomations: ["b", "a"] })).toEqual({ allowed: false, reason: "same_chain" });
    expect(loopGuard({ automationKey: "a", depth: 3, maxDepth: 3, chainAutomations: [] })).toEqual({ allowed: false, reason: "max_depth" });
  });
});

describe("métricas de dirección", () => {
  it("períodos en hora de Salta con comparación equivalente", () => {
    const month = periodRange("this_month", NOW);
    expect(month.from.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(month.previous.from.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    // mismo tramo: 16 días y 12 horas
    expect(month.previous.to.getTime() - month.previous.from.getTime()).toBe(NOW.getTime() - month.from.getTime());
    expect(month.label).toBe("Mes en curso (01/09 al 17/09)");
    const last = periodRange("last_month", NOW);
    expect([last.from.toISOString(), last.to.toISOString(), last.previous.from.toISOString()]).toEqual(["2026-08-01T03:00:00.000Z", "2026-09-01T03:00:00.000Z", "2026-07-01T03:00:00.000Z"]);
    const week = periodRange("this_week", NOW);
    expect(week.from.toISOString()).toBe("2026-09-14T03:00:00.000Z"); // lunes 14 en Salta
    const d7 = periodRange("last_7_days", NOW);
    expect(d7.previous.to.getTime()).toBe(d7.from.getTime());
    // Marzo: el mes anterior (febrero) es más corto → el tramo se corta en su fin.
    const march = periodRange("this_month", new Date("2026-03-31T20:00:00Z"));
    expect(march.previous.to.toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("comparaciones: sin porcentaje con muestra chica o sin base", () => {
    expect(compareCounts(12, 9)).toEqual({ current: 12, previous: 9, delta: 3, pct: 33, smallSample: false });
    expect(formatComparison(compareCounts(12, 9))).toBe("12 (período anterior: 9, +3, +33 %)");
    expect(formatComparison(compareCounts(3, 1))).toBe("3 (período anterior: 1, +2; muestra chica, sin variación porcentual)");
    expect(formatComparison(compareCounts(7, 0))).toBe("7 (período anterior: 0, +7; sin base para porcentaje)");
    expect(formatComparison(compareCounts(4, 4))).toBe("4 (período anterior: 4, sin cambios)");
  });

  it("tasas y medianas con mínimo de muestra", () => {
    expect(rate(2, 4)).toEqual({ numerator: 2, denominator: 4, value: null });
    expect(formatRate(rate(2, 4))).toContain("muestra chica");
    expect(formatRate(rate(3, 10))).toBe("30 % (3 de 10)");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(robustMedian([1, 2])).toBeNull();
    expect(formatHours(null)).toBe("sin muestra suficiente");
    expect(formatHours(0.25)).toBe("15 min");
    expect(formatHours(3.46)).toBe("3,5 h");
    expect(formatHours(72)).toBe("3 días");
  });
});

describe("Resumen de hoy", () => {
  it("oculta los ceros, ordena por urgencia y define cada cifra", () => {
    const items = buildBriefItems([
      { key: "low_quality", count: 4, href: "/crm/propiedades?quality=low", scope: "all" },
      { key: "visits_today", count: 0, href: "/crm/agenda", scope: "own" },
      { key: "overdue_followups", count: 1, href: "/crm/tareas", scope: "own" },
      { key: "high_intent_leads", count: 2, href: "/crm/tareas-sugeridas", scope: "own" },
    ]);
    expect(items.map((i) => i.key)).toEqual(["high_intent_leads", "overdue_followups", "low_quality"]);
    expect(items[1]).toMatchObject({ label: "seguimiento vencido", tone: "danger" });
    expect(items[1]!.definition).toContain("asignadas a vos");
    expect(items[2]!.label).toBe("publicaciones con calidad baja");
    expect(factsHash({ day: "2026-09-17", items })).toBe(factsHash({ day: "2026-09-17", items: [...items] }));
    expect(factsHash({ day: "2026-09-17", items })).not.toBe(factsHash({ day: "2026-09-18", items }));
  });

  it("saludo por hora de Salta y nombre de pila", () => {
    expect(saltaHour(NOW)).toBe(12);
    expect(greeting(8)).toBe("Buen día");
    expect(greeting(12)).toBe("Buenas tardes");
    expect(greeting(21)).toBe("Buenas noches");
    expect(greeting(3)).toBe("Buenas noches");
    expect(firstName("  María José Pérez")).toBe("María");
  });

  it("la redacción con IA solo puede usar cifras de los conteos", () => {
    const items = buildBriefItems([{ key: "overdue_followups", count: 3, href: "/crm/tareas", scope: "own" }]);
    expect(narrativeViolations(["Tenés 3 seguimientos vencidos."], items)).toEqual([]);
    expect(narrativeViolations(["Tenés 4 seguimientos vencidos, un 20 % más."], items).map((v) => v.kind)).toEqual(expect.arrayContaining(["number", "amount"]));
    expect(narrativeViolations(["Mirá /crm/tareas"], items).map((v) => v.kind)).toContain("link");
  });
});

describe("privacidad: la ubicación de agentes nunca alimenta recomendaciones ni métricas", () => {
  it("ningún archivo de gestión, anomalías, dirección, reacciones ni tareas sugeridas lee check-ins o coordenadas", () => {
    const roots = ["src/server/ai/anomalies", "src/server/ai/task-center", "src/server/ai/brief", "src/server/ai/executive", "src/server/ai/command-center", "src/server/ai/automation", "src/server/ai/domains/executive-management.ts"].map((p) => resolve(import.meta.dirname, "../..", p));
    const files: string[] = [];
    const walk = (p: string) => (statSync(p).isDirectory() ? readdirSync(p).forEach((f) => walk(join(p, f))) : files.push(p));
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      // Se ignoran los comentarios (documentan justamente que no se usa).
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/appointment_checkins|latitude|longitude|distance_m|accuracy_m|geofence/);
    }
  });
});
