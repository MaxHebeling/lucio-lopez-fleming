/**
 * Errores de dominio. El mensaje de AppError es seguro para mostrar al usuario;
 * cualquier otro error se traduce a un mensaje genérico (nunca SQL, stack ni rutas).
 */
import { pgCode } from "./db";

export type ErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

const HTTP: Record<ErrorCode, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, string[]>;
  constructor(code: ErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return HTTP[this.code];
  }
}

export const notFound = (what = "Registro") => new AppError("not_found", `${what} no encontrado`);
export const forbidden = (msg = "No tenés permiso para esta acción") => new AppError("forbidden", msg);
export const conflict = (msg: string) => new AppError("conflict", msg);
export const invalid = (msg: string, details?: Record<string, string[]>) => new AppError("validation", msg, details);

export type PublicError = { code: ErrorCode; message: string; details?: Record<string, string[]>; status: number };

export function toPublicError(e: unknown): PublicError {
  if (e instanceof AppError) return { code: e.code, message: e.message, details: e.details, status: e.status };
  switch (pgCode(e)) {
    case "23505":
      return { code: "conflict", message: "Ya existe un registro con esos datos", status: 409 };
    case "23503":
      return { code: "conflict", message: "Referencia inválida o registro en uso", status: 409 };
    case "23514":
    case "23502":
      return { code: "validation", message: "Algún dato está fuera de lo permitido", status: 400 };
    case "23P01":
      return { code: "conflict", message: "Se superpone con otro registro activo", status: 409 };
    case "P0001":
      return { code: "conflict", message: (e as Error).message, status: 409 };
    case "57014":
      return { code: "unavailable", message: "La operación tardó demasiado. Probá de nuevo.", status: 503 };
    default:
      return { code: "internal", message: "Ocurrió un error inesperado. Ya quedó registrado.", status: 500 };
  }
}
