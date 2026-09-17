import { describe, expect, it } from "vitest";
import { addressLeakInText } from "@/server/properties/address-leak";

const base = { street: "Las Heras", title: "Casa en venta", description: null as string | null };

describe("dirección oculta mencionada en título o descripción", () => {
  it("detecta la calle con altura (caso real: código 1893)", () => {
    expect(addressLeakInText({ ...base, title: "calle Las Heras 1241" })).toBe("las heras 1241");
    expect(addressLeakInText({ ...base, description: "Excelente ubicación sobre LAS HERAS N° 1241, a metros del parque" })).toMatch(/las heras n° 1241/);
    // Altura embebida en la calle importada
    expect(addressLeakInText({ street: "Sarmiento 447", title: "Depto en Sarmiento al 400", description: null })).toMatch(/sarmiento al 400/);
    // Otra calle con altura escrita en el texto
    expect(addressLeakInText({ ...base, description: "Ingreso por calle Caseros 468" })).toMatch(/caseros 468/);
  });

  it("no marca menciones sin altura, medidas ni textos genéricos", () => {
    expect(addressLeakInText({ ...base, title: "Casa sobre Las Heras, 3 dormitorios" })).toBeNull();
    expect(addressLeakInText({ ...base, description: "Sobre Las Heras 250 m2 de terreno, a 300 metros de avenida Bolivia" })).toBeNull();
    expect(addressLeakInText({ ...base, description: "Avenida principal a 200 metros" })).toBeNull();
    expect(addressLeakInText({ street: null, title: "Casa en Tres Cerritos", description: null })).toBeNull();
  });
});
