import type { z } from "zod";
import { invalid } from "./errors";

/** Valida la entrada de un servicio; si falla lanza AppError de validación con errores por campo (mensaje seguro). */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const details: Record<string, string[]> = {};
  for (const issue of r.error.issues) (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
  throw invalid("Revisá los datos marcados", details);
}
