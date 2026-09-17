/** Siguiente acción recomendada y señales de interés (puros): reglas explicables, prioridades y huellas estables. */
import { describe, expect, it } from "vitest";
import { recommendNextActions, type NbaFacts } from "@/server/sales/nba/rules";
import { computeIntentSignals, type SignalFacts } from "@/server/sales/signals/rules";

const now = new Date("2026-09-17T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const noSignals: SignalFacts = { propertyDays: [], tours: [], qa: [], compared: 0, visitRequests: [] };

const base = (over: Partial<NbaFacts> = {}): NbaFacts => ({
  now,
  lead: null,
  opportunity: null,
  visitRequest: null,
  upcomingVisit: null,
  lastCompletedVisit: null,
  signals: { level: null, signals: [] },
  profile: { budget: "confirmed", pendingSuggestionIds: [], matchable: true },
  dismissedForPrice: [],
  newCompatible: [],
  lastActivityAt: hoursAgo(2),
  ...over,
});

describe("señales de interés", () => {
  it("sin hechos no hay nivel (no se inventa)", () => {
    expect(computeIntentSignals(noSignals)).toEqual({ level: null, score: 0, signals: [] });
  });

  it("volvió a la propiedad en 2 días distintos + tour + pidió visita → alta, con la lista que lo explica", () => {
    const r = computeIntentSignals({
      propertyDays: [
        { propertyId: "p1", code: 3021, day: "2026-09-10" },
        { propertyId: "p1", code: 3021, day: "2026-09-10" },
        { propertyId: "p1", code: 3021, day: "2026-09-15" },
      ],
      tours: [{ propertyId: "p1", code: 3021 }],
      qa: [{ propertyId: "p1", code: 3021, topic: "availability" }],
      compared: 1,
      visitRequests: [{ propertyId: "p1", code: 3021, at: hoursAgo(3) }],
    });
    expect(r.level).toBe("high");
    expect(r.signals.map((s) => s.label)).toEqual([
      "Solicitó visitar la propiedad #3021",
      "Volvió a la propiedad #3021 (2 días distintos)",
      "Hizo el tour 360° de la propiedad #3021",
      "Preguntó por la disponibilidad de la propiedad #3021",
      "Comparó propiedades",
    ]);
  });

  it("una sola vista el mismo día no es «volvió»; comparar solo es baja", () => {
    const r = computeIntentSignals({ ...noSignals, propertyDays: [{ propertyId: "p1", code: 1, day: "2026-09-10" }], compared: 1 });
    expect(r.signals.map((s) => s.key)).toEqual(["compared"]);
    expect(r.level).toBe("low");
  });
});

describe("siguiente acción recomendada", () => {
  const lead = { id: "11111111-1111-4111-8111-111111111111", status: "new", createdAt: hoursAgo(5), firstResponseAt: null, propertyCode: 3021 };

  it("«Contactar hoy — solicitó información y volvió a ver la propiedad» con prioridad alta y tarea sugerida", () => {
    const signals = computeIntentSignals({ ...noSignals, propertyDays: [{ propertyId: "p1", code: 3021, day: "2026-09-12" }, { propertyId: "p1", code: 3021, day: "2026-09-16" }] });
    const [first] = recommendNextActions(base({ lead, signals }));
    expect(first).toMatchObject({ ruleKey: "contact_today", priority: "high", title: "Contactar hoy", task: { kind: "call", priority: "urgent" } });
    expect(first!.reason).toBe("Solicitó información y volvió a la propiedad #3021 (2 días distintos).");
    expect(first!.evidence).toContain("Consulta sin primer contacto hace 5 h");
  });

  it("consulta sin responder y sin señales → «Responder la consulta» (alta si pasaron 2 h)", () => {
    expect(recommendNextActions(base({ lead: { ...lead, createdAt: hoursAgo(1) } }))[0]).toMatchObject({ ruleKey: "first_response", priority: "medium" });
    expect(recommendNextActions(base({ lead }))[0]).toMatchObject({ ruleKey: "first_response", priority: "high" });
    expect(recommendNextActions(base({ lead: { ...lead, firstResponseAt: hoursAgo(1) } })).map((r) => r.ruleKey)).not.toContain("first_response");
  });

  it("pidió visita sin visita agendada → «Coordinar visita»; con visita próxima no", () => {
    const visitRequest = { at: hoursAgo(2), propertyCode: 3021 };
    expect(recommendNextActions(base({ visitRequest })).map((r) => r.title)).toContain("Coordinar visita");
    expect(recommendNextActions(base({ visitRequest, upcomingVisit: { at: new Date(now.getTime() + 86_400_000) } })).map((r) => r.ruleKey)).not.toContain("schedule_visit");
  });

  it("descartó por presupuesto y hay compatibles nuevas → «Enviar nuevas opciones» explicando por qué", () => {
    const [r] = recommendNextActions(base({ dismissedForPrice: [1200], newCompatible: [{ propertyId: "p9", code: 4410 }] }));
    expect(r).toMatchObject({ ruleKey: "send_new_options", title: "Enviar nuevas opciones" });
    expect(r!.reason).toBe("Descartó por presupuesto; hay una propiedad compatible nueva (#4410).");
  });

  it("presupuesto faltante o sugerido → «Pedir confirmación de presupuesto» solo si hay una consulta u oportunidad abierta", () => {
    expect(recommendNextActions(base({ profile: { budget: "missing", pendingSuggestionIds: [], matchable: false } }))).toEqual([]);
    const r = recommendNextActions(base({ lead: { ...lead, firstResponseAt: hoursAgo(1), status: "contacted" }, profile: { budget: "suggested", pendingSuggestionIds: ["x"], matchable: true } }));
    expect(r.map((x) => x.ruleKey)).toEqual(["confirm_budget", "review_profile"]);
  });

  it("huella estable (misma evidencia → misma huella) y máximo de 3, ordenadas por prioridad", () => {
    const facts = base({ lead, visitRequest: { at: hoursAgo(2), propertyCode: 3021 }, newCompatible: [{ propertyId: "p2", code: 2 }], profile: { budget: "missing", pendingSuggestionIds: ["a"], matchable: true } });
    const a = recommendNextActions(facts);
    const b = recommendNextActions(facts);
    expect(a.map((x) => x.fingerprint)).toEqual(b.map((x) => x.fingerprint));
    expect(a).toHaveLength(3);
    expect(a.map((x) => x.priority)).toEqual(["high", "high", "medium"]);
  });

  it("oportunidad estancada sin actividad → «Retomar el contacto»", () => {
    const r = recommendNextActions(base({ opportunity: { id: "o1", status: "open", stageName: "Visita realizada", stageEnteredAt: hoursAgo(24 * 20) }, lastActivityAt: hoursAgo(24 * 15) }));
    expect(r.map((x) => x.ruleKey)).toContain("reactivate");
  });
});
