import { describe, expect, it } from "vitest";
import type { PortalProperty } from "@/server/integrations/portals/types";
import { deriveListAttributes, mapToMercadoLibre, missingRequiredAttributes, splitArgentineWhatsApp, type MercadoLibreItemDraft } from "@/server/integrations/portals/mercadolibre/mapping";
import { buildListingSheet } from "@/server/integrations/portals/agreement-only";
import { payloadHash } from "@/server/integrations/portals/snapshot";
import { buildCopyVars, renderContentTemplate } from "@/server/marketing/copy";
import { utcToZonedLocal, zonedLocalToUtc } from "@/server/marketing/time";
import { paddedCanvas } from "@/server/marketing/images";

export function fixture(over: Partial<PortalProperty> = {}): PortalProperty {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    code: 1203,
    slug: "casa-en-tres-cerritos-1203",
    title: "Casa en Tres Cerritos",
    description: "Casa de tres dormitorios con jardín.",
    typeKey: "casa",
    typeName: "Casa",
    status: "available",
    isPublished: true,
    operations: [{ operation: "sale", currency: "USD", amount: 230000, priceHidden: false, expensesAmount: null, expensesCurrency: null }],
    locationChain: [
      { id: "l1", kind: "neighborhood", name: "Tres Cerritos" },
      { id: "l2", kind: "locality", name: "Salta" },
      { id: "l3", kind: "province", name: "Salta" },
    ],
    externalLocationRefs: { mercadolibre: [{ externalType: "neighborhood", externalId: "TUxBQlRSRTEyMzQ" }] },
    address: { street: "Los Ceibos", number: "123", hideExact: true, latitude: -24.77, longitude: -65.4 },
    areas: { totalM2: null, coveredM2: 180, uncoveredM2: null, landM2: 450 },
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    toilets: null,
    garages: 1,
    ageYears: null,
    allowsPets: null,
    creditEligible: null,
    features: ["Pileta"],
    photos: [
      { mediaId: "m2", url: "https://cdn.example.com/2.jpg", isCover: false },
      { mediaId: "m1", url: "https://cdn.example.com/1.jpg", isCover: true },
    ],
    publicUrl: "https://www.luciolopezfleming.com.ar/propiedades/casa-en-tres-cerritos-1203",
    contact: { name: "Lucio López Fleming Inmobiliaria", email: "info@example.com", phone: "+54 387 421-4143" },
    ...over,
  };
}

const cfg = { listingTypeId: "silver", whatsappE164: "+5493875551234" };

