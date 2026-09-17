/**
 * Activación segura de las reacciones de IA (docs/ai/AUTOMATION.md › Despliegue seguro).
 *
 * La migración 0531 crea las definiciones `ai_reaction_*` DESACTIVADAS: si se aplica antes de que llegue el código,
 * el motor anterior no las despacha (no hay jobs muertos por acciones inexistentes). Esta función, que solo existe en
 * la versión nueva, las activa cuando (1) el flag `ai_automations` está encendido y (2) todas sus acciones están
 * registradas en ESTE proceso; si no, las desactiva. Corre cada 5 minutos (`ai.reactions_sync`) y al cambiar el flag.
 * Las reacciones se controlan con el flag, no con el botón de la pantalla de Automatizaciones.
 */
import "server-only";
import type { Database } from "../../db";
import { audit } from "../../audit";
import type { Actor } from "../../auth/actor";
import { getAction } from "../../automation/actions";
import { isEnabled } from "../../flags";
import { log } from "../../log";
import { AI_AUTOMATIONS_FLAG } from "./reactions";

export const AI_REACTION_PREFIX = "ai_reaction_";

export function isAiReactionKey(key: string): boolean {
  return key.startsWith(AI_REACTION_PREFIX);
}

/** Estado deseado de una reacción (puro): flag encendido y todas las acciones disponibles en esta versión. */
export function desiredReactionState(flagOn: boolean, actionTypes: string[], registered: (t: string) => boolean): boolean {
  return flagOn && actionTypes.length > 0 && actionTypes.every(registered);
}

export async function syncAiReactions(db: Database, actor: Actor): Promise<{ enabled: string[]; disabled: string[] }> {
  const flagOn = await isEnabled(db, AI_AUTOMATIONS_FLAG);
  const defs = await db.selectFrom("automation_definitions").select(["id", "key", "is_enabled", "actions"]).where("key", "like", `${AI_REACTION_PREFIX}%`).execute();
  const out = { enabled: [] as string[], disabled: [] as string[] };
  for (const d of defs) {
    const types = Array.isArray(d.actions) ? (d.actions as Array<{ type?: unknown }>).map((a) => String(a.type)) : [];
    const want = desiredReactionState(flagOn, types, (t) => Boolean(getAction(t)));
    if (d.is_enabled === want) continue;
    await db.transaction().execute(async (trx) => {
      const r = await trx.updateTable("automation_definitions").set({ is_enabled: want }).where("id", "=", d.id).where("is_enabled", "=", d.is_enabled).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) return;
      await audit(trx, actor, {
        action: want ? "AUTOMATION_ENABLED" : "AUTOMATION_DISABLED",
        entityType: "automation",
        entityId: d.id,
        before: { is_enabled: d.is_enabled },
        after: { is_enabled: want },
        metadata: { key: d.key, reason: flagOn ? (want ? "flag ai_automations encendido" : "acción no disponible en esta versión") : "flag ai_automations apagado" },
      });
    });
    (want ? out.enabled : out.disabled).push(d.key);
  }
  if (out.enabled.length || out.disabled.length) log.info("ai.reactions_synced", out);
  return out;
}
