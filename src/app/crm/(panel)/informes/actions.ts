"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction, formToObject } from "@/server/next/action";
import type { FormState } from "@/components/rentals/form-state";
import { generateOwnerReport, sendOwnerReport } from "@/server/reports/service";

const generateInput = z.object({
  ownerContactId: z.uuid("Elegí un propietario"),
  propertyId: z.string().optional(),
  periodStart: z.string().min(10, "Indicá el inicio"),
  periodEnd: z.string().min(10, "Indicá el fin"),
  refresh: z.string().optional(),
});

export async function generateReportAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const r = await runAction("reports.generate", generateInput, raw, (_d, actor) => generateOwnerReport(getDb(), actor, raw));
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  redirect(`/crm/informes/${r.data.id}${r.data.created ? "" : r.data.refreshed ? "?actualizado=1" : "?existente=1"}`);
}

export async function sendReportAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("reports.send", z.object({ id: z.uuid() }), { id: fd.get("id") }, (d, actor) => sendOwnerReport(getDb(), actor, d.id));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: "Envío encolado: el propietario recibe un email con el link al portal." };
}
