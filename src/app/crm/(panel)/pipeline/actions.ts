"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  assignOpportunity,
  assignOpportunitySchema,
  closeSchema,
  createOpportunity,
  createOpportunitySchema,
  loseOpportunity,
  moveOpportunityStage,
  moveStageSchema,
  pauseOpportunity,
  updateOpportunity,
  updateOpportunitySchema,
  winOpportunity,
} from "@/server/opportunities/service";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const nullable = (fd: FormData, k: string) => str(fd, k) || null;

function requirementsFrom(fd: FormData) {
  const bedrooms = str(fd, "bedroomsMin");
  return {
    text: str(fd, "reqText") ?? "",
    zones: str(fd, "reqZones") ?? "",
    bedroomsMin: bedrooms ? Number(bedrooms) : null,
  };
}

export async function createOpportunityAction(fd: FormData) {
  const r = await runAction(
    "opportunities.create",
    createOpportunitySchema,
    {
      contactId: nullable(fd, "contactId"),
      pipelineKey: nullable(fd, "pipelineKey"),
      propertyId: nullable(fd, "propertyId"),
      title: str(fd, "title"),
      budgetMin: str(fd, "budgetMin"),
      budgetMax: str(fd, "budgetMax"),
      budgetCurrency: nullable(fd, "budgetCurrency"),
      requirements: requirementsFrom(fd),
      assignedUserId: fd.has("assignedUserId") ? nullable(fd, "assignedUserId") : undefined,
      idempotencyKey: str(fd, "idempotencyKey"),
    },
    (d, actor) => createOpportunity(getDb(), actor, d),
  );
  if (!r.ok) return r;
  redirect(`/crm/pipeline/${r.data.id}`);
}

export async function moveStageAction(input: z.input<typeof moveStageSchema>) {
  const r = await runAction("opportunities.move", moveStageSchema, input, (d, actor) => moveOpportunityStage(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function moveStageFormAction(fd: FormData) {
  return moveStageAction({ opportunityId: str(fd, "opportunityId") ?? "", stageId: str(fd, "stageId") ?? "", note: str(fd, "note"), lostReason: str(fd, "lostReason") });
}

const closeInput = (fd: FormData) => ({
  opportunityId: str(fd, "opportunityId"),
  note: str(fd, "note"),
  lostReason: str(fd, "lostReason"),
  valueAmount: str(fd, "valueAmount"),
  valueCurrency: nullable(fd, "valueCurrency"),
});

export async function winAction(fd: FormData) {
  const r = await runAction("opportunities.win", closeSchema, closeInput(fd), (d, actor) => winOpportunity(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function loseAction(fd: FormData) {
  const r = await runAction(
    "opportunities.lose",
    closeSchema.refine((v) => Boolean(v.lostReason), { message: "El motivo es obligatorio", path: ["lostReason"] }),
    closeInput(fd),
    (d, actor) => loseOpportunity(getDb(), actor, d),
  );
  if (r.ok) refresh();
  return r;
}

export async function pauseAction(fd: FormData) {
  const r = await runAction("opportunities.pause", closeSchema, closeInput(fd), (d, actor) => pauseOpportunity(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function updateOpportunityAction(fd: FormData) {
  const r = await runAction(
    "opportunities.update",
    updateOpportunitySchema,
    {
      opportunityId: str(fd, "opportunityId"),
      title: str(fd, "title"),
      propertyId: nullable(fd, "propertyId"),
      operation: nullable(fd, "operation"),
      budgetMin: str(fd, "budgetMin"),
      budgetMax: str(fd, "budgetMax"),
      budgetCurrency: nullable(fd, "budgetCurrency"),
      expectedCloseDate: str(fd, "expectedCloseDate"),
      requirements: requirementsFrom(fd),
    },
    (d, actor) => updateOpportunity(getDb(), actor, d),
  );
  if (r.ok) refresh();
  return r;
}

export async function assignOpportunityAction(fd: FormData) {
  const r = await runAction("opportunities.assign", assignOpportunitySchema, { opportunityId: str(fd, "opportunityId"), userId: nullable(fd, "userId") }, (d, actor) => assignOpportunity(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}
