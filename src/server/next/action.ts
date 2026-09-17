/**
 * Envoltorio para Server Actions: valida con zod, resuelve actor, traduce errores a mensajes seguros
 * y loguea los inesperados. Next ya verifica Origin en Server Actions (protección CSRF).
 */
import "server-only";
import { z } from "zod";
import { AppError, toPublicError } from "../errors";
import { errorFields, log } from "../log";
import { assertPasswordChangeNotPending, type Actor } from "../auth/actor";
import { getActor } from "./context";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function zodFieldErrors(e: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of e.issues) {
    const k = issue.path.join(".") || "_";
    (out[k] ??= []).push(issue.message);
  }
  return out;
}

export async function runAction<S extends z.ZodType, T>(
  name: string,
  schema: S,
  input: unknown,
  fn: (data: z.infer<S>, actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  let actor: Actor | undefined;
  try {
    actor = await getActor();
    assertPasswordChangeNotPending(actor, name);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Revisá los datos marcados", fieldErrors: zodFieldErrors(parsed.error) };
    }
    return { ok: true, data: await fn(parsed.data, actor) };
  } catch (e) {
    const pub = toPublicError(e);
    if (!(e instanceof AppError)) {
      log.error("action.failed", { action: name, requestId: actor?.requestId, actorKind: actor?.kind, ...errorFields(e) });
    }
    return { ok: false, error: pub.message, fieldErrors: pub.details };
  }
}

/** FormData → objeto plano (campos repetidos → array). */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const value = typeof v === "string" ? v : v;
    if (k in out) {
      const cur = out[k];
      out[k] = Array.isArray(cur) ? [...cur, value] : [cur, value];
    } else out[k] = value;
  }
  return out;
}
