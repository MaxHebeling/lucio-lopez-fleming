import { describe, expect, it } from "vitest";
import { signUploadToken, verifyUploadToken } from "@/server/storage/direct-upload";

process.env.UPLOAD_SIGNING_SECRET = "secreto-de-prueba-de-al-menos-32-caracteres-ok";
const base = { k: "uploads/tmp/property-media/abc.jpg", u: "user-1", e: "prop-1", p: "property-media", exp: Date.now() + 60_000 };
const expect1 = { userId: "user-1", entity: "prop-1", purpose: "property-media" };

describe("tokens de subida directa", () => {
  it("valida token propio", () => {
    expect(verifyUploadToken(signUploadToken(base), expect1).k).toBe(base.k);
  });
  it("rechaza token de otro usuario, otra propiedad, vencido, manipulado o con clave fuera del prefijo", () => {
    const t = signUploadToken(base);
    expect(() => verifyUploadToken(t, { ...expect1, userId: "otro" })).toThrow();
    expect(() => verifyUploadToken(t, { ...expect1, entity: "prop-2" })).toThrow();
    expect(() => verifyUploadToken(signUploadToken({ ...base, exp: Date.now() - 1 }), expect1)).toThrow(/venció/);
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, u: "atacante" })).toString("base64url");
    expect(() => verifyUploadToken(`${forged}.${mac}`, expect1)).toThrow();
    expect(() => verifyUploadToken(`${body}.x${mac}`, expect1)).toThrow();
    expect(() => verifyUploadToken(signUploadToken({ ...base, k: "files/secretos/contrato.pdf" }), expect1)).toThrow();
  });
});
