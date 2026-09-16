/**
 * Contratos de alquiler: alta (borrador), activación (genera cuotas y marca la propiedad alquilada),
 * edición, finalización/rescisión y renovación. Toda mutación: permiso → validación → transacción con bloqueo
 * → auditoría (antes/después) → evento, todo en la misma transacción.
 */
import { pgCode, sql, type Database, type Tx } from "../db";
import { audit, diff } from "../audit";
import { actorUserId, requirePermission, systemActor, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid, notFound } from "../errors";
import { resolveContactForCapture, type ContactRole } from "../contacts/service";
import { changeStatus } from "../properties/service";
import { addMonths, todayInSalta } from "./dates";
import { ensureObligations } from "./obligations";
import { parseRatio } from "./decimal";
import {
  createContractSchema,
  endContractSchema,
  renewContractSchema,
  updateDraftContractSchema,
  updateNotesSchema,
  type PartyInput,
} from "./schema";

type PartyRole = "owner" | "tenant" | "guarantor";
const CONTACT_ROLE: Record<PartyRole, ContactRole> = { owner: "owner", tenant: "tenant", guarantor: "guarantor" };

export function firstAdjustmentDate(start: string, end: string, periodMonths: number | null | undefined): string | null {
  if (!periodMonths) return null;
  const d = addMonths(start, periodMonths);
  return d < end ? d : null;
}

export async function loadContractForUpdate(trx: Tx, id: string) {
  const c = await trx.selectFrom("rental_contracts").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  if (!c) throw notFound("Contrato");
  return c;
}

async function resolveParty(trx: Tx, actor: Actor, p: PartyInput, role: PartyRole): Promise<{ contactId: string; sharePct: string | null }> {
  if ("contactId" in p) {
    const c = await trx
      .selectFrom("contacts")
      .select(["id"])
      .where("id", "=", p.contactId)
      .where("deleted_at", "is", null)
      .where("merged_into_id", "is", null)
      .executeTakeFirst();
    if (!c) throw invalid("Uno de los contactos elegidos no existe o fue fusionado");
    await trx.insertInto("contact_roles").values({ contact_id: c.id, role: CONTACT_ROLE[role] }).onConflict((oc) => oc.doNothing()).execute();
    return { contactId: c.id, sharePct: p.sharePct ?? null };
  }
  requirePermission(actor, "contacts.create");
  const { contactId } = await resolveContactForCapture(trx, actor, {
    name: p.name,
    email: p.email ?? null,
    phone: p.phone ?? null,
    source: "rentals",
    role: CONTACT_ROLE[role],
  });
  return { contactId, sharePct: p.sharePct ?? null };
}

function validateOwnerShares(owners: Array<{ sharePct: string | null }>): void {
  if (owners.length === 1) return;
  if (owners.some((o) => o.sharePct === null)) throw invalid("Con varios propietarios indicá el porcentaje de cada uno", { owners: ["Falta el porcentaje"] });
  const total = owners.reduce((acc, o) => acc + parseRatio(o.sharePct!).n * (10000n / parseRatio(o.sharePct!).d), 0n);
  if (total !== 1_000_000n) throw invalid("Los porcentajes de los propietarios deben sumar 100%", { owners: ["Deben sumar 100%"] });
}

async function nextContractCode(trx: Tx, propertyCode: number, start: string): Promise<string> {
  const base = `ALQ-${propertyCode}-${start.slice(0, 4)}${start.slice(5, 7)}`;
  for (let i = 1; ; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    const exists = await trx.selectFrom("rental_contracts").select("id").where("code", "=", code).executeTakeFirst();
    if (!exists) return code;
  }
}

function financialColumns(input: ReturnType<typeof updateDraftContractSchema.parse>) {
  return {
    start_date: input.startDate,
    end_date: input.endDate,
    currency: input.currency,
    initial_rent: input.initialRent,
    current_rent: input.initialRent,
    payment_due_day: input.paymentDueDay,
    deposit_amount: input.depositAmount ?? null,
    deposit_currency: input.depositAmount ? (input.depositCurrency ?? input.currency) : null,
    commission_amount: input.commissionAmount ?? null,
    management_fee_pct: input.managementFeePct,
    adjustment_index_key: input.adjustmentIndexKey ?? null,
    adjustment_period_months: input.adjustmentPeriodMonths ?? null,
    next_adjustment_date: firstAdjustmentDate(input.startDate, input.endDate, input.adjustmentPeriodMonths),
    late_fee_daily_pct: input.lateFeeDailyPct ?? null,
  };
}

