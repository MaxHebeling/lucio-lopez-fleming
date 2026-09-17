/**
 * Reporte de errores a Sentry por su API de envelopes (sin SDK: cero peso en el bundle del cliente).
 * Solo servidor. Si SENTRY_DSN no está configurado no hace nada. Nunca lanza: el monitoreo no puede romper la app.
 */
import { randomUUID } from "node:crypto";
import { redact } from "../log";

export type ParsedDsn = { endpoint: string; publicKey: string; projectId: string };

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !/^\d+$/.test(projectId)) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, publicKey: u.username, projectId };
  } catch {
    return null;
  }
}

export function buildEnvelope(
  dsn: ParsedDsn,
  e: { message: string; name?: string; stack?: string; level?: "error" | "warning"; tags?: Record<string, string>; extra?: Record<string, unknown> },
  now = new Date(),
): string {
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: now.toISOString(),
    platform: "node",
    level: e.level ?? "error",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    server_name: "llf-platform",
    tags: e.tags,
    extra: redact(e.extra ?? {}),
    exception: { values: [{ type: e.name ?? "Error", value: String(redact(e.message)), stacktrace: e.stack ? { frames: parseStack(e.stack) } : undefined }] },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn: `https://${dsn.publicKey}@x/${dsn.projectId}` }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

function parseStack(stack: string) {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((line) => {
      const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      return m ? { function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : { function: line.trim() };
    })
    .reverse();
}

export async function captureError(error: unknown, context: { tags?: Record<string, string>; extra?: Record<string, unknown> } = {}): Promise<void> {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    await fetch(dsn.endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=llf/1.0` },
      body: buildEnvelope(dsn, { message: err.message, name: err.name, stack: err.stack, ...context }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (e) {
    console.error(JSON.stringify({ level: "warn", msg: "monitoring.sentry_unreachable", error: (e as Error).message }));
  }
}
