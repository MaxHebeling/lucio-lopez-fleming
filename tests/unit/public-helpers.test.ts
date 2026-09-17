import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filtersToQuery,
  parseSearchFilters,
  propertyHeadline,
  publicCoordinates,
  publicStreet,
  telHref,
  tidyTitle,
  titleAddsInfo,
  whatsappHref,
  formatArea,
  formatPrice,
} from "@/server/properties/public-helpers";
import { openingHours } from "@/components/site/JsonLd";

describe("filtros de búsqueda en la URL", () => {
  it("acepta valores válidos y descarta en silencio los inválidos", () => {
    const f = parseSearchFilters({
      operacion: "venta",
      tipo: "casa",
      zona: "villa-san-lorenzo",
      moneda: "USD",
      precio_min: "100.000",
      precio_max: "abc",
      dormitorios: "3",
      banos: "-1",
      credito: "1",
      caracteristicas: ["pileta,parrilla", "DROP TABLE", "pileta"],
      q: "  quincho  ",
      orden: "precio-desc",
      pagina: "9999",
    });
    expect(f).toMatchObject({ operacion: "venta", tipo: "casa", zona: "villa-san-lorenzo", moneda: "USD", precio_min: 100000, dormitorios: 3, credito: true, q: "quincho", orden: "precio-desc", pagina: 1 });
    expect(f.precio_max).toBeUndefined();
    expect(f.banos).toBeUndefined();
    expect(f.caracteristicas).toEqual(["pileta", "parrilla"]);
  });

  it("valores de operación u orden desconocidos no rompen", () => {
    const f = parseSearchFilters({ operacion: "permuta", orden: "random", tipo: "../etc" });
    expect(f.operacion).toBeUndefined();
    expect(f.orden).toBeUndefined();
    expect(f.tipo).toBeUndefined();
  });

  it("query string estable, sin vacíos ni claves fijadas por la ruta", () => {
    const f = parseSearchFilters({ tipo: "casa", operacion: "venta", pagina: "2", caracteristicas: "pileta" });
    expect(filtersToQuery(f, ["operacion"])).toBe("?tipo=casa&caracteristicas=pileta&pagina=2");
    expect(filtersToQuery({ ...f, pagina: 1, caracteristicas: [], tipo: undefined, operacion: undefined })).toBe("");
    expect(activeFilterCount(f, ["operacion"])).toBe(2);
  });
});

describe("privacidad de la dirección", () => {
  it("con dirección oculta nunca sale la altura", () => {
    expect(publicStreet("Mitre", "600", true)).toBe("Mitre");
    expect(publicStreet("Cordoba  Al 100", null, true)).toBe("Cordoba");
    expect(publicStreet("Av. Entre Ríos N° 639", null, true)).toBe("Av. Entre Ríos");
    expect(publicStreet("Ruta 51 km 5", null, true)).toBe("Ruta");
    expect(publicStreet("123", null, true)).toBeNull();
    expect(publicStreet("Sarmiento 447", null, true)).toBe("Sarmiento");
    expect(publicStreet("calle Las Heras 1241", "1241", true)).toBe("calle Las Heras");
    expect(publicStreet(null, "5", true)).toBeNull();
  });
  it("sin dirección oculta muestra calle y altura", () => {
    expect(publicStreet("Mitre", "600", false)).toBe("Mitre 600");
  });
  it("coordenadas redondeadas (~1 km) si la dirección está oculta", () => {
    expect(publicCoordinates("-24.782127", "-65.423195", true)).toEqual({ lat: -24.78, lng: -65.42, approximate: true });
    expect(publicCoordinates("-24.782127", "-65.423195", false)).toEqual({ lat: -24.782127, lng: -65.423195, approximate: false });
    expect(publicCoordinates(null, "-65.4", true)).toBeNull();
    expect(publicCoordinates("0", "0", false)).toBeNull();
  });
});

describe("textos y enlaces", () => {
  it("titulares consistentes y títulos cargados solo si aportan", () => {
    expect(propertyHeadline("Casa", "sale", "El Tipal")).toBe("Casa en venta en El Tipal");
    expect(propertyHeadline("Local", "rent", null)).toBe("Local en alquiler");
    expect(tidyTitle("CASA EN VENTA CAMPO QUIJANO")).toBe("Casa en venta Campo Quijano");
    expect(titleAddsInfo("casa en venta", "Casa")).toBe(false);
    expect(titleAddsInfo("Casa en Venta, El Tipal", "Casa")).toBe(true);
    expect(titleAddsInfo("Depto Dean Funes Premium", "Departamento")).toBe(true);
  });
  it("WhatsApp solo con E.164 válido y texto codificado", () => {
    expect(whatsappHref("+5493875775465", "Hola, Cód. 12 & más")).toBe("https://wa.me/5493875775465?text=Hola%2C%20C%C3%B3d.%2012%20%26%20m%C3%A1s");
    expect(whatsappHref("387 5775465", "x")).toBeNull();
    expect(whatsappHref(null, "x")).toBeNull();
    expect(telHref("+54 387 421-4143")).toBe("tel:+543874214143");
  });
  it("precio oculto → Consultar; superficies grandes en hectáreas", () => {
    expect(formatPrice(250000, "USD", false)).toBe("USD 250.000");
    expect(formatPrice(700000, "ARS", false)).toBe("$ 700.000");
    expect(formatPrice(250000, "USD", true)).toBe("Consultar");
    expect(formatArea(158)).toBe("158 m²");
    expect(formatArea(20000)).toBe("2 ha");
    expect(formatArea(0)).toBeNull();
  });
  it("horarios de sucursal → OpeningHoursSpecification (lo ambiguo se omite)", () => {
    expect(openingHours("Lunes a viernes de 9:00 a 13:00 · Sábados de 10:30 a 12:30")).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "13:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "10:30", closes: "12:30" },
    ]);
    expect(openingHours("16 a 19")).toBeUndefined();
  });
});