async function insertParties(trx: Tx, actor: Actor, contractId: string, parties: { owners: PartyInput[]; tenants: PartyInput[]; guarantors: PartyInput[] }) {
  const owners = [];
  for (const p of parties.owners) owners.push(await resolveParty(trx, actor, p, "owner"));
  validateOwnerShares(owners);
  const tenants = [];
  for (const p of parties.tenants) tenants.push(await resolveParty(trx, actor, p, "tenant"));
  const guarantors = [];
  for (const p of parties.guarantors) guarantors.push(await resolveParty(trx, actor, p, "guarantor"));
  const rows = [
    ...owners.map((o) => ({ contract_id: contractId, contact_id: o.contactId, role: "owner", share_pct: owners.length === 1 ? (o.sharePct ?? "100") : o.sharePct })),
    ...tenants.map((t) => ({ contract_id: contractId, contact_id: t.contactId, role: "tenant", share_pct: null })),
    ...guarantors.map((g) => ({ contract_id: contractId, contact_id: g.contactId, role: "guarantor", share_pct: null })),
  ];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = `${r.contact_id}:${r.role}`;
    if (seen.has(k)) throw invalid("Hay un contacto repetido en el mismo rol");
    seen.add(k);
  }
  await trx.insertInto("rental_contract_parties").values(rows).execute();
  return { owners: owners.map((o) => o.contactId), tenants: tenants.map((t) => t.contactId), guarantors: guarantors.map((g) => g.contactId) };
}

