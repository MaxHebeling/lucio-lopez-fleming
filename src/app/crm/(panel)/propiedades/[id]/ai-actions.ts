"use server";

/** Server Actions de AI Property en la ficha del CRM (calidad, director de fotos). La lógica y los permisos viven en los servicios. */
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { recomputeQualityNow } from "@/server/ai/property/quality";
import { applyOrderSchema, applySuggestedOrder, requestRoomSuggestions, reviewRoomSuggestions, reviewSuggestionSchema, setMediaRoom, setRoomSchema } from "@/server/ai/property/photo-director";
import { applySeoDraft, discardMarketingDraft, draftIdSchema, generateMarketingDrafts, generateSchema, updateDraftSchema, updateMarketingDraft } from "@/server/ai/property/marketing-director";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";

export async function generateMarketingDraftsAction(input: z.input<typeof generateSchema>) {
  const r = await runAction("ai.marketing_director.generate", generateSchema, input, (d, actor) => generateMarketingDrafts(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function updateMarketingDraftAction(input: z.input<typeof updateDraftSchema>) {
  const r = await runAction("ai.marketing_director.update", updateDraftSchema, input, (d, actor) => updateMarketingDraft(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function discardMarketingDraftAction(input: z.input<typeof draftIdSchema>) {
  const r = await runAction("ai.marketing_director.discard", draftIdSchema, input, (d, actor) => discardMarketingDraft(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function applySeoDraftAction(input: z.input<typeof draftIdSchema>) {
  const r = await runAction("ai.marketing_director.apply_seo", draftIdSchema, input, (d, actor) => applySeoDraft(getDb(), actor, d));
  if (r.ok) {
    refresh();
    revalidatePublicSiteInRequest();
  }
  return r;
}

const propertyIdSchema = z.object({ propertyId: z.uuid() });

export async function recomputeQualityAction(propertyId: string) {
  const r = await runAction("ai.property_quality.recompute", propertyIdSchema, { propertyId }, async (d, actor) => {
    const res = await recomputeQualityNow(getDb(), actor, d.propertyId);
    return { status: res.status };
  });
  if (r.ok) refresh();
  return r;
}

export async function setMediaRoomAction(input: z.input<typeof setRoomSchema>) {
  const r = await runAction("ai.photo_director.set_room", setRoomSchema, input, (d, actor) => setMediaRoom(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function reviewRoomSuggestionsAction(input: z.input<typeof reviewSuggestionSchema>) {
  const r = await runAction("ai.photo_director.review", reviewSuggestionSchema, input, (d, actor) => reviewRoomSuggestions(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function applySuggestedOrderAction(input: z.input<typeof applyOrderSchema>) {
  const r = await runAction("ai.photo_director.apply_order", applyOrderSchema, input, (d, actor) => applySuggestedOrder(getDb(), actor, d));
  if (r.ok) {
    refresh();
    revalidatePublicSiteInRequest();
  }
  return r;
}

export async function requestRoomSuggestionsAction(propertyId: string) {
  const r = await runAction("ai.photo_director.request_vision", propertyIdSchema, { propertyId }, (d, actor) => requestRoomSuggestions(getDb(), actor, d.propertyId));
  if (r.ok) refresh();
  return r;
}
