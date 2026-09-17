/** Invalidación del cache de «Resumen de hoy» (tabla ai_daily_briefs): se marca `stale` y se recalcula al próximo pedido. */
import type { Executor } from "../../db";

export async function markBriefsStale(db: Executor, userIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(userIds.filter((u): u is string => typeof u === "string" && u.length > 0))];
  if (!ids.length) return;
  await db.updateTable("ai_daily_briefs").set({ stale: true }).where("user_id", "in", ids).where("stale", "=", false).execute();
}

/** Todos los resúmenes de la organización (p. ej. tras detectar anomalías de toda la empresa). */
export async function markOrganizationBriefsStale(db: Executor, organizationId: string): Promise<void> {
  await db.updateTable("ai_daily_briefs").set({ stale: true }).where("organization_id", "=", organizationId).where("stale", "=", false).execute();
}
