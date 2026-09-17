/** Motor de coincidencias (puro): filtros obligatorios, tolerancia de presupuesto, ponderación y explicaciones. */
import { describe, expect, it } from "vitest";
import { explainMatch, profileIsMatchable, scoreMatch, type MatchProfile, type MatchProperty } from "@/server/sales/matching/score";

const casa = (over: Partial<MatchProperty> = {}): MatchProperty => ({
  id: "p1",
  code: 3021,
  published: true,
  status: "available",
  typeKey: "casa",
  typeName: "Casa",
  localitySlug: "salta",
  areaSlug: "tres-cerritos",
  zoneLabel: "Tres Cerritos, Salta",
  operations: [{ operation: "sale", currency: "USD", amount: 175000, priceHidden: false }],
  bedrooms: 3,
  bathrooms: 2,
  surfaceM2: 450,
  featureKeys: ["jardin", "parrilla"],
  ...over,
});

const ok = <T>(value: T) => ({ value, confirmed: true });
const perfil: MatchProfile = {
  transactionType: ok("sale" as const),
  propertyTypes: ok(["casa"]),
  budget: ok({ min: null, max: 180000, currency: "USD" as const }),
  locations: ok([{ kind: "area" as const, slug: "tres-cerritos", name: "Tres Cerritos, Salta", localitySlug: "salta" }]),
  bedroomsMin: ok(3),
  features: ok(["jardin"]),
  surface: ok({ min: 500, max: null }),
};

describe("coincidencias · filtros obligatorios", () => {
  it("coincide y explica: presupuesto, zona, dormitorios y jardín; considera superficie menor", () => {
    const r = scoreMatch(perfil, casa(), { featureNames: new Map([["jardin", "Jardín"]]) });
    expect(r.eligible).toBe(true);
    expect(r.matched).toEqual(["En venta", "Casa", "Presupuesto", "Tres Cerritos, Salta", "3 dormitorios", "Jardín"]);
    expect(r.consider).toEqual(["Superficie menor a la preferida"]);
    expect(r.score).toBe(Math.round(((25 + 25 + 20 + 15 * 0.5 + 15) / (25 + 25 + 20 + 15 + 15)) * 100));
    expect(explainMatch(r)).toBe("Coincide: ✓ En venta ✓ Casa ✓ Presupuesto ✓ Tres Cerritos, Salta ✓ 3 dormitorios ✓ Jardín · Considerar: superficie menor a la preferida");
  });

  it("presupuesto con tolerancia: dentro del 10 % considera; por encima queda afuera", () => {
    const within = scoreMatch(perfil, casa({ operations: [{ operation: "sale", currency: "USD", amount: 195000, priceHidden: false }] }));
    expect(within.eligible).toBe(true);
    expect(within.consider).toContain("Supera el presupuesto en 8 %");
    const over = scoreMatch(perfil, casa({ operations: [{ operation: "sale", currency: "USD", amount: 199000, priceHidden: false }] }));
    expect(over.eligible).toBe(false);
    expect(over.blockers[0]).toMatch(/Supera el presupuesto/);
    expect(scoreMatch(perfil, casa({ operations: [{ operation: "sale", currency: "USD", amount: 199000, priceHidden: false }] }), { tolerancePct: 15 }).eligible).toBe(true);
  });

  it("propiedad no disponible, no publicada, otra operación u otro tipo → nunca candidata", () => {
    expect(scoreMatch(perfil, casa({ status: "reserved" })).eligible).toBe(false);
    expect(scoreMatch(perfil, casa({ status: "sold" })).blockers).toContain("No está disponible");
    expect(scoreMatch(perfil, casa({ published: false })).eligible).toBe(false);
    expect(scoreMatch(perfil, casa({ operations: [{ operation: "rent", currency: "ARS", amount: 900000, priceHidden: false }] })).blockers).toContain("No está en venta");
    expect(scoreMatch(perfil, casa({ typeKey: "terreno", typeName: "Terreno" })).eligible).toBe(false);
  });

  it("precio oculto no descarta: se considera «precio a consultar»", () => {
    const r = scoreMatch(perfil, casa({ operations: [{ operation: "sale", currency: "USD", amount: null, priceHidden: true }] }));
    expect(r.eligible).toBe(true);
    expect(r.consider).toContain("Precio a consultar");
  });

  it("cliente sin preferencias (o incompletas) no genera coincidencias", () => {
    expect(profileIsMatchable({})).toBe(false);
    expect(scoreMatch({}, casa()).eligible).toBe(false);
    expect(profileIsMatchable({ propertyTypes: ok(["casa"]) })).toBe(false);
    expect(profileIsMatchable({ propertyTypes: ok(["casa"]), locations: perfil.locations })).toBe(true);
  });

  it("datos sin confirmar se marcan; vio la propiedad en el sitio suma y se explica", () => {
    const sugerido: MatchProfile = { ...perfil, budget: { value: perfil.budget!.value, confirmed: false } };
    const r = scoreMatch(sugerido, casa(), { signals: { viewedOnSite: true, inquired: true } });
    expect(r.unconfirmed).toBe(true);
    expect(r.matched).toContain("Vio esta propiedad en el sitio");
    expect(r.consider).toContain("Ya consultó por esta propiedad");
    expect(r.score).toBeGreaterThan(scoreMatch(perfil, casa()).score);
  });

  it("zona: mismo barrio suma todo, misma localidad suma parcial, otra zona no suma", () => {
    const otroBarrio = scoreMatch(perfil, casa({ areaSlug: "grand-bourg", zoneLabel: "Grand Bourg, Salta" }));
    expect(otroBarrio.consider).toContain("Misma localidad, otro barrio");
    const otraLocalidad = scoreMatch(perfil, casa({ localitySlug: "vaqueros", areaSlug: null, zoneLabel: "Vaqueros" }));
    expect(otraLocalidad.consider).toContain("Fuera de las zonas preferidas");
    expect(otraLocalidad.score).toBeLessThan(otroBarrio.score);
  });
});
