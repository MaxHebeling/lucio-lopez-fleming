import { afterEach, describe, expect, it, vi } from "vitest";
import { fitTitle, headlineDetail, propertyHeadline, propertyPageTitle, truncateAtWord, withBrand } from "@/server/properties/public-helpers";
import { clientLeadErrors } from "@/components/site/lead-form-validation";
import { crmImageSource } from "@/server/media/crm-preview";
import { revalidatePublicSite } from "@/server/site/revalidate";

describe("titulares con diferencial real", () => {
  it("dormitorios, ambientes o superficie con su tipo; nada si no hay datos", () => {
    expect(headlineDetail({ category: "residential", bedrooms: 3, coveredAreaM2: "150" })).toBe("de 3 dormitorios");
    expect(headlineDetail({ category: "residential", bedrooms: 1 })).toBe("de 1 dormitorio");
    expect(headlineDetail({ category: "residential", rooms: 2 })).toBe("de 2 ambientes");
    expect(headlineDetail({ category: "commercial", coveredAreaM2: "84.00" })).toBe("de 84 m² cubiertos");
    expect(headlineDetail({ category: "land", landAreaM2: null, totalAreaM2: "25000" })).toBe("de 2,5 ha");
    expect(headlineDetail({ category: "residential", landAreaM2: "800" })).toBe("con terreno de 800 m²");
    expect(headlineDetail({ category: "commercial" })).toBeNull();
    expect(propertyHeadline("Casa", "sale", "Tres Cerritos", "de 3 dormitorios")).toBe("Casa de 3 dormitorios en venta en Tres Cerritos");
  });
});

describe("títulos ≤ 60 caracteres sin cortar palabras", () => {
  it("recorta por palabra y saca conectores colgando", () => {
    expect(truncateAtWord("Departamento de 2 ambientes en alquiler temporario en Chacras de Santa María", 60)).toBe("Departamento de 2 ambientes en alquiler temporario");
    expect(truncateAtWord("corto", 60)).toBe("corto");
  });
  it("elige el primer candidato que entra y la marca solo si cabe", () => {
    expect(fitTitle(["x".repeat(61), "entra"])).toBe("entra");
    expect(withBrand("Contacto")).toBe("Contacto · Lucio López Fleming");
    expect(withBrand("Casas en venta en Villa San Lorenzo · Página 2")).toBe("Casas en venta en Villa San Lorenzo · Página 2");
  });
  it("ficha: con código siempre que se pueda; nunca > 60 ni palabras cortadas", () => {
    const t1 = propertyPageTitle({ headline: "Casa de 3 dormitorios en venta en Tres Cerritos", shortHeadline: "Casa en venta en Tres Cerritos", code: 1883 });
    expect(t1).toBe("Casa de 3 dormitorios en venta en Tres Cerritos · Cód. 1883");
    const t2 = propertyPageTitle({ headline: "Galpón de 1.200 m² cubiertos en alquiler en San Lorenzo Chico", shortHeadline: "Galpón en alquiler en San Lorenzo Chico", code: 2310 });
    expect(t2).toBe("Galpón en alquiler en San Lorenzo Chico · Cód. 2310");
    expect(propertyPageTitle({ headline: "Casa en venta en Salta", shortHeadline: "Casa en venta en Salta", code: 1, seoTitle: "Casa con vista al cerro" })).toBe("Casa con vista al cerro · Lucio López Fleming");
    for (const t of [t1, t2]) expect(t.length).toBeLessThanOrEqual(60);
  });
});

describe("formulario público: validación en el navegador", () => {
  it("pide teléfono o email antes de enviar", () => {
    const fd = new FormData();
    fd.set("name", "Ana");
    expect(clientLeadErrors(fd)).toEqual({ phone: ["Dejanos un teléfono o un email para responderte"] });
    fd.set("email", "ana@prueba.test");
    expect(clientLeadErrors(fd)).toBeNull();
  });
});

describe("miniaturas del CRM", () => {
  it("optimiza lo que el optimizador puede leer; privados y hosts desconocidos van directo", () => {
    expect(crmImageSource({ file_id: null, source_url: "https://static1.adinco.net/1/a.jpg" })).toEqual({ src: "https://static1.adinco.net/1/a.jpg", optimize: true });
    expect(crmImageSource({ file_id: null, source_url: "https://otro.example.com/a.jpg" })).toEqual({ src: "https://otro.example.com/a.jpg", optimize: false });
    expect(crmImageSource({ file_id: "f1", source_url: null, file_storage_driver: "local", file_visibility: "public" })).toEqual({ src: "/api/files/f1", optimize: true });
    expect(crmImageSource({ file_id: "f2", source_url: null, file_storage_driver: "local", file_visibility: "private" })).toEqual({ src: "/api/files/f2", optimize: false });
    expect(crmImageSource({ file_id: null, source_url: null })).toBeNull();
  });
});

describe("invalidación del sitio fuera de una petición de Next", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("sin contexto de petición la pide por HTTP con CRON_SECRET; sin configuración no lanza", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_URL", "http://sitio.test/");
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    await expect(revalidatePublicSite("prueba")).resolves.toEqual({ via: "http" });
    expect(fetchMock).toHaveBeenCalledWith("http://sitio.test/api/site/revalidate", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: `Bearer ${"s".repeat(40)}` }) }));
    vi.stubEnv("CRON_SECRET", "");
    await expect(revalidatePublicSite("prueba")).resolves.toEqual({ via: "none" });
  });
});
