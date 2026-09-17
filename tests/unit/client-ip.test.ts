import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "@/server/auth/ip";

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("IP del cliente", () => {
  it("en Vercel usa x-vercel-forwarded-for / x-real-ip e ignora un X-Forwarded-For falsificado", () => {
    const env = { VERCEL: "1", APP_ENV: "production" };
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 200.1.1.1", "x-vercel-forwarded-for": "200.1.1.1", "x-real-ip": "200.1.1.1" }), env)).toBe("200.1.1.1");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "200.1.1.2" }), env)).toBe("200.1.1.2");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6" }), env)).toBeNull();
  });

  it("detrás de otro proxy toma la IP agregada por el último proxy confiable (TRUSTED_PROXY_HOPS)", () => {
    const xff = headers({ "x-forwarded-for": "6.6.6.6, 200.1.1.1, 10.0.0.5", "x-real-ip": "6.6.6.6" });
    expect(clientIpFromHeaders(xff, { APP_ENV: "production", TRUSTED_PROXY_HOPS: "1" })).toBe("10.0.0.5");
    expect(clientIpFromHeaders(xff, { APP_ENV: "production", TRUSTED_PROXY_HOPS: "2" })).toBe("200.1.1.1");
    // Más saltos que valores: no se adivina
    expect(clientIpFromHeaders(xff, { APP_ENV: "production", TRUSTED_PROXY_HOPS: "5" })).toBeNull();
    // 0 = sin proxy: ninguna cabecera es confiable
    expect(clientIpFromHeaders(xff, { APP_ENV: "production", TRUSTED_PROXY_HOPS: "0" })).toBeNull();
  });

  it("en producción fuera de Vercel sin configurar no confía en cabeceras del cliente", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6" }), { APP_ENV: "production" })).toBeNull();
  });

  it("en desarrollo sin configurar usa el primer valor válido (comportamiento local)", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "basura, 10.0.0.1" }), { APP_ENV: "development" })).toBe("10.0.0.1");
  });
});
