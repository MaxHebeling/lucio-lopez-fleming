import { z } from "zod";
import { parseInput } from "../validate";
import { type Database } from "../db";
import { changePassword } from "../auth/session";
import { requireStaff, type Actor } from "../auth/actor";
import { invalid } from "../errors";

export const changeOwnPasswordSchema = z
  .object({
    current: z.string().min(1, "Ingresá tu contraseña actual").max(200),
    password: z.string().min(1, "Ingresá la contraseña nueva").max(200),
    confirm: z.string().max(200),
  })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden", path: ["confirm"] });

/** Cambio de contraseña propio: mantiene la sesión actual y revoca las demás. */
export async function changeOwnPassword(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requireStaff(actor);
  const input = parseInput(changeOwnPasswordSchema, raw);
  const r = await changePassword(db, actor.userId, input.current, input.password, actor.sessionId);
  if (!r.ok) {
    const field = r.reason.includes("actual no es correcta") ? "current" : "password";
    throw invalid(r.reason, { [field]: [r.reason] });
  }
}
