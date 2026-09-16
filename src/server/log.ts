/**
 * Logger estructurado (JSON por línea) con redacción de secretos y PII.
 * En Vercel cada línea queda indexada en Runtime Logs; con SENTRY_DSN los errores además se reportan.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|api[_-]?key|signature|dni|document_number|card|phone|whatsapp|e164/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE = /(?<![\w-])\+?\d[\d\s]{7,}\d(?![\w-])/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value == null) return value;
  if (typeof value === "string") {
    const s = value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    return s.replace(EMAIL, "$1***@$2").replace(PHONE, (m) => `${m.slice(0, 3)}***${m.slice(-2)}`);
  }
  if (typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

const minLevel: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, msg: string, fields?: Fields) {
  const threshold = (process.env.LOG_LEVEL as Level | undefined) ?? (process.env.NODE_ENV === "test" ? "warn" : "info");
  if (minLevel[level] < minLevel[threshold]) return;
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    env: process.env.APP_ENV ?? process.env.NODE_ENV,
    ...(fields ? (redact(fields) as Fields) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  debug: (msg: string, f?: Fields) => emit("debug", msg, f),
  info: (msg: string, f?: Fields) => emit("info", msg, f),
  warn: (msg: string, f?: Fields) => emit("warn", msg, f),
  error: (msg: string, f?: Fields) => emit("error", msg, f),
};

export function errorFields(e: unknown): Fields {
  const err = e as { name?: string; message?: string; code?: string; stack?: string };
  return {
    error: err?.message ?? String(e),
    errorName: err?.name,
    errorCode: err?.code,
    stack: process.env.NODE_ENV === "production" ? undefined : err?.stack?.split("\n").slice(0, 6).join("\n"),
  };
}
