/**
 * Guía del Tour 360° con IA (opcional): el modelo SOLO traduce la pregunta a una intención (escena o dato) validada
 * contra el tour publicado; la respuesta la arma `guide.ts` en el navegador. Endpoint público con rate limit por IP,
 * flag `ai_tour_guide`, presupuesto diario y registro en ai_interactions (sin la pregunta).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, type Database } from "../db";
import { isEnabled } from "../flags";
import { rateLimit } from "../rate-limit";
import { redactForModel, untrustedData } from "../ai/core/governance";
import { tourIntentPrompt } from "../ai/prompts/tour-intent";
import { runExtractTask, type TaskDeps } from "../ai/run-task";
import { FACT_TOPICS, type TourIntent } from "./guide";

export const TOUR_GUIDE_RATE = { perIp: 20, windowSeconds: 600 } as const;

export const tourGuideRequestSchema = z.object({ tourId: z.uuid(), question: z.string().trim().min(2).max(200) });

export type TourGuideResult = { status: "ok"; intent: TourIntent | null } | { status: "invalid" | "disabled" | "unknown_tour" | "rate_limited" | "unavailable" };

const ipKey = (ip: string) => createHash("sha256").update(`tour-guide:${ip}`).digest("hex").slice(0, 32);

export async function interpretTourQuestion(db: Database, raw: unknown, ctx: { ip: string | null }, deps: TaskDeps = {}): Promise<TourGuideResult> {
  const parsed = tourGuideRequestSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  if (!(await isEnabled(db, "virtual_tours")) || !(await isEnabled(db, "ai_tour_guide"))) return { status: "disabled" };
  const rl = await rateLimit(db, `tour-guide:ip:${ctx.ip ? ipKey(ctx.ip) : "unknown"}`, ctx.ip ? TOUR_GUIDE_RATE.perIp : TOUR_GUIDE_RATE.perIp * 5, TOUR_GUIDE_RATE.windowSeconds);
  if (!rl.allowed) return { status: "rate_limited" };
  const tour = await sql<{ organization_id: string }>`
    select p.organization_id from virtual_tours t join properties p on p.id = t.property_id
     where t.id = ${parsed.data.tourId} and t.status = 'published' and p.deleted_at is null and (p.is_published or p.is_demo)`.execute(db);
  const org = tour.rows[0]?.organization_id;
  if (!org) return { status: "unknown_tour" };
  const scenes = await db.selectFrom("virtual_tour_scenes").select(["id", "name"]).where("tour_id", "=", parsed.data.tourId).where("is_published", "=", true).orderBy("sort_order").execute();
  const sceneIds = new Set(scenes.map((s) => s.id));
  const factKeys = new Set(FACT_TOPICS.map((t) => t.key));
  const res = await runExtractTask({
    db,
    who: { organizationId: org, userId: null },
    purpose: "tour_intent",
    feature: "ai.tour_guide",
    task: "classify",
    prompt: tourIntentPrompt,
    context: [
      untrustedData("escenas", scenes.map((s) => `${s.id}: ${s.name}`).join("\n"), 3000),
      untrustedData("datos", FACT_TOPICS.map((t) => `${t.key}: ${t.label}`).join("\n"), 1500),
    ],
    messages: [{ role: "user", content: untrustedData("pregunta_visitante", redactForModel(parsed.data.question), 400) }],
    maxTokens: 120,
    timeoutMs: 8_000,
    entityType: "virtual_tour",
    entityId: parsed.data.tourId,
    deps,
    verify: (v) => [
      ...(v.kind === "navigate" && (!v.scene_id || !sceneIds.has(v.scene_id)) ? [{ kind: "unknown_scene", value: String(v.scene_id).slice(0, 40) }] : []),
      ...(v.kind === "feature" && v.fact_key && !factKeys.has(v.fact_key) ? [{ kind: "unknown_fact", value: v.fact_key.slice(0, 40) }] : []),
    ],
  });
  if (!res.ok) return { status: "unavailable" };
  const v = res.value;
  const intent: TourIntent = v.kind === "navigate" ? { kind: "navigate", sceneId: v.scene_id! } : v.kind === "feature" ? { kind: "feature", factKey: v.fact_key, topic: v.fact_key } : { kind: "unknown" };
  return { status: "ok", intent };
}
