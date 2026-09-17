/**
 * Estado de credenciales de una integración en la tabla `integrations`.
 * Los secretos viven solo en variables de entorno: acá se registra si están o no, nunca su valor.
 */
import { sql, type Executor } from "../db";
import { log } from "../log";

/**
 * Sin credenciales → `awaiting_credentials` (salvo que alguien la haya desactivado a mano).
 * Con credenciales y el estado todavía en `awaiting_credentials` → no se marca activa hasta una llamada exitosa
 * (ver `markIntegrationActive`): tener la variable no prueba que funcione.
 */
export async function markAwaitingCredentials(db: Executor, key: string, missing: string[]): Promise<void> {
  const r = await sql`
    update integrations set status = 'awaiting_credentials', updated_at = now(),
      last_error = ${`Faltan variables de entorno: ${missing.join(", ")}`}
    where key = ${key} and status not in ('awaiting_credentials', 'disabled')`.execute(db);
  if (Number(r.numAffectedRows ?? 0) > 0) log.warn("integration.awaiting_credentials", { integration: key, missing });
}

/** Tras una llamada real exitosa: pasa de `awaiting_credentials` a `active` (callIntegration ya cubre degraded/error). */
export async function markIntegrationActive(db: Executor, key: string): Promise<void> {
  await sql`
    update integrations set status = 'active', last_error = null, updated_at = now()
    where key = ${key} and status = 'awaiting_credentials'`.execute(db);
}

export function missingEnv(names: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return names.filter((n) => !env[n] || !String(env[n]).trim());
}
