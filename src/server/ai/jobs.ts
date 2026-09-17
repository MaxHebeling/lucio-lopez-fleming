/**
 * Jobs del AI Core (se registran al importarse desde src/server/jobs/handlers.ts):
 *  - ai.knowledge_ingest (diario): re-ingesta idempotente de knowledge/*.md (lo que cambió con un deploy).
 *  - ai.housekeeping (diario): purga de sesiones del copiloto vencidas.
 * Ninguno llama a un modelo ni reacciona a eventos.
 */
import { log } from "../log";
import { addScheduledTask } from "../jobs/scheduled";
import { registerJobHandler } from "../jobs/registry";
import { purgeExpiredConversations } from "./core/memory";
import { ingestKnowledge } from "./knowledge/ingest";

registerJobHandler("ai.knowledge_ingest", async (_payload, { db }) => {
  const stats = await ingestKnowledge(db);
  log.info("ai.knowledge_ingested", stats);
  return stats;
});

registerJobHandler("ai.housekeeping", async (_payload, { db }) => ({ conversationsPurged: await purgeExpiredConversations(db) }));

addScheduledTask({ type: "ai.knowledge_ingest", every: "daily", timeoutMs: 60_000 });
addScheduledTask({ type: "ai.housekeeping", every: "daily" });
