"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction, formToObject } from "@/server/next/action";
import type { FormState } from "@/components/rentals/form-state";
import { activateContract, createContract, endContract, renewContract, updateContract } from "@/server/rentals/contracts";
import { registerPayment, voidPayment } from "@/server/rentals/payments";
import { applyRentAdjustment, proposeRentAdjustment, rejectRentAdjustment } from "@/server/rentals/adjustments";
import { approveSettlement, cancelSettlement, generateSettlements, markSettlementPaid } from "@/server/rentals/settlements";
import { fetchIndicesFromBcra, setManualIndexValue } from "@/server/rentals/indices";
import { deleteContractDocument, setDocumentVisibility } from "@/server/rentals/documents";
import { changeOwnerEmail, inviteOwner, setOwnerAccessActive } from "@/server/owners/access";
import { searchContacts } from "@/server/rentals/queries";
import { getActor } from "@/server/next/context";
import { requirePermission } from "@/server/auth/actor";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";
import {
  cancelSettlementSchema,
  createContractSchema,
  endContractSchema,
  generateSettlementSchema,
  manualIndexSchema,
  registerPaymentSchema,
  rejectAdjustmentSchema,
  renewContractSchema,
  updateNotesSchema,
  voidPaymentSchema,
} from "@/server/rentals/schema";

const uuid = z.object({ id: z.uuid() });

function toState<T>(r: { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }, message: string | ((d: T) => string)): FormState {
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  refresh();
  return { ok: true, message: typeof message === "function" ? message(r.data) : message, nonce: crypto.randomUUID() };
}

function parseJson(v: FormDataEntryValue | null): unknown {
  if (typeof v !== "string" || !v) return [];
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}

// ───────────── Contratos ─────────────

export async function createContractAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = { ...formToObject(fd), owners: parseJson(fd.get("owners")), tenants: parseJson(fd.get("tenants")), guarantors: parseJson(fd.get("guarantors")) };
  const r = await runAction("rentals.create_contract", createContractSchema, raw, (_d, actor) => createContract(getDb(), actor, raw));
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  redirect(`/crm/alquileres/${r.data.id}`);
}

export async function activateContractAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("rentals.activate", uuid, { id: fd.get("id") }, (d, actor) => activateContract(getDb(), actor, d.id));
  // Activar puede marcar la propiedad como alquilada: el sitio público se actualiza en el momento.
  if (r.ok && r.data.propertyMarkedRented) revalidatePublicSiteInRequest();
  return toState(r, (d) => `Contrato activado: ${d.obligations} cuotas generadas${d.propertyMarkedRented ? " y propiedad marcada como alquilada" : ""}.`);
}

export async function updateNotesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction("rentals.update_notes", updateNotesSchema, { notes: fd.get("notes") ?? "" }, async (d, actor) => {
    if (!z.uuid().safeParse(id).success) throw new Error("id inválido");
    await updateContract(getDb(), actor, id, d);
  });
  return toState(r, "Notas guardadas.");
}

export async function endContractAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "");
  const raw = formToObject(fd);
  const r = await runAction("rentals.end_contract", endContractSchema, raw, (d, actor) => endContract(getDb(), actor, id, d));
  return toState(r, (d) => `Contrato cerrado. Cuotas futuras anuladas: ${d.waived}.`);
}

export async function renewContractAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "");
  const raw = formToObject(fd);
  const r = await runAction("rentals.renew_contract", renewContractSchema, raw, (_d, actor) => renewContract(getDb(), actor, id, raw));
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  redirect(`/crm/alquileres/${r.data.id}`);
}

export async function searchContactsAction(q: string): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const actor = await getActor();
  requirePermission(actor, "rentals.manage");
  const rows = await searchContacts(getDb(), actor, String(q ?? "").slice(0, 100));
  return rows.map((r) => ({ id: r.id, name: r.display_name, email: r.email }));
}

// ───────────── Cobros ─────────────

export async function registerPaymentAction(prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const r = await runAction("rentals.register_payment", registerPaymentSchema, raw, (d, actor) => registerPayment(getDb(), actor, d));
  // Si falla, se conserva la clave vigente (no se registró nada y reintentar con la misma es seguro).
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors, nonce: prev.nonce };
  return toState(r, (d) => (d.duplicate ? "Este cobro ya estaba registrado (envío repetido): no se duplicó." : "Cobro registrado."));
}

export async function voidPaymentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const r = await runAction("rentals.void_payment", voidPaymentSchema, raw, (d, actor) => voidPayment(getDb(), actor, d));
  return toState(r, "Cobro anulado.");
}

// ───────────── Ajustes ─────────────

export async function proposeAdjustmentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("rentals.propose_adjustment", uuid, { id: fd.get("id") }, (d, actor) => proposeRentAdjustment(getDb(), actor, d.id));
  if (r.ok && r.data.status === "missing_values") {
    refresh();
    return { ok: false, error: `No se calculó: faltan ${r.data.missing.join(", ")}.` };
  }
  if (r.ok && r.data.status === "not_applicable") return { ok: false, error: r.data.reason };
  return toState(r, (d) => (d.status === "proposed" ? `Ajuste propuesto: nuevo alquiler ${d.newAmount} (factor ${d.factor}). Revisalo y aplicalo.` : "Ya hay un ajuste propuesto o aplicado para esa fecha."));
}

export async function applyAdjustmentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("rentals.apply_adjustment", uuid, { id: fd.get("id") }, (d, actor) => applyRentAdjustment(getDb(), actor, d.id));
  return toState(r, (d) => `Ajuste aplicado. Cuotas actualizadas: ${d.repriced}.`);
}

