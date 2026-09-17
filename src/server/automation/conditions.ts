/**
 * Condiciones declarativas de automatizaciones: [{ path, op, value }] combinadas con AND.
 * path navega el contexto { event: { type, payload, aggregateId } } con notación de puntos.
 */
import { z } from "zod";

export const conditionSchema = z.object({
  path: z.string().regex(/^[a-zA-Z0-9_.]+$/),
  op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte", "exists", "not_exists"]),
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function evaluateConditions(raw: unknown, context: unknown): boolean {
  const conditions = z.array(conditionSchema).parse(raw ?? []);
  return conditions.every((c) => evaluate(c, getPath(context, c.path)));
}

function evaluate(c: Condition, actual: unknown): boolean {
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(actual);
    case "gt":
      return typeof actual === "number" && typeof c.value === "number" && actual > c.value;
    case "gte":
      return typeof actual === "number" && typeof c.value === "number" && actual >= c.value;
    case "lt":
      return typeof actual === "number" && typeof c.value === "number" && actual < c.value;
    case "lte":
      return typeof actual === "number" && typeof c.value === "number" && actual <= c.value;
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
  }
}
