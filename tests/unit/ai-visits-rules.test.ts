/** IA de visitas: brief determinista con «NO REGISTRADO» y seguimiento sugerido con motivo. */
import { describe, expect, it } from "vitest";
import { buildDeterministicBrief, notRegisteredItems, suggestVisitFollowUp, type BriefInput } from "@/server/ai/visits/rules";

function input(over: Partial<BriefInput> = {}, prop: Partial<BriefInput["property"]> = {}): BriefInput {
  return {
    startsAt: new Date("2026-09-18T14:00:00Z"),
    agentName: "Julieta Agente",
    client: { name: "Mariana Pérez" },
    property: {
      code: 3021,
      title: "Casa en Tres Cerritos",
      typeName: "Casa",
      category: "residential",
      zone: "Tres Cerritos",
      operations: [{ operation: "sale", currency: "USD", amount: 230000, priceHidden: false, expensesAmount: null, expensesCurrency: null }],
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      garages: null,
      areas: { totalM2: null, coveredM2: 180, landM2: 450 },
      ageYears: null,
      orientation: null,
      condition: null,
      creditEligible: null,
      allowsPets: null,
      features: ["Parrilla"],
      hasDeedDocument: false,
      tourPublished: true,
      ...prop,
    },
    seeking: { operationInterest: "sale", opportunity: { title: "Casa 3 dorm. zona norte", stage: "Visita", budgetMin: null, budgetMax: 250000, budgetCurrency: "USD" }, notes: ["Tiene dos perros"], buyerProfile: null },
    asked: [{ at: new Date("2026-09-15T12:00:00Z"), source: "WhatsApp", text: "¿Tiene expensas? ¿Acepta mascotas?" }],
    ...over,
  };
}

describe("brief previo determinista", () => {
  it("hechos numerados por sección: cliente, qué busca, qué preguntó y propiedad", () => {
    const b = buildDeterministicBrief(input());
    expect(b.headline).toBe("Mariana Pérez · Casa #3021 en Tres Cerritos");
    expect(b.facts.map((f) => f.id)).toEqual(b.facts.map((_, i) => `H${i + 1}`));
    const text = (s: string) => b.facts.filter((f) => f.section === s).map((f) => f.text);
    expect(text("cliente")).toEqual(["Cliente: Mariana Pérez.", "Visita a las 11:00 con Julieta Agente."]);
    expect(text("busca")).toEqual(["En su consulta indicó que busca comprar.", "Oportunidad: «Casa 3 dorm. zona norte» (etapa Visita).", "Presupuesto registrado: hasta USD 250.000.", "Nota del equipo: «Tiene dos perros»"]);
    expect(text("pregunto")[0]).toMatch(/WhatsApp: «¿Tiene expensas\? ¿Acepta mascotas\?»$/);
    expect(text("propiedad")).toEqual(expect.arrayContaining(["#3021 · Casa en venta en Tres Cerritos.", "Precio USD 230.000.", "5 ambientes, 3 dormitorios, 2 baños.", "180 m² cubiertos, terreno de 450 m².", "Características: Parrilla.", "Tiene tour 360° publicado (podés mostrarlo antes o después de la visita)."]));
  });

  it("NO REGISTRADO: lista explícita de lo que el cliente podría preguntar y no consta", () => {
    expect(buildDeterministicBrief(input()).notRegistered).toEqual([
      "Gastos / expensas",
      "Escritura (no hay documento cargado)",
      "Orientación",
      "Antigüedad",
      "Estado de conservación",
      "Apta crédito",
      "Acepta mascotas",
      "Cocheras",
      "Servicios (gas, agua, cloacas)",
    ]);
    const full = notRegisteredItems({ ...input().property, operations: [{ operation: "sale", currency: "USD", amount: 1, priceHidden: false, expensesAmount: 5000, expensesCurrency: "ARS" }], hasDeedDocument: true, orientation: "Norte", ageYears: 0, condition: "Muy bueno", creditEligible: true, allowsPets: true, garages: 1, features: ["Gas natural", "Agua corriente"] });
    expect(full).toEqual([]);
  });

  it("sin cliente, sin búsqueda ni consultas: no inventa nada", () => {
    const b = buildDeterministicBrief(input({ client: null, seeking: { operationInterest: null, opportunity: null, notes: [] }, asked: [] }, { operations: [], features: [], tourPublished: false }));
    expect(b.facts.filter((f) => f.section === "busca" || f.section === "pregunto")).toEqual([]);
    expect(b.facts[0]!.text).toBe("La visita no tiene cliente cargado.");
    expect(b.notRegistered[0]).toBe("Precio");
    expect(JSON.stringify(b)).not.toMatch(/luminos|excelente|oportunidad única/i);
  });

  it("punto de integración: el perfil del comprador (otra rama) se suma como hecho", () => {
    const b = buildDeterministicBrief(input({ seeking: { operationInterest: null, opportunity: null, notes: [], buyerProfile: ["Perfil: busca 3 dormitorios con patio"] } }));
    expect(b.facts.find((f) => f.section === "busca")!.text).toBe("Perfil: busca 3 dormitorios con patio");
  });
});

describe("seguimiento sugerido", () => {
  const finished = new Date("2026-09-17T15:02:00Z");
  const ctx = { propertyCode: 3021, clientName: "Mariana Pérez" };

  it("interés alto + segunda visita → 24 h con motivo", () => {
    const s = suggestVisitFollowUp({ interest: "high", positives: "Le encantó el patio", objections: null, nextStep: "Coordinar segunda visita con la pareja", followUpAt: null }, finished, ctx);
    expect(s.dueAt.toISOString()).toBe("2026-09-18T15:05:00.000Z");
    expect(s.title).toBe("Coordinar segunda visita · Prop. 3021 · Mariana Pérez");
    expect(s.reason).toBe("Interés alto: contacto dentro de las 24 h · Siguiente paso del informe: «Coordinar segunda visita con la pareja»");
  });

  it("objeción de precio y fecha indicada en el informe (manda la del agente)", () => {
    const at = new Date("2026-09-20T13:00:00Z");
    const s = suggestVisitFollowUp({ interest: "medium", positives: null, objections: "Le pareció caro", nextStep: null, followUpAt: at }, finished, ctx);
    expect(s.dueAt).toEqual(at);
    expect(s.reason).toBe("Fecha indicada en el informe confirmado · Objeción de precio registrada: preparar la respuesta antes de llamar");
  });

  it("interés bajo → una semana; sin interés → 48 h", () => {
    expect(suggestVisitFollowUp({ interest: "low", positives: null, objections: null, nextStep: null, followUpAt: null }, finished, ctx).reason).toBe("Interés bajo: seguimiento suave en una semana");
    expect(suggestVisitFollowUp({ interest: null, positives: null, objections: null, nextStep: "Mandar oferta por escrito", followUpAt: null }, finished, { propertyCode: null, clientName: null })).toMatchObject({ title: "Seguimiento de oferta", reason: "Sin interés indicado: 2 días por defecto · Siguiente paso del informe: «Mandar oferta por escrito»" });
  });
});