export async function rejectAdjustmentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const r = await runAction("rentals.reject_adjustment", rejectAdjustmentSchema, raw, (d, actor) => rejectRentAdjustment(getDb(), actor, d));
  return toState(r, "Ajuste rechazado.");
}

// ───────────── Liquidaciones ─────────────

export async function generateSettlementAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const description = typeof raw.deductionDescription === "string" ? raw.deductionDescription.trim() : "";
  const amount = typeof raw.deductionAmount === "string" ? raw.deductionAmount.trim() : "";
  const input = { contractId: raw.contractId, ownerContactId: raw.ownerContactId, month: raw.month, deductions: description || amount ? [{ description, amount }] : [] };
  const r = await runAction("rentals.generate_settlement", generateSettlementSchema, input, (d, actor) => generateSettlements(getDb(), actor, d));
  return toState(r, (d) => {
    const created = d.filter((x) => x.settlementId && !x.duplicate).length;
    const dup = d.filter((x) => x.duplicate).length;
    const skipped = d.filter((x) => x.skipped).length;
    return [created ? `${created} liquidación(es) generada(s)` : null, dup ? `${dup} ya existía(n)` : null, skipped ? `${skipped} sin cobros para liquidar` : null].filter(Boolean).join(" · ") || "Sin cambios";
  });
}

export async function approveSettlementAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("rentals.approve_settlement", uuid, { id: fd.get("id") }, (d, actor) => approveSettlement(getDb(), actor, d.id));
  return toState(r, "Liquidación aprobada.");
}

export async function paySettlementAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("rentals.pay_settlement", uuid, { id: fd.get("id") }, (d, actor) => markSettlementPaid(getDb(), actor, d.id));
  return toState(r, "Liquidación marcada como pagada.");
}

export async function cancelSettlementAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const r = await runAction("rentals.cancel_settlement", cancelSettlementSchema, raw, (d, actor) => cancelSettlement(getDb(), actor, d));
  return toState(r, "Liquidación cancelada.");
}

// ───────────── Índices ─────────────

export async function manualIndexAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = formToObject(fd);
  const r = await runAction("rentals.manual_index", manualIndexSchema, raw, (d, actor) => setManualIndexValue(getDb(), actor, d));
  return toState(r, (d) => (d.changed ? "Valor guardado." : "El valor ya estaba cargado igual."));
}

export async function fetchBcraNowAction(): Promise<FormState> {
  const r = await runAction("rentals.fetch_bcra", z.object({}), {}, async (_d, actor) => {
    requirePermission(actor, "rentals.adjust");
    return fetchIndicesFromBcra(getDb(), { force: true, requestId: actor.requestId });
  });
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  const failed = r.data.results.filter((x) => x.error);
  if (failed.length) return { ok: false, error: `No se pudo actualizar: ${failed.map((f) => `${f.index} (${f.error})`).join(" · ")}` };
  return { ok: true, message: r.data.results.map((x) => `${x.index}: ${x.received} valores recibidos, ${x.inserted} nuevos, ${x.updated} corregidos`).join(" · ") };
}

// ───────────── Documentos y propietarios ─────────────

export async function documentVisibilityAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = { id: fd.get("id"), visible: fd.get("visible") === "true" };
  const r = await runAction("rentals.document_visibility", z.object({ id: z.uuid(), visible: z.boolean() }), raw, (d, actor) => setDocumentVisibility(getDb(), actor, d.id, d.visible));
  return toState(r, "Visibilidad actualizada.");
}

export async function deleteDocumentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await runAction("rentals.document_delete", uuid, { id: fd.get("id") }, (d, actor) => deleteContractDocument(getDb(), actor, d.id));
  return toState(r, "Documento eliminado.");
}

const optionalText = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : undefined);

export async function inviteOwnerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = { contactId: fd.get("contactId"), email: optionalText(fd.get("email")), confirmEmail: optionalText(fd.get("confirmEmail")) };
  const r = await runAction("owners.invite", z.object({ contactId: z.uuid(), email: z.string().optional(), confirmEmail: z.string().optional() }), raw, (_d, actor) => inviteOwner(getDb(), actor, raw));
  return toState(r, (d) => `Invitación encolada para ${d.email} (válida 72 h).`);
}

export async function setOwnerAccessAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = { userId: fd.get("userId"), active: fd.get("active") === "true", reason: optionalText(fd.get("reason")) };
  const r = await runAction("owners.set_active", z.object({ userId: z.uuid(), active: z.boolean(), reason: z.string().optional() }), raw, (_d, actor) => setOwnerAccessActive(getDb(), actor, raw));
  return toState(r, (d) => (raw.active ? "Acceso al portal restituido." : `Acceso al portal desactivado${d.sessionsRevoked ? ` (${d.sessionsRevoked} sesión/es cerradas)` : ""}.`));
}

export async function changeOwnerEmailAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = { userId: fd.get("userId"), email: optionalText(fd.get("email")), confirmEmail: optionalText(fd.get("confirmEmail")) };
  const r = await runAction("owners.change_email", z.object({ userId: z.uuid(), email: z.string().optional(), confirmEmail: z.string().optional() }), raw, (_d, actor) => changeOwnerEmail(getDb(), actor, raw));
  return toState(r, (d) => (d.changed ? `Email del portal cambiado a ${d.email}. Se cerraron las sesiones abiertas.` : "El email ya era ese."));
}