export async function createContract(db: Database, actor: Actor, raw: unknown): Promise<{ id: string; code: string }> {
  requirePermission(actor, "rentals.manage");
  const input = createContractSchema.parse(raw);
  try {
    return await db.transaction().execute(async (trx) => {
      const property = await trx
        .selectFrom("properties")
        .select(["id", "code", "status"])
        .where("id", "=", input.propertyId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!property) throw invalid("La propiedad no existe", { propertyId: ["Propiedad inexistente"] });
      if (property.status === "archived") throw invalid("La propiedad está archivada", { propertyId: ["Propiedad archivada"] });
      const code = input.code ?? (await nextContractCode(trx, property.code, input.startDate));
      const row = await trx
        .insertInto("rental_contracts")
        .values({
          organization_id: actor.organizationId,
          code,
          property_id: property.id,
          status: "draft",
          ...financialColumns(input),
          notes: input.notes ?? null,
          created_by: actorUserId(actor),
        })
        .returning(["id", "code"])
        .executeTakeFirstOrThrow();
      const parties = await insertParties(trx, actor, row.id, input);
      await audit(trx, actor, {
        action: "RENTAL_CONTRACT_CREATED",
        entityType: "rental_contract",
        entityId: row.id,
        after: { ...financialColumns(input), code, propertyId: property.id, parties },
      });
      await emitEvent(trx, actor, {
        type: "contract.created",
        aggregateType: "rental_contract",
        aggregateId: row.id,
        payload: { code, propertyId: property.id, summary: `Contrato ${code} creado (borrador)`, link: `/crm/alquileres/${row.id}` },
        dedupeKey: `contract.created:${row.id}`,
      });
      return row;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("Ya existe un contrato con ese código");
    throw e;
  }
}

/** Borrador: todo editable (incluidas partes). Vigente u otro: solo notas. */
export async function updateContract(
  db: Database,
  actor: Actor,
  id: string,
  raw: unknown,
  parties?: { owners: PartyInput[]; tenants: PartyInput[]; guarantors: PartyInput[] },
): Promise<void> {
  requirePermission(actor, "rentals.manage");
  await db.transaction().execute(async (trx) => {
    const current = await loadContractForUpdate(trx, id);
    if (current.status !== "draft") {
      const { notes } = updateNotesSchema.parse(raw);
      if ((current.notes ?? null) === notes) return;
      await trx.updateTable("rental_contracts").set({ notes }).where("id", "=", id).execute();
      await audit(trx, actor, { action: "RENTAL_CONTRACT_UPDATED", entityType: "rental_contract", entityId: id, before: { notes: current.notes }, after: { notes } });
      return;
    }
    const input = updateDraftContractSchema.parse(raw);
    const cols = { ...financialColumns(input), notes: input.notes ?? null };
    const changes = diff(current as unknown as Record<string, unknown>, cols);
    await trx.updateTable("rental_contracts").set(cols).where("id", "=", id).execute();
    let partiesAfter: unknown;
    if (parties) {
      const before = await trx.selectFrom("rental_contract_parties").select(["contact_id", "role", "share_pct"]).where("contract_id", "=", id).execute();
      await trx.deleteFrom("rental_contract_parties").where("contract_id", "=", id).execute();
      partiesAfter = await insertParties(trx, actor, id, { owners: parties.owners, tenants: parties.tenants, guarantors: parties.guarantors });
      (changes.before as Record<string, unknown>).parties = before;
    }
    await audit(trx, actor, {
      action: "RENTAL_CONTRACT_UPDATED",
      entityType: "rental_contract",
      entityId: id,
      before: changes.before,
      after: { ...changes.after, ...(partiesAfter ? { parties: partiesAfter } : {}) },
    });
  });
}

/**
 * Activa un borrador: valida partes y superposición, genera cuotas y, si la propiedad está disponible o reservada,
 * la pasa a "alquilada" usando el servicio de propiedades dentro de la misma transacción (con sus reglas e historial).
 */
export async function activateContract(db: Database, actor: Actor, id: string): Promise<{ obligations: number; propertyMarkedRented: boolean }> {
  requirePermission(actor, "rentals.manage");
  try {
    return await db.transaction().execute(async (trx) => {
      const c = await loadContractForUpdate(trx, id);
      if (c.status !== "draft") throw conflict("Solo se activan contratos en borrador");
      // Serializa activaciones de la misma propiedad
      const property = await trx.selectFrom("properties").select(["id", "status"]).where("id", "=", c.property_id).forUpdate().executeTakeFirstOrThrow();
      const roles = await trx.selectFrom("rental_contract_parties").select(["role", "share_pct"]).where("contract_id", "=", id).execute();
      if (!roles.some((r) => r.role === "owner")) throw invalid("El contrato no tiene propietario");
      if (!roles.some((r) => r.role === "tenant")) throw invalid("El contrato no tiene inquilino");
      validateOwnerShares(roles.filter((r) => r.role === "owner").map((r) => ({ sharePct: r.share_pct })));
      const overlap = await trx
        .selectFrom("rental_contracts")
        .select(["code"])
        .where("property_id", "=", c.property_id)
        .where("status", "=", "active")
        .where("id", "<>", id)
        .where(sql<boolean>`daterange(start_date, end_date, '[)') && daterange(${c.start_date}::date, ${c.end_date}::date, '[)')`)
        .executeTakeFirst();
      if (overlap) throw conflict(`La propiedad ya tiene el contrato vigente ${overlap.code} en esas fechas`);

      await trx.updateTable("rental_contracts").set({ status: "active" }).where("id", "=", id).execute();
      const obligations = await ensureObligations(trx, id);

      // Renovación: el contrato anterior queda como "renovado".
      if (c.renewal_of_contract_id) {
        await trx
          .updateTable("rental_contracts")
          .set({ status: "renewed" })
          .where("id", "=", c.renewal_of_contract_id)
          .where("status", "in", ["active", "ended"])
          .execute();
      }

      let propertyMarkedRented = false;
      if (property.status === "available" || property.status === "reserved") {
        // El equipo de alquileres no tiene properties.change_status: el cambio lo hace el sistema como consecuencia
        // de la activación, con el servicio de propiedades (transiciones válidas, historial, auditoría y eventos).
        const sys = { ...systemActor(actor.organizationId, `rentals.activate_contract:${actorUserId(actor) ?? "system"}`), requestId: actor.requestId, ip: actor.ip };
        await changeStatus(trx, sys, c.property_id, "rented", `Contrato ${c.code} activado`);
        propertyMarkedRented = true;
      }
      await audit(trx, actor, {
        action: "RENTAL_CONTRACT_ACTIVATED",
        entityType: "rental_contract",
        entityId: id,
        before: { status: "draft" },
        after: { status: "active", obligations, propertyMarkedRented },
      });
      return { obligations, propertyMarkedRented };
    });
  } catch (e) {
    if (pgCode(e) === "23P01") throw conflict("La propiedad ya tiene otro contrato vigente superpuesto");
    throw e;
  }
}

/**
 * Finaliza (vencimiento natural) o rescinde. Las cuotas posteriores a la fecha que no tengan pagos quedan anuladas
 * (`waived`); las que tienen pagos se conservan para no perder historia.
 */
export async function endContract(db: Database, actor: Actor, id: string, raw: unknown): Promise<{ waived: number }> {
  requirePermission(actor, "rentals.manage");
  const input = endContractSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const c = await loadContractForUpdate(trx, id);
    if (c.status !== "active") throw conflict("Solo se finaliza o rescinde un contrato vigente");
    if (input.effectiveDate < c.start_date) throw invalid("La fecha no puede ser anterior al inicio del contrato");
    const waived = await trx
      .updateTable("rent_obligations")
      .set({ status: "waived" })
      .where("contract_id", "=", id)
      .where("period_start", ">", input.effectiveDate)
      .where("paid_amount", "=", "0")
      .where("status", "in", ["pending", "overdue"])
      .executeTakeFirst();
    await trx
      .updateTable("rental_contracts")
      .set({
        status: input.kind,
        terminated_at: new Date(`${input.effectiveDate}T12:00:00Z`),
        termination_reason: input.kind === "terminated" ? input.reason : null,
        ended_reason: input.kind === "ended" ? input.reason : null,
        next_adjustment_date: null,
        adjustment_pending_note: null,
      })
      .where("id", "=", id)
      .execute();
    const count = Number(waived.numUpdatedRows);
    await audit(trx, actor, {
      action: input.kind === "terminated" ? "RENTAL_CONTRACT_TERMINATED" : "RENTAL_CONTRACT_ENDED",
      entityType: "rental_contract",
      entityId: id,
      before: { status: c.status },
      after: { status: input.kind, effectiveDate: input.effectiveDate, obligationsWaived: count },
      metadata: { reason: input.reason },
    });
    return { waived: count };
  });
}

