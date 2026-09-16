import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapAdincoProperty, hasBlockingWarning } from "@/server/migration/adinco/map";
import { extractPropertyFromHtml } from "@/server/migration/adinco/client";

const real = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/adinco-property-3021.json"), "utf8"));

describe("mapeo Adinco (ficha real 3021)", () => {
  const { property, warnings } = mapAdincoProperty(real);
  it("normaliza datos sin inventar", () => {
    expect(property).toMatchObject({
      externalId: "6530875",
      code: 3021,
      typeKey: "casa",
      operation: "sale",
      currency: "USD",
      amount: 250000,
      priceHidden: false,
      bedrooms: 5,
      bathrooms: 3,
      coveredAreaM2: 400,
      landAreaM2: 2000,
      totalAreaM2: 2000,
      garages: 4,
      latitude: -24.78212738,
      redirectPath: "/luciolopez-3021",
      sellerExternalId: "9587",
      officeExternalId: "3600",
      hideExactAddress: true,
    });
    expect(property!.slug).toBe("casa-venta-salta-3021");
    expect(property!.locations.map((l) => [l.kind, l.name])).toEqual([["province", "Salta"], ["locality", "Salta"], ["neighborhood", "Salta"]]);
    expect(property!.media).toHaveLength(23);
    expect(property!.media[0]).toMatchObject({ isCover: true, sourceUrl: "https://static1.adinco.net/5780356_p/6aa81cca50e67.jpg" });
    expect(property!.features.map((f) => f.key)).toEqual(expect.arrayContaining(["agua_corriente", "cloacas", "pileta"]));
  });
  it("marca el título genérico sin cambiarlo y no bloquea", () => {
    expect(property!.title).toBe("casa en venta");
    expect(warnings.find((w) => w.code === "generic_title")?.severity).toBe("info");
    expect(hasBlockingWarning(warnings)).toBe(false);
  });
});

describe("anomalías reales detectadas en el origen", () => {
  it("venta en USD con precio implausible queda en revisión (caso predio USD 150)", () => {
    const r = mapAdincoProperty({ ...real, code: 3020, price: 150, type: "Negocio Especial" });
    expect(r.warnings.find((w) => w.code === "implausible_price")?.severity).toBe("error");
    expect(r.property!.amount).toBe(150);
    expect(hasBlockingWarning(r.warnings)).toBe(true);
  });
  it("precio por hectárea en la descripción (caso 1716)", () => {
    const r = mapAdincoProperty({ ...real, type: "Terreno", price: 18000, description: "Excelente terreno. precio: u$18.000 la hectarea" });
    expect(r.warnings.map((w) => w.code)).toContain("price_per_unit_in_description");
  });
  it("hectáreas se convierten y superficies absurdas no se guardan (caso 2435)", () => {
    const finca = mapAdincoProperty({ ...real, type: "Terreno", totalArea: 52, totalAreaUnit: 2, landArea: null, coveredArea: null });
    expect(finca.property!.totalAreaM2).toBe(520_000);
    expect(finca.property!.attributes.hectares).toBe(52);
    const hotel = mapAdincoProperty({ ...real, type: "Hotel", totalArea: 395386, totalAreaUnit: 2 });
    expect(hotel.property!.totalAreaM2).toBeNull();
    expect(hotel.warnings.find((w) => w.code === "implausible_area")?.severity).toBe("error");
  });
  it("sin fotos, sin localidad o coordenadas fuera del país bloquean", () => {
    expect(hasBlockingWarning(mapAdincoProperty({ ...real, multimedia: [] }).warnings)).toBe(true);
    expect(hasBlockingWarning(mapAdincoProperty({ ...real, zp_2: null, zp_3: null }).warnings)).toBe(true);
    const out = mapAdincoProperty({ ...real, latitude: 40.4, longitude: -3.7 });
    expect(out.property!.latitude).toBeNull();
    expect(hasBlockingWarning(out.warnings)).toBe(true);
  });
  it("precio oculto se respeta; alquiler en pesos; reservada", () => {
    const r = mapAdincoProperty({ ...real, hiddenPrice: true, operation: "Alquiler", currencyId: "pesos", price: 700000, statusId: 2 });
    expect(r.property).toMatchObject({ priceHidden: true, operation: "rent", currency: "ARS", status: "reserved" });
  });
  it("emprendimientos del origen: sin precio → 'Consultar', posesión como atributo; flags 0/1 y nombres nulos", () => {
    const r = mapAdincoProperty({ ...real, type: "property.type.property_type_development", title: "WA HOMES", price: null, currencyId: null, possessionDate: "2027-06-01 00:00:00", allowsPets: 1, aptoCredito: 0, ambients: [{ id: 1, name: null }] });
    expect(r.property).toMatchObject({ typeKey: "emprendimiento", priceHidden: true, amount: null, allowsPets: true, creditEligible: false });
    expect(r.property!.attributes.possession_date).toBe("2027-06-01");
    expect(hasBlockingWarning(r.warnings)).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("development_price_on_request");
  });
  it("una casa sin precio sí bloquea y moneda desconocida con monto también", () => {
    expect(hasBlockingWarning(mapAdincoProperty({ ...real, price: null, currencyId: null }).warnings)).toBe(true);
    expect(mapAdincoProperty({ ...real, currencyId: "eur" }).warnings.map((w) => w.code)).toContain("unknown_currency");
  });
  it("payload inválido no revienta: advertencia de error", () => {
    const r = mapAdincoProperty({ foo: 1 });
    expect(r.property).toBeNull();
    expect(r.warnings[0]!.code).toBe("invalid_source_payload");
  });
  it("extrae la propiedad del HTML SSR", () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { property: { id: 1 } } } })}</script></html>`;
    expect(extractPropertyFromHtml(html)).toEqual({ id: 1 });
    expect(() => extractPropertyFromHtml("<html></html>")).toThrow(/__NEXT_DATA__/);
  });
});
