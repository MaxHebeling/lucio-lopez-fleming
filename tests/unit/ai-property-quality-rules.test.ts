/** Reglas puras de Property Quality AI: completitud ampliada, inconsistencias, descripción, precio con/sin muestra, fotos. */
import { describe, expect, it } from "vitest";
import {
  buildQualityReport,
  descriptionFindings,
  evaluateCriteria,
  inconsistencies,
  median,
  priceCheck,
  priceFinding,
  QUALITY_CRITERIA,
  sectionHref,
  type QualityMedia,
  type QualitySnapshot,
} from "@/server/ai/property/quality-rules";

const ID = "11111111-1111-4111-8111-111111111111";

function snap(over: Partial<QualitySnapshot> = {}): QualitySnapshot {
  return {
    id: ID,
    code: 3021,
    title: "Casa en Tres Cerritos",
    typeKey: "casa",
    category: "residential",
    status: "available",
    isPublished: true,
    description: null,
    locationId: null,
    street: null,
    hasCoordinates: false,
    areas: { totalM2: null, coveredM2: null, landM2: null },
    rooms: null,
    bedrooms: null,
    bathrooms: null,
    garages: null,
    orientation: null,
    floors: null,
    featureCount: 0,
    operations: [],
    hasLeadAgent: false,
    tourPublished: false,
    media: [],
    ...over,
  };
}

const img = (id: string, over: Partial<QualityMedia> = {}): QualityMedia => ({ id, kind: "image", status: "stored", isCover: false, sortOrder: 10, stored: true, room: null, metrics: null, ...over });
const good = { dhash: "0123456789abcdef", luminanceMean: 120, luminanceP95: 200, laplacianVariance: 800, luminanceVariance: 2000 };

const complete = () =>
  snap({
    description: "Casa luminosa en Tres Cerritos con 3 dormitorios, 2 baños y 180 m2 cubiertos sobre un terreno amplio. Living comedor con salida a la galería, cocina independiente, jardín con parrilla y cochera para dos autos. Barrio tranquilo cerca de colegios.",
    locationId: "loc",
    street: "Los Ceibos",
    hasCoordinates: true,
    areas: { totalM2: 400, coveredM2: 180, landM2: 400 },
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    garages: 2,
    orientation: "Norte",
    featureCount: 6,
    operations: [{ operation: "sale", currency: "USD", amount: 250000, priceHidden: false }],
    hasLeadAgent: true,
    tourPublished: true,
    media: [
      img("a", { isCover: true, room: "fachada", metrics: { ...good, dhash: "0000000000000000" } }),
      img("b", { room: "living", metrics: { ...good, dhash: "ffffffffffffffff" } }),
      img("c", { room: "cocina", metrics: { ...good, dhash: "00000000ffffffff" } }),
      img("d", { room: "dormitorio", metrics: { ...good, dhash: "ffffffff00000000" } }),
      img("e", { room: "bano", metrics: { ...good, dhash: "0f0f0f0f0f0f0f0f" } }),
      { ...img("p"), kind: "floor_plan", room: null },
    ],
  });

