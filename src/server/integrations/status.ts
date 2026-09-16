import type { Executor } from "../db";

/**
 * Refleja en `integrations.status` si la integración tiene configuración completa.
 * - sin configuración → awaiting_credentials (visible en el panel), con el motivo.
 * - con configuración y todavía en awaiting_credentials → active (degraded/error los maneja callIntegration).
 * Nunca pisa `disabled` (apagado a mano).
 */
export async function reflectIntegrationConfig(db: Executor, key: string, configured: boolean, reason?: string): Promise<void> {
  if (!configured) {
    await db
      .updateTable("integrations")
      .set({ status: "awaiting_credentials", last_error: reason?.slice(0, 1000) ?? null, updated_at: new Date() })
      .where("key", "=", key)
      .where("status", "not in", ["disabled", "awaiting_credentials"])
      .execute();
    await db
      .updateTable("integrations")
      .set({ last_error: reason?.slice(0, 1000) ?? null, updated_at: new Date() })
      .where("key", "=", key)
      .where("status", "=", "awaiting_credentials")
      .where((eb) => eb.or([eb("last_error", "is", null), eb("last_error", "<>", reason ?? "")]))
      .execute();
    return;
  }
  await db
    .updateTable("integrations")
    .set({ status: "active", last_error: null, updated_at: new Date() })
    .where("key", "=", key)
    .where("status", "=", "awaiting_credentials")
    .execute();
}
