import { describe, expect, it, vi } from "vitest";
import { backoffMs, retry, RetryableError, withTimeout, TimeoutError, isRetryableStatus } from "@/server/resilience";
import { evaluateConditions, getPath } from "@/server/automation/conditions";
import { redact } from "@/server/log";
import { normalizeIp, clientIpFromHeaders } from "@/server/auth/ip";
import { AppError, toPublicError } from "@/server/errors";
import { passwordPolicyError } from "@/server/auth/password";
import { can, requirePermission, type StaffActor } from "@/server/auth/actor";

describe("resiliencia", () => {
  it("backoff crece exponencialmente con jitter acotado", () => {
    expect(backoffMs(0, 1000, 60_000, () => 0)).toBe(500);
    expect(backoffMs(0, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffMs(3, 1000, 60_000, () => 1)).toBe(8000);
    expect(backoffMs(20, 1000, 60_000, () => 1)).toBe(60_000);
  });

  it("retry reintenta errores reintentables y respeta el máximo", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new RetryableError("503")).mockResolvedValueOnce("ok");
    await expect(retry(fn, { attempts: 3, sleep: async () => {} })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    const always = vi.fn().mockRejectedValue(new RetryableError("503"));
    await expect(retry(always, { attempts: 3, sleep: async () => {} })).rejects.toThrow("503");
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("retry no reintenta errores permanentes", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("400 datos inválidos"));
    await expect(retry(fn, { attempts: 5, sleep: async () => {} })).rejects.toThrow("400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("withTimeout aborta y lanza TimeoutError", async () => {
    let aborted = false;
    await expect(
      withTimeout(20, (signal) => new Promise((resolve) => {
        signal.addEventListener("abort", () => { aborted = true; });
        setTimeout(resolve, 200);
      })),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it("clasifica estados HTTP reintentables", () => {
    expect([408, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 422].some(isRetryableStatus)).toBe(false);
  });
});

describe("condiciones de automatización", () => {
  const ctx = { event: { type: "lead.created", payload: { priority: "high", score: 7 } } };
  it("evalúa operadores", () => {
    expect(getPath(ctx, "event.payload.score")).toBe(7);
    expect(evaluateConditions([], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "event.payload.priority", op: "eq", value: "high" }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "event.payload.score", op: "gte", value: 8 }], ctx)).toBe(false);
    expect(evaluateConditions([{ path: "event.payload.priority", op: "in", value: ["urgent", "high"] }], ctx)).toBe(true);
    expect(evaluateConditions([{ path: "event.payload.missing", op: "not_exists" }], ctx)).toBe(true);
  });
  it("rechaza condiciones mal formadas", () => {
    expect(() => evaluateConditions([{ path: "x; drop", op: "eq" }], ctx)).toThrow();
  });
});

describe("logging", () => {
  it("redacta secretos, emails y teléfonos", () => {
    const out = redact({ password: "x", token: "y", nested: { authorization: "Bearer z" }, msg: "juan.perez@mail.com +54 387 4214143" }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).authorization).toBe("[redacted]");
    expect(String(out.msg)).not.toContain("perez@");
    expect(String(out.msg)).not.toContain("4214143");
  });
  it("no rompe UUIDs ni códigos al redactar teléfonos", () => {
    const id = "28a2409d-a30d-4060-9c0e-12345678abcd";
    expect(redact({ jobId: id })).toEqual({ jobId: id });
    expect(redact("request 2024-09-16-000123")).toBe("request 2024-09-16-000123");
  });
});

describe("IP", () => {
  it("normaliza y descarta basura", () => {
    expect(normalizeIp("1.2.3.4:5678")).toBe("1.2.3.4");
    expect(normalizeIp("[::1]:443")).toBe("::1");
    expect(normalizeIp("'; drop table users")).toBeNull();
    expect(clientIpFromHeaders((h) => (h === "x-forwarded-for" ? "basura, 10.0.0.1" : null))).toBe("10.0.0.1");
  });
});

describe("errores públicos", () => {
  it("nunca exponen SQL", () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), { code: "23505", constraint: "users_email_unique" });
    const pub = toPublicError(pg);
    expect(pub.status).toBe(409);
    expect(pub.message).not.toContain("users_email_unique");
    expect(toPublicError(new Error("select * from secrets")).message).not.toContain("select");
    expect(toPublicError(new AppError("forbidden", "No")).status).toBe(403);
  });
});

describe("contraseñas y permisos", () => {
  it("aplica política mínima", () => {
    expect(passwordPolicyError("corta1")).not.toBeNull();
    expect(passwordPolicyError("sololetrasmuylargas")).not.toBeNull();
    expect(passwordPolicyError("Letras-y-numeros-2026")).toBeNull();
  });
  it("RBAC: super_admin todo, el resto solo lo otorgado", () => {
    const base = { kind: "staff", organizationId: "o", userId: "u", email: "e", fullName: "f", branchIds: [] } as const;
    const agent: StaffActor = { ...base, roles: ["agente"], permissions: new Set(["leads.read_own"]) };
    const root: StaffActor = { ...base, roles: ["super_admin"], permissions: new Set() };
    expect(can(agent, "leads.read_own")).toBe(true);
    expect(can(agent, "roles.manage")).toBe(false);
    expect(can(root, "roles.manage")).toBe(true);
    expect(() => requirePermission(agent, "users.manage")).toThrow(AppError);
    expect(() => requirePermission({ kind: "anonymous", organizationId: "o" }, "leads.read_own")).toThrow(/Iniciá sesión/);
  });
});
