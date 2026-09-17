"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  assignLead,
  assignLeadSchema,
  changeLeadPriority,
  changeLeadStatus,
  createManualLead,
  firstContactSchema,
  leadPrioritySchema,
  leadStatusSchema,
  manualLeadSchema,
  registerFirstContact,
} from "@/server/leads/service";
import { createOpportunity, createOpportunitySchema } from "@/server/opportunities/service";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const nullable = (fd: FormData, k: string) => str(fd, k) || null;

export async function createManualLeadAction(fd: FormData) {
  const r = await runAction(
    "leads.create_manual",
    manualLeadSchema,
    {
      name: str(fd, "name") ?? "",
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      phoneIsWhatsapp: fd.get("phoneIsWhatsapp") === "on",
      message: str(fd, "message"),
      sourceKey: str(fd, "sourceKey"),
      propertyId: nullable(fd, "propertyId"),
      operationInterest: nullable(fd, "operationInterest"),
      priority: str(fd, "priority") || "normal",
      assignedUserId: nullable(fd, "assignedUserId"),
      idempotencyKey: str(fd, "idempotencyKey"),
    },
    (d, actor) => createManualLead(getDb(), actor, d),
  );
  if (!r.ok) return r;
  redirect(`/crm/leads/${r.data.leadId}`);
}

export async function assignLeadAction(fd: FormData) {
  const r = await runAction("leads.assign", assignLeadSchema, { leadId: str(fd, "leadId"), userId: nullable(fd, "userId") }, (d, actor) => assignLead(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function changeLeadStatusAction(fd: FormData) {
  const r = await runAction("leads.change_status", leadStatusSchema, { leadId: str(fd, "leadId"), status: str(fd, "status") }, (d, actor) => changeLeadStatus(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function changeLeadPriorityAction(fd: FormData) {
  const r = await runAction("leads.change_priority", leadPrioritySchema, { leadId: str(fd, "leadId"), priority: str(fd, "priority") }, (d, actor) => changeLeadPriority(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function registerFirstContactAction(fd: FormData) {
  const r = await runAction(
    "leads.first_contact",
    firstContactSchema,
    { leadId: str(fd, "leadId"), channel: str(fd, "channel"), note: str(fd, "note") },
    (d, actor) => registerFirstContact(getDb(), actor, d),
  );
  if (r.ok) refresh();
  return r;
}

export async function convertLeadAction(fd: FormData) {
  const r = await runAction(
    "leads.convert",
    createOpportunitySchema,
    { leadId: str(fd, "leadId"), pipelineKey: nullable(fd, "pipelineKey"), idempotencyKey: str(fd, "idempotencyKey") },
    (d, actor) => createOpportunity(getDb(), actor, d),
  );
  if (!r.ok) return r;
  redirect(`/crm/pipeline/${r.data.id}`);
}
