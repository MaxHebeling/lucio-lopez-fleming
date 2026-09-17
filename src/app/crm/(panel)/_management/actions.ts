"use server";

/**
 * Server Actions de la IA de gestión (Fase 5): «Resumen de hoy» y «Tareas sugeridas». Solo delegan: autorización,
 * alcance, auditoría y eventos viven en los servicios (src/server/ai/brief, src/server/ai/task-center).
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { isEnabled } from "@/server/flags";
import { log } from "@/server/log";
import { rateLimit } from "@/server/rate-limit";
import { can, requireStaff, systemActor } from "@/server/auth/actor";
import { runAction } from "@/server/next/action";
import { refreshDailyBrief } from "@/server/ai/brief/service";
import { acceptSuggestion, acceptSuggestionSchema, dismissSuggestion, dismissSuggestionSchema, refreshSuggestions, snoozeSuggestion, snoozeSuggestionSchema, TASK_CENTER_FLAG } from "@/server/ai/task-center/service";

async function requireTaskCenter() {
  if (!(await isEnabled(getDb(), TASK_CENTER_FLAG))) throw new AppError("unavailable", "Las tareas sugeridas están desactivadas. Un administrador puede encenderlas en Integraciones.");
}

/** Botón «Actualizar» del Resumen de hoy (formulario sin JS propio). */
export async function refreshDailyBriefFormAction(): Promise<void> {
  const r = await runAction("ai.daily_brief_refresh", z.object({}), {}, (_d, actor) => refreshDailyBrief(getDb(), actor));
  if (!r.ok) log.info("ai.daily_brief_refresh_rejected", { error: r.error });
  refresh();
}

export async function acceptSuggestionAction(input: z.input<typeof acceptSuggestionSchema>) {
  const r = await runAction("ai.suggestion_accept", acceptSuggestionSchema, input, async (d, actor) => {
    await requireTaskCenter();
    return acceptSuggestion(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

export async function dismissSuggestionAction(fd: FormData) {
  const r = await runAction("ai.suggestion_dismiss", dismissSuggestionSchema, { id: fd.get("id"), note: fd.get("note") ?? undefined }, async (d, actor) => {
    await requireTaskCenter();
    return dismissSuggestion(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

export async function snoozeSuggestionAction(fd: FormData) {
  const r = await runAction("ai.suggestion_snooze", snoozeSuggestionSchema, { id: fd.get("id"), until: fd.get("until") }, async (d, actor) => {
    await requireTaskCenter();
    return snoozeSuggestion(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

/** «Actualizar sugerencias»: recalcula la bandeja de la organización ya (máximo una vez cada 2 minutos por usuario). */
export async function refreshSuggestionsAction() {
  const r = await runAction("ai.suggestions_refresh", z.object({}), {}, async (_d, actor) => {
    requireStaff(actor);
    await requireTaskCenter();
    if (!can(actor, "tasks.manage") && !can(actor, "tasks.read_all")) throw new AppError("forbidden", "Tu rol no tiene acceso a las tareas sugeridas");
    const db = getDb();
    const rl = await rateLimit(db, `ai:suggestions:refresh:${actor.userId}`, 1, 120);
    if (!rl.allowed) throw new AppError("rate_limited", "Las sugerencias se actualizaron hace menos de 2 minutos.");
    const stats = await refreshSuggestions(db, systemActor(actor.organizationId, "ai:task_center_manual"));
    return { refreshed: Array.isArray(stats) ? stats.reduce((a, s) => a + s.seen, 0) : 0 };
  });
  if (r.ok) refresh();
  return r;
}