/** Renovación: nuevo contrato en borrador vinculado, con las mismas partes y propiedad. Se activa aparte. */
export async function renewContract(db: Database, actor: Actor, id: string, raw: unknown): Promise<{ id: string; code: string }> {
  requirePermission(actor, "rentals.manage");
  const input = renewContractSchema.parse(raw);
  try {
    return await db.transaction().execute(async (trx) => {
      const c = await loadContractForUpdate(trx, id);
      if (!["active", "ended"].includes(c.status)) throw conflict("Solo se renueva un contrato vigente o finalizado");
      const existing = await trx.selectFrom("rental_contracts").select("code").where("renewal_of_contract_id", "=", id).where("status", "in", ["draft", "active"]).executeTakeFirst();
      if (existing) throw conflict(`Ya existe la renovación ${existing.code}`);
      if (input.startDate < c.end_date) throw invalid("La renovación debe empezar cuando termina el contrato actual", { startDate: [`Desde ${c.end_date}`] });
      const property = await trx.selectFrom("properties").select("code").where("id", "=", c.property_id).executeTakeFirstOrThrow();
      const code = input.code ?? (await nextContractCode(trx, property.code, input.startDate));
      const row = await trx
        .insertInto("rental_contracts")
        .values({
          organization_id: c.organization_id,
          code,
          property_id: c.property_id,
          status: "draft",
          ...financialColumns(input),
          notes: input.notes ?? null,
          renewal_of_contract_id: id,
          created_by: actorUserId(actor),
        })
        .returning(["id", "code"])
        .executeTakeFirstOrThrow();
      await sql`insert into rental_contract_parties(contract_id, contact_id, role, share_pct)
        select ${row.id}, contact_id, role, share_pct from rental_contract_parties where contract_id = ${id}`.execute(trx);
      await audit(trx, actor, { action: "RENTAL_CONTRACT_RENEWED", entityType: "rental_contract", entityId: row.id, after: { renewalOf: id, code, ...financialColumns(input) } });
      await emitEvent(trx, actor, {
        type: "contract.created",
        aggregateType: "rental_contract",
        aggregateId: row.id,
        payload: { code, propertyId: c.property_id, renewalOf: id, summary: `Renovación ${code} de ${c.code}`, link: `/crm/alquileres/${row.id}` },
        dedupeKey: `contract.created:${row.id}`,
      });
      return row;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("Ya existe un contrato con ese código");
    throw e;
  }
}

/** Job diario: asegura que todo contrato vigente tenga sus cuotas (idempotente). */
export async function generateMissingObligations(db: Database): Promise<{ contracts: number; created: number }> {
  const ids = await db.selectFrom("rental_contracts").select("id").where("status", "=", "active").execute();
  let created = 0;
  for (const { id } of ids) {
    created += await db.transaction().execute((trx) => ensureObligations(trx, id, todayInSalta()));
  }
  return { contracts: ids.length, created };
}

