"use server";

/** Server Actions de la IA de visitas (Fase 4b). Autorización y reglas en src/server/ai/visits/service.ts. */
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { draftThanksWithAi, proposeVisitReport, refreshVisitBrief } from "@/server/ai/visits/service";

const idSchema = z.object({ appointmentId: z.uuid() });

export async function refreshBriefAction(input: z.input<typeof idSchema>) {
  const r = await runAction("visits.ai.brief_refresh", idSchema, input, async (d, actor) => {
    const res = await refreshVisitBrief(getDb(), actor, d.appointmentId);
    return { status: res.status };
  });
  if (r.ok) refresh();
  return r;
}

const proposeSchema = z.object({ appointmentId: z.uuid(), text: z.string().max(10_000) });

export async function proposeReportAction(input: z.input<typeof proposeSchema>) {
  return runAction("visits.ai.report_propose", proposeSchema, input, (d, actor) => proposeVisitReport(getDb(), actor, d));
}

export async function draftThanksAiAction(input: z.input<typeof idSchema>) {
  return runAction("visits.ai.thanks_draft", idSchema, input, (d, actor) => draftThanksWithAi(getDb(), actor, d));
}
