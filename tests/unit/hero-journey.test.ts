import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_JOURNEY, PROPERTY_JOURNEY, journeySourceUrls, pickJourney, type Journey } from "@/components/experience/hero/hero-journey";

const ROOT = resolve(import.meta.dirname, "../..");
const available = { code: 2605, slug: "casa-venta-salta-2605", bedrooms: 5, bathrooms: 4, coveredAreaM2: 500 };

function checkIntegrity(journey: Journey) {
  const ids = journey.scenes.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  // La portada ofrece la abertura por la que se entra a la primera escena.
  expect(journey.cover.aperture.w).toBeGreaterThan(0);
  journey.scenes.forEach((scene, i) => {
    expect(scene.title.trim().length).toBeGreaterThan(0);
    expect(scene.media.length).toBeGreaterThan(0);
    for (const m of scene.media) {
      // Foto local real (el recorrido no depende de un CDN externo en runtime) y alt descriptivo.
      expect(m.src.startsWith("/brand/")).toBe(true);
      expect(existsSync(resolve(ROOT, "public", `.${m.src}`))).toBe(true);
      expect(m.alt.length).toBeGreaterThan(20);
      if (m.aperture) for (const n of [m.aperture.x, m.aperture.y, m.aperture.w, m.aperture.h]) expect(n).toBeGreaterThanOrEqual(0);
      if (m.aperture) expect(m.aperture.x + m.aperture.w).toBeLessThanOrEqual(1);
    }
    // `through` necesita una abertura en la foto anterior (o en la portada).
    if (scene.transition === "through" && i > 0) expect(journey.scenes[i - 1]!.media.at(-1)!.aperture).toBeDefined();
    if (scene.levels) expect(scene.levels).toHaveLength(scene.media.length);
  });
  expect(journey.scenes.at(-1)!.frame).toBe("close");
  const mobile = journey.scenes.filter((s) => s.mobile).length;
  const stable = journey.scenes.filter((s) => s.static).length;
  expect(mobile).toBeGreaterThanOrEqual(3);
  expect(mobile + 1).toBeLessThanOrEqual(5); // + portada
  expect(stable).toBeGreaterThanOrEqual(3);
  expect(stable).toBeLessThanOrEqual(4);
}

describe("recorrido de la portada: configuración", () => {
  it("recorrido de la propiedad: escenas íntegras, fotos locales con alt y abertura, origen verificable en la publicación", () => {
    checkIntegrity(PROPERTY_JOURNEY);
    expect(PROPERTY_JOURNEY.scenes.length + 1).toBeLessThanOrEqual(7);
    const urls = journeySourceUrls(PROPERTY_JOURNEY);
    // Cada foto de la propiedad se cruza con su URL de origen: si la sacan de la publicación, el recorrido no se usa.
    expect(urls).toHaveLength(PROPERTY_JOURNEY.scenes.reduce((n, s) => n + s.media.length, 0));
    expect(urls.every((u) => u.startsWith("https://static1.adinco.net/"))).toBe(true);
  });

  it("recorrido de respaldo: solo fotos de marca, sin propiedad", () => {
    checkIntegrity(BRAND_JOURNEY);
    expect(BRAND_JOURNEY.propertyCode).toBeNull();
    expect(journeySourceUrls(BRAND_JOURNEY)).toEqual([]);
    expect(BRAND_JOURNEY.scenes.every((s) => s.media.every((m) => m.src.startsWith("/brand/photos/")))).toBe(true);
  });

  it("pickJourney: propiedad disponible → su recorrido con ficha real y datos registrados", () => {
    const r = pickJourney(available);
    expect(r.journey.kind).toBe("property");
    expect(r.property?.href).toBe("/propiedades/casa-venta-salta-2605");
    expect(r.property?.specs).toEqual(["5 dormitorios", "4 baños", "500 m² cubiertos"]);
  });

  it("pickJourney: sin propiedad (despublicada, no disponible o sin fotos) o con otro código → respaldo de marca sin link", () => {
    expect(pickJourney(null)).toEqual({ journey: BRAND_JOURNEY, property: null });
    expect(pickJourney({ ...available, code: 9999 })).toEqual({ journey: BRAND_JOURNEY, property: null });
  });

  it("pickJourney: datos faltantes no se inventan", () => {
    const r = pickJourney({ ...available, bedrooms: null, bathrooms: 1, coveredAreaM2: null });
    expect(r.property?.specs).toEqual(["1 baño"]);
  });
});