describe("mapeo Mercado Libre", () => {
  it("arma el aviso con datos reales, portada primero y sin coordenadas si la dirección está oculta", () => {
    const r = mapToMercadoLibre(fixture(), cfg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { item, typeCategoryId, operationName } = r.payload;
    expect(typeCategoryId).toBe("MLA1466");
    expect(operationName).toBe("Venta");
    expect(item.price).toBe(230000);
    expect(item.currency_id).toBe("USD");
    expect(item.available_quantity).toBe(1);
    expect(item.buying_mode).toBe("classified");
    expect(item.pictures[0]!.source).toBe("https://cdn.example.com/1.jpg");
    expect(item.location).toEqual({ address_line: "Los Ceibos", neighborhood: { id: "TUxBQlRSRTEyMzQ" } });
    expect(item.attributes).toEqual(
      expect.arrayContaining([
        { id: "BEDROOMS", value_name: "3" },
        { id: "FULL_BATHROOMS", value_name: "2" },
        { id: "COVERED_AREA", value_name: "180 m²" },
        { id: "TOTAL_AREA", value_name: "450 m²" },
      ]),
    );
    // Datos no cargados NO se inventan
    expect(item.attributes.find((a) => a.id === "IS_SUITABLE_FOR_PETS")).toBeUndefined();
    expect(item.seller_contact).toMatchObject({ country_code2: "54", phone2: "93875551234" });
    expect(item.description.plain_text).toContain("Código de referencia: 1203");
  });

  it("dirección oculta: nunca envía la altura, tampoco la embebida en la calle (importación: \"Sarmiento 447\")", () => {
    const embedded = mapToMercadoLibre(fixture({ address: { street: "Sarmiento 447", number: null, hideExact: true, latitude: null, longitude: null } }), cfg);
    expect(embedded.ok && embedded.payload.item.location.address_line).toBe("Sarmiento");
    const both = mapToMercadoLibre(fixture({ address: { street: "Av. Entre Ríos N° 639", number: "639", hideExact: true, latitude: null, longitude: null } }), cfg);
    expect(both.ok && both.payload.item.location.address_line).toBe("Av. Entre Ríos");
    // Sin nombre de calle utilizable → la localidad
    const onlyNumber = mapToMercadoLibre(fixture({ address: { street: "447", number: null, hideExact: true, latitude: null, longitude: null } }), cfg);
    expect(onlyNumber.ok && onlyNumber.payload.item.location.address_line).not.toMatch(/\d/);
  });

  it("dirección visible → número y coordenadas", () => {
    const r = mapToMercadoLibre(fixture({ address: { street: "Los Ceibos", number: "123", hideExact: false, latitude: -24.77, longitude: -65.4 } }), cfg);
    expect(r.ok && r.payload.item.location).toMatchObject({ address_line: "Los Ceibos 123", latitude: -24.77, longitude: -65.4 });
  });

  it("informa qué falta en lugar de inventar: precio oculto, sin fotos, sin vínculo de ubicación, emprendimiento", () => {
    const r = mapToMercadoLibre(
      fixture({
        typeKey: "emprendimiento",
        operations: [{ operation: "sale", currency: "USD", amount: null, priceHidden: true, expensesAmount: null, expensesCurrency: null }],
        photos: [],
        externalLocationRefs: {},
      }),
      { ...cfg, whatsappE164: "3875551234" },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toMatch(/emprendimientos/);
    expect(r.errors.join("\n")).toMatch(/precio/);
    expect(r.errors.join("\n")).toMatch(/fotos/);
    expect(r.errors.join("\n")).toMatch(/barrio o ciudad/);
    expect(r.errors.join("\n")).toMatch(/E\.164/);
  });

  it("alquiler cuando no hay venta; expensas como MAINTENANCE_FEE", () => {
    const r = mapToMercadoLibre(fixture({ operations: [{ operation: "rent", currency: "ARS", amount: 700000, priceHidden: false, expensesAmount: 55000, expensesCurrency: "ARS" }] }), cfg);
    expect(r.ok && r.payload.operationName).toBe("Alquiler");
    expect(r.ok && r.payload.item.attributes).toContainEqual({ id: "MAINTENANCE_FEE", value_name: "55000 ARS" });
  });

  it("atributos requeridos: detecta faltantes y deriva listas solo desde valores permitidos", () => {
    const r = mapToMercadoLibre(fixture(), cfg);
    const draft = (r as { payload: MercadoLibreItemDraft }).payload;
    const defs = [
      { id: "BEDROOMS", name: "Dormitorios", tags: { required: true } },
      { id: "FURNISHED", name: "Amoblado", tags: { required: true }, values: [{ id: "1", name: "Sí" }, { id: "2", name: "No" }] },
      { id: "OPERATION", name: "Operación", tags: { required: true }, values: [{ id: "242075", name: "Venta" }, { id: "242073", name: "Alquiler" }] },
      { id: "PROPERTY_TYPE", name: "Inmueble", tags: { required: true }, values: [{ id: "242060", name: "Casa" }] },
      { id: "ITEM_CONDITION", name: "Condición", tags: { required: true, read_only: true } },
    ];
    const derived = deriveListAttributes(defs, draft, "Casa");
    expect(derived).toEqual([
      { id: "OPERATION", value_name: "Venta" },
      { id: "PROPERTY_TYPE", value_name: "Casa" },
    ]);
    expect(missingRequiredAttributes(defs, [...draft.item.attributes, ...derived]).map((d) => d.name)).toEqual(["Amoblado"]);
  });

  it("WhatsApp argentino E.164", () => {
    expect(splitArgentineWhatsApp("+54 9 387 555-1234")).toEqual({ countryCode: "54", number: "93875551234" });
    expect(splitArgentineWhatsApp("+59899123456")).toBeNull();
  });
});

describe("ficha normalizada (portales sin API pública)", () => {
  it("oculta número y coordenadas si corresponde y valida mínimos", () => {
    const r = buildListingSheet(fixture());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.location).toMatchObject({ hierarchy: ["Salta", "Salta", "Tres Cerritos"], number: null, latitude: null, showExactAddress: false });
    expect(r.payload.photos[0]).toBe("https://cdn.example.com/1.jpg");
    expect(buildListingSheet(fixture({ photos: [], locationChain: [] })).ok).toBe(false);
  });
});

describe("hash de payload", () => {
  it("estable ante orden de claves y sensible a cambios y al estado deseado", () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: [1, 2] } }, "published")).toBe(payloadHash({ b: { d: [1, 2], c: 2 }, a: 1 }, "published"));
    expect(payloadHash({ a: 1 }, "published")).not.toBe(payloadHash({ a: 2 }, "published"));
    expect(payloadHash({ a: 1 }, "published")).not.toBe(payloadHash({ a: 1 }, "unpublished"));
  });
});

describe("copy de redes desde plantilla", () => {
  const body = "{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{precio}}\n\nCódigo {{codigo}} · Ficha completa en {{link}}";

  it("usa solo datos reales y omite líneas sin dato", () => {
    const vars = buildCopyVars(fixture({ bathrooms: null }), { name: "Lucio López Fleming Inmobiliaria", foundedYear: 1974 });
    const text = renderContentTemplate(body, vars);
    expect(text).toContain("Casa en venta · Tres Cerritos, Salta");
    expect(text).toContain("3 dormitorios");
    expect(text).toContain("180 m² cubiertos · 450 m² de terreno");
    expect(text).toContain("USD 230.000");
    expect(text).not.toMatch(/baño/);
    expect(text).not.toMatch(/\{\{/);
    expect(text).not.toMatch(/\n{3,}/);
    expect(vars.inmobiliaria).toBe("Lucio López Fleming Inmobiliaria · desde 1974");
  });

  it("precio oculto no aparece", () => {
    const vars = buildCopyVars(fixture({ operations: [{ operation: "sale", currency: "USD", amount: null, priceHidden: true, expensesAmount: null, expensesCurrency: null }] }), { name: "LLF", foundedYear: null });
    expect(renderContentTemplate(body, vars)).not.toMatch(/USD|\$/);
  });
});

describe("zona horaria de Salta y lienzo de Instagram", () => {
  it("convierte hora local de Salta (UTC-3) a UTC y de vuelta", () => {
    expect(zonedLocalToUtc("2026-10-01T09:30").toISOString()).toBe("2026-10-01T12:30:00.000Z");
    expect(utcToZonedLocal(new Date("2026-10-01T12:30:00Z"))).toBe("2026-10-01T09:30");
  });

  it("agrega márgenes solo si la proporción queda fuera de 4:5 – 1.91:1", () => {
    expect(paddedCanvas(1080, 1080)).toEqual({ width: 1080, height: 1080 });
    expect(paddedCanvas(600, 1200)).toEqual({ width: 960, height: 1200 });
    expect(paddedCanvas(3000, 1000)).toEqual({ width: 3000, height: 1571 });
  });
});
