/**
 * Jobs y reacciones de las Fases 5 y 6 (registrados desde src/server/jobs/handlers.ts). Todos idempotentes.
 *
 * | Job | Frecuencia | Qué hace |
 * | --- | --- | --- |
 * | ai.reactions_sync | cada 5 min | activa/desactiva las reacciones de IA según flag y acciones registradas |
 * | ai.task_center_refresh_fast | cada 5 min | Tareas sugeridas: visitas, alertas, asignaciones, anomalías, marketing |
 * | ai.task_center_refresh | horaria | Tareas sugeridas: siguiente acción de ventas y calidad de fichas |
 * | ai.anomalies_detect | horaria | detección de anomalías con evidencia y avisos con tope diario |
 * | ai.site_events_rollup | diaria | property.viewed / tour.started / tour.completed del día anterior |
 */
import "./reactions";
import { registerJobHandler } from "../../jobs/registry";
import { addScheduledTask } from "../../jobs/scheduled";
import { markOrganizationBriefsStale } from "../brief/cache";
import { detectAnomalies } from "../anomalies/service";
import { FAST_SOURCES, refreshSuggestions, SLOW_SOURCES } from "../task-center/service";
import { rollupSiteEvents } from "./site-rollup";
import { syncAiReactions } from "./sync";

registerJobHandler("ai.reactions_sync", async (_p, { db, actor }) => syncAiReactions(db, actor));
registerJobHandler("ai.task_center_refresh_fast", async (_p, { db, actor }) => refreshSuggestions(db, actor, { sources: FAST_SOURCES }));
registerJobHandler("ai.task_center_refresh", async (_p, { db, actor }) => refreshSuggestions(db, actor, { sources: SLOW_SOURCES }));
registerJobHandler("ai.anomalies_detect", async (_p, { db, actor }) => {
  const r = await detectAnomalies(db, actor);
  if ("opened" in r && r.opened > 0) await markOrganizationBriefsStale(db, actor.organizationId);
  return r;
});
registerJobHandler("ai.site_events_rollup", async (_p, { db, actor }) => rollupSiteEvents(db, actor));

addScheduledTask({ type: "ai.reactions_sync", every: "every_5_minutes" });
addScheduledTask({ type: "ai.task_center_refresh_fast", every: "every_5_minutes", timeoutMs: 60_000 });
addScheduledTask({ type: "ai.task_center_refresh", every: "hourly", timeoutMs: 180_000 });
addScheduledTask({ type: "ai.anomalies_detect", every: "hourly", timeoutMs: 120_000 });
addScheduledTask({ type: "ai.site_events_rollup", every: "daily", timeoutMs: 120_000 });
