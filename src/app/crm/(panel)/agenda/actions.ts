"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import {
  appointmentActionSchema,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  createAppointmentSchema,
  markNoShow,
  rescheduleAppointment,
  rescheduleSchema,
} from "@/server/agenda/service";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const nullable = (fd: FormData, k: string) => str(fd, k) || null;

export async function createAppointmentAction(fd: FormData) {
  const r = await runAction(
    "agenda.create",
    createAppointmentSchema,
    {
      kind: str(fd, "kind"),
      title: str(fd, "title"),
      startsAt: str(fd, "startsAt") ?? "",
      durationMinutes: str(fd, "durationMinutes") || 60,
      propertyId: nullable(fd, "propertyId"),
      contactId: nullable(fd, "contactId"),
      opportunityId: nullable(fd, "opportunityId"),
      leadId: nullable(fd, "leadId"),
      assignedUserId: nullable(fd, "assignedUserId"),
      location: str(fd, "location"),
      notes: str(fd, "notes"),
      idempotencyKey: str(fd, "idempotencyKey"),
    },
    (d, actor) => createAppointment(getDb(), actor, d),
  );
  if (!r.ok) return r;
  redirect(`/crm/agenda/${r.data.id}`);
}

const reasonForm = (fd: FormData) => ({ appointmentId: str(fd, "appointmentId"), result: str(fd, "result"), reason: str(fd, "reason") });

export async function confirmAppointmentAction(input: z.input<typeof appointmentActionSchema>) {
  const r = await runAction("agenda.confirm", appointmentActionSchema, input, (d, actor) => confirmAppointment(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function noShowAction(input: z.input<typeof appointmentActionSchema>) {
  const r = await runAction("agenda.no_show", appointmentActionSchema, input, (d, actor) => markNoShow(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function completeAppointmentAction(fd: FormData) {
  const r = await runAction(
    "agenda.complete",
    appointmentActionSchema.refine((v) => (v.result?.length ?? 0) >= 3, { message: "Contá cómo fue (mínimo 3 caracteres)", path: ["result"] }),
    reasonForm(fd),
    (d, actor) => completeAppointment(getDb(), actor, d),
  );
  if (r.ok) refresh();
  return r;
}

export async function cancelAppointmentAction(fd: FormData) {
  const r = await runAction(
    "agenda.cancel",
    appointmentActionSchema.refine((v) => (v.reason?.length ?? 0) >= 3, { message: "Indicá el motivo (mínimo 3 caracteres)", path: ["reason"] }),
    reasonForm(fd),
    (d, actor) => cancelAppointment(getDb(), actor, d),
  );
  if (r.ok) refresh();
  return r;
}

export async function rescheduleAction(fd: FormData) {
  const r = await runAction(
    "agenda.reschedule",
    rescheduleSchema,
    { appointmentId: str(fd, "appointmentId"), startsAt: str(fd, "startsAt") ?? "", durationMinutes: str(fd, "durationMinutes"), assignedUserId: fd.has("assignedUserId") ? nullable(fd, "assignedUserId") : undefined, reason: str(fd, "reason") },
    (d, actor) => rescheduleAppointment(getDb(), actor, d),
  );
  if (r.ok) refresh();
  return r;
}
