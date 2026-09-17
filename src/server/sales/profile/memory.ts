/**
 * Memoria de CLIENTE del AI Core (`CustomerMemory`, core/memory.ts) implementada sobre el perfil del comprador.
 * - getProfile: solo datos CONFIRMADOS por una persona (nunca inferidos en silencio).
 * - proposeUpdate: capability `suggest` → crea datos SUGERIDOS (origen «conversación») que el equipo confirma.
 */
import "server-only";
import type { Executor } from "../../db";
import { can, type StaffActor } from "../../auth/actor";
import { forbidden } from "../../errors";
import type { CustomerMemory, CustomerProfile } from "../../ai/core/memory";
import { loadSalesContact } from "../scope";
import { parseFieldValue, type LocationValue, type ProposedItem } from "./fields";
import { getBuyerProfile, proposePreferences } from "./service";

export class BuyerProfileMemory implements CustomerMemory {
  async getProfile(db: Executor, actor: StaffActor, contactId: string): Promise<CustomerProfile | null> {
    const p = await getBuyerProfile(db, actor, contactId);
    const confirmed = p.fields.filter((f) => f.confirmed);
    if (!confirmed.length) return null;
    const value = <T>(field: string): T | null => (p.fields.find((f) => f.field === field)?.confirmed?.value as T | undefined) ?? null;
    const budget = value<{ max: number | null; currency: "USD" | "ARS" }>("budget");
    const last = confirmed.map((f) => f.confirmed!).sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0]!;
    return {
      contactId,
      operation: value<CustomerProfile["operation"]>("transaction_type"),
      propertyTypes: value<string[]>("property_types") ?? [],
      localities: (value<LocationValue[]>("locations") ?? []).map((l) => l.name),
      budgetMax: budget?.max ?? null,
      budgetCurrency: budget?.currency ?? null,
      minBedrooms: value<number>("bedrooms_min"),
      notes: value<string>("notes"),
      confirmedBy: last.decidedBy,
      updatedAt: last.decidedAt ?? last.createdAt,
    };
  }

  async proposeUpdate(db: Executor, actor: StaffActor, contactId: string, proposal: Partial<CustomerProfile>): Promise<{ proposalId: string }> {
    const { contact } = await loadSalesContact(db, actor, contactId);
    if (!can(actor, "contacts.update")) throw forbidden();
    const items: ProposedItem[] = [];
    if (proposal.operation) items.push({ field: "transaction_type", value: proposal.operation, confidence: 0.7 });
    if (proposal.propertyTypes?.length) items.push({ field: "property_types", value: proposal.propertyTypes, confidence: 0.7 });
    if (proposal.budgetMax && proposal.budgetCurrency) items.push({ field: "budget", value: { min: null, max: proposal.budgetMax, currency: proposal.budgetCurrency }, confidence: 0.7 });
    if (proposal.minBedrooms !== undefined && proposal.minBedrooms !== null) items.push({ field: "bedrooms_min", value: proposal.minBedrooms, confidence: 0.7 });
    const valid = items.filter((i) => parseFieldValue(i.field, i.value).ok);
    const r = await proposePreferences(db, { organizationId: contact.organization_id, contactId, source: "conversation", items: valid, createdBy: actor.userId });
    return { proposalId: r.proposed[0] ?? "sin-cambios" };
  }
}
