import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, phoneMatchKey, cleanName } from "@/server/contacts/normalize";
import { slugify, validateAttributes, STATUS_TRANSITIONS } from "@/server/properties/schema";

describe("normalización de teléfonos (AR)", () => {
  it.each([
    ["+54 9 387 577-5468", "+5493875775468", true],
    ["3875775468", "+543875775468", false],
    ["0387 15 5775468", "+5493875775468", true],
    ["(0387) 421-4143", "+543874214143", false],
    ["543875775468", "+543875775468", false],
    ["4214143", "+543874214143", false],
    ["+1 (619) 555-0100", "+16195550100", false],
  ])("%s → %s", (raw, e164, mobile) => {
    expect(normalizePhone(raw, { defaultAreaCode: "387" })).toEqual({ e164, mobile });
  });
  it("assumeMobile (WhatsApp) agrega el 9", () => {
    expect(normalizePhone("3875775468", { assumeMobile: true })?.e164).toBe("+5493875775468");
  });
  it("rechaza basura", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  it("la clave de comparación ignora el 9 de celular", () => {
    expect(phoneMatchKey("+5493875775468")).toBe(phoneMatchKey("+543875775468"));
  });
});

describe("emails y nombres", () => {
  it("normaliza email", () => {
    expect(normalizeEmail("  Juan.Perez@Gmail.COM ")).toBe("juan.perez@gmail.com");
    expect(normalizeEmail("no-es-email")).toBeNull();
  });
  it("limpia nombres de caracteres de control y etiquetas", () => {
    expect(cleanName("  <b>Ana</b>   López ")).toBe("bAna/b López");
    expect(cleanName("   ")).toBeNull();
  });
});

describe("propiedades (reglas puras)", () => {
  it("slug sin acentos ni símbolos", () => {
    expect(slugify("Casa en Venta — San Lorenzo, Salta!")).toBe("casa-en-venta-san-lorenzo-salta");
  });
  it("valida atributos contra el esquema del tipo y descarta claves desconocidas", () => {
    const r = validateAttributes(
      [
        { key: "frontage_m", label: "Frente", type: "number" },
        { key: "bays", label: "Naves", type: "integer" },
        { key: "truck_access", label: "Acceso", type: "boolean" },
      ],
      { frontage_m: "12.5", bays: "2.5", truck_access: "on", hack: "x" },
    );
    expect(r.value).toEqual({ frontage_m: 12.5, truck_access: true });
    expect(r.errors["attributes.bays"]).toBeDefined();
  });
  it("una propiedad vendida no puede pasar directo a reservada", () => {
    expect(STATUS_TRANSITIONS.sold).not.toContain("reserved");
    expect(STATUS_TRANSITIONS.draft).not.toContain("sold");
  });
});
