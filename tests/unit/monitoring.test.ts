import { describe, expect, it } from "vitest";
import { buildEnvelope, parseDsn } from "@/server/monitoring/sentry";

describe("sentry por envelopes", () => {
  it("parsea DSN válidos y rechaza basura", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/4501")).toEqual({ endpoint: "https://o1.ingest.sentry.io/api/4501/envelope/", publicKey: "abc123", projectId: "4501" });
    expect(parseDsn("no-es-url")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });
  it("arma un envelope de 3 líneas con el mensaje redactado", () => {
    const dsn = parseDsn("https://abc123@o1.ingest.sentry.io/4501")!;
    const lines = buildEnvelope(dsn, { message: "falló el envío a juan@mail.com", stack: "Error: x\n    at fn (/app/a.ts:10:5)", extra: { token: "secreto" } }).split("\n");
    expect(lines).toHaveLength(3);
    const event = JSON.parse(lines[2]!);
    expect(event.exception.values[0].value).not.toContain("juan@mail.com");
    expect(event.extra.token).toBe("[redacted]");
    expect(event.exception.values[0].stacktrace.frames[0]).toMatchObject({ filename: "/app/a.ts", lineno: 10 });
  });
});