describe("completitud ampliada", () => {
  it("los pesos suman 100", () => {
    expect(Object.values(QUALITY_CRITERIA).reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it("una ficha completa llega a 100 sin hallazgos que resten", () => {
    const r = buildQualityReport(complete(), { check: { status: "insufficient_sample", sample: 2, minSample: 8 }, operation: "venta", currency: "USD" });
    expect(r.completenessScore).toBe(100);
    expect(r.score).toBe(100);
    expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("una ficha vacía publicada marca faltantes con link a la sección exacta y errores en precio/ubicación/portada", () => {
    const r = buildQualityReport(snap(), { check: { status: "not_applicable", reason: "sin precio o superficie" }, operation: "", currency: "" });
    expect(r.completenessScore).toBe(0);
    const byCode = Object.fromEntries(r.findings.map((f) => [f.code, f]));
    expect(byCode.missing_price).toMatchObject({ severity: "error", href: `/crm/propiedades/${ID}#precios` });
    expect(byCode.missing_location).toMatchObject({ severity: "error", href: `/crm/propiedades/${ID}/editar#ubicacion` });
    expect(byCode.missing_description!.href).toBe(`/crm/propiedades/${ID}/editar#description`);
    expect(byCode.missing_tour!.href).toBe(`/crm/propiedades/${ID}/tour`);
    expect(byCode.missing_exterior!.href).toBe(`/crm/propiedades/${ID}#multimedia`);
    expect(r.findings[0]!.severity).toBe("error");
  });

  it("criterios que no aplican cuentan como cumplidos (terreno: sin dormitorios, baños, tour ni plano)", () => {
    const c = evaluateCriteria(snap({ category: "land", typeKey: "terreno", areas: { totalM2: null, coveredM2: null, landM2: 900 } }));
    const byKey = Object.fromEntries(c.map((x) => [x.key, x]));
    for (const k of ["bedrooms", "bathrooms", "tour", "floorPlan"]) expect(byKey[k]).toMatchObject({ ok: true, applies: false });
    expect(byKey.area).toMatchObject({ ok: true, applies: true });
    expect(byKey.orientation).toMatchObject({ ok: false, applies: true });
  });

  it("plano: cuenta un archivo de plano o una foto etiquetada «plano»", () => {
    const tagged = evaluateCriteria(snap({ media: [img("x", { room: "plano" })] })).find((c) => c.key === "floorPlan");
    expect(tagged!.ok).toBe(true);
  });

  it("links: sectionHref arma ficha, edición y editor del tour", () => {
    expect(sectionHref(ID, "agentes")).toBe(`/crm/propiedades/${ID}#agentes`);
    expect(sectionHref(ID, "edit:bedrooms")).toBe(`/crm/propiedades/${ID}/editar#bedrooms`);
  });
});

describe("inconsistencias", () => {
  it("dormitorios ≥ ambientes, cubierta > total y terreno < cubierta en casas", () => {
    const f = inconsistencies(snap({ rooms: 3, bedrooms: 4, areas: { totalM2: 100, coveredM2: 150, landM2: 120 } }));
    expect(f.map((x) => x.code)).toEqual(["bedrooms_vs_rooms", "covered_gt_total", "land_lt_covered"]);
    expect(f.find((x) => x.code === "land_lt_covered")!.detail).toMatch(/Puede ser correcto si tiene más de una planta/);
  });

  it("no marca terreno < cubierta si la casa tiene 2+ plantas ni en departamentos", () => {
    expect(inconsistencies(snap({ floors: 2, areas: { totalM2: null, coveredM2: 200, landM2: 150 } }))).toEqual([]);
    expect(inconsistencies(snap({ typeKey: "departamento", areas: { totalM2: null, coveredM2: 80, landM2: 10 } }))).toEqual([]);
  });

  it("valores faltantes o en cero no disparan inconsistencias", () => {
    expect(inconsistencies(snap({ rooms: 0, bedrooms: 2, areas: { totalM2: 0, coveredM2: 90, landM2: null } }))).toEqual([]);
  });

  it("las inconsistencias restan puntos con tope", () => {
    const base = complete();
    const r = buildQualityReport({ ...base, rooms: 2, bedrooms: 3, areas: { totalM2: 100, coveredM2: 180, landM2: 400 } }, { check: { status: "not_applicable", reason: "" }, operation: "venta", currency: "USD" });
    expect(r.completenessScore).toBe(100);
    expect(r.score).toBe(90);
  });
});

describe("precio fuera de rango", () => {
  const comps = (vals: number[]) => vals.map((pricePerM2) => ({ pricePerM2 }));

  it("sin muestra suficiente NO opina", () => {
    const c = priceCheck(100, comps([1000, 1100, 1200]), { minSample: 8, lowFactor: 0.5, highFactor: 2 });
    expect(c).toEqual({ status: "insufficient_sample", sample: 3, minSample: 8 });
    expect(priceFinding(snap(), c, { operation: "venta", currency: "USD" })).toBeNull();
  });

  it("con muestra suficiente detecta muy bajo / muy alto con lenguaje prudente", () => {
    const sample = comps([900, 950, 1000, 1000, 1050, 1100, 1150, 1200]);
    const low = priceCheck(300, sample, { minSample: 8, lowFactor: 0.5, highFactor: 2 });
    expect(low).toMatchObject({ status: "low", sample: 8, median: 1025 });
    const f = priceFinding(snap(), low, { operation: "venta", currency: "USD" })!;
    expect(f.detail).toMatch(/No es una tasación/);
    expect(f.detail).toContain("8 propiedades");
    expect(f.severity).toBe("info");
    expect(priceCheck(2600, sample, { minSample: 8, lowFactor: 0.5, highFactor: 2 }).status).toBe("high");
    expect(priceCheck(1300, sample, { minSample: 8, lowFactor: 0.5, highFactor: 2 }).status).toBe("in_range");
  });

  it("mediana par e impar", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("descripción", () => {
  it("vacía, breve, en mayúsculas y sin datos que sí están cargados", () => {
    expect(descriptionFindings(snap()).map((f) => f.code)).toEqual(["description_missing"]);
    const codes = descriptionFindings(snap({ description: "HERMOSA CASA EN VENTA EXCELENTE UBICACION LLAME YA MISMO", bedrooms: 3, bathrooms: 2, areas: { totalM2: null, coveredM2: 120, landM2: null } })).map((f) => f.code);
    expect(codes).toEqual(["description_short", "description_uppercase", "description_missing_facts"]);
  });

  it("no pide datos que no están cargados (nada inventado)", () => {
    const f = descriptionFindings(snap({ description: "x".repeat(250), bedrooms: null, bathrooms: null, garages: null }));
    expect(f.map((x) => x.code)).not.toContain("description_missing_facts");
  });
});

describe("fotos", () => {
  it("duplicadas, oscuras y borrosas solo en almacenadas; las externas se informan sin analizar", () => {
    const r = buildQualityReport(
      snap({
        media: [
          img("a", { isCover: true, sortOrder: 1, metrics: { ...good, dhash: "aaaaaaaaaaaaaaaa" } }),
          img("b", { sortOrder: 2, metrics: { ...good, dhash: "aaaaaaaaaaaaaaab" } }),
          img("c", { sortOrder: 3, metrics: { ...good, dhash: "0000000000000000", luminanceMean: 30, luminanceP95: 60 } }),
          img("d", { sortOrder: 4, metrics: { ...good, dhash: "ffffffffffffffff", laplacianVariance: 12, luminanceVariance: 2000 } }),
          img("x", { sortOrder: 5, stored: false, status: "source_only", metrics: null }),
        ],
      }),
      { check: { status: "not_applicable", reason: "" }, operation: "", currency: "" },
    );
    const byCode = Object.fromEntries(r.findings.map((f) => [f.code, f]));
    expect(byCode.photo_duplicate!.mediaIds).toEqual(["a", "b"]);
    expect(byCode.photo_dark!.mediaIds).toEqual(["c"]);
    expect(byCode.photo_blurry!.mediaIds).toEqual(["d"]);
    expect(byCode.photo_external_not_analyzed!.title).toBe("1 foto no analizada: foto externa");
    expect(r.mediaSummary).toEqual({ images: 5, stored: 4, analyzed: 4, external: 1, duplicates: 1, dark: 1, blurry: 1 });
    // Penalización: 1 duplicada (3) + 2 oscura/borrosa (4) = 7 sobre la completitud.
    expect(r.score).toBe(Math.max(0, r.completenessScore - 7));
  });
});
