import { afterEach, describe, expect, it, vi } from "vitest";
import { PermanentIntegrationError, requestJson, setFetchForTests } from "@/server/integrations/http";
import { RetryableError, UncertainOutcomeError } from "@/server/resilience";

afterEach(() => setFetchForTests(undefined));

const hanging = () =>
  vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));

describe("requestJson: escrituras no idempotentes", () => {
  it("timeout → UncertainOutcomeError con un solo intento", async () => {
    const f = hanging();
    setFetchForTests(f);
    await expect(requestJson("https://api.example.test/items", { method: "POST", label: "X", nonIdempotent: true, timeoutMs: 30, attempts: 3 })).rejects.toBeInstanceOf(UncertainOutcomeError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("5xx → incierto (no se reintenta); 429 → reintentable (el proveedor no la procesó); 4xx → permanente", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 502 }));
    setFetchForTests(f);
    await expect(requestJson("https://api.example.test/items", { method: "POST", label: "X", nonIdempotent: true })).rejects.toBeInstanceOf(UncertainOutcomeError);
    expect(f).toHaveBeenCalledTimes(1);
    setFetchForTests(async () => new Response("{}", { status: 429 }));
    await expect(requestJson("https://api.example.test/items", { method: "POST", label: "X", nonIdempotent: true })).rejects.toBeInstanceOf(RetryableError);
    setFetchForTests(async () => new Response(JSON.stringify({ message: "bad" }), { status: 400 }));
    await expect(requestJson("https://api.example.test/items", { method: "POST", label: "X", nonIdempotent: true })).rejects.toBeInstanceOf(PermanentIntegrationError);
  });

  it("corte tras enviar → incierto; sin conexión (DNS) → reintentable", async () => {
    setFetchForTests(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
    });
    await expect(requestJson("https://api.example.test/items", { method: "POST", label: "X", nonIdempotent: true })).rejects.toBeInstanceOf(UncertainOutcomeError);
    setFetchForTests(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
    });
    await expect(requestJson("https://api.example.test/items", { method: "POST", label: "X", nonIdempotent: true })).rejects.toBeInstanceOf(RetryableError);
  });

  it("lecturas idempotentes siguen reintentándose", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 503 }));
    setFetchForTests(f);
    await expect(requestJson("https://api.example.test/items/1", { label: "X", attempts: 2 })).rejects.toBeInstanceOf(RetryableError);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
