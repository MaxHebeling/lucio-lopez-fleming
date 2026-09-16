/**
 * Ajustes de alquiler por índice. El sistema solo PROPONE: aplicar o rechazar lo decide una persona con rentals.adjust.
 * Fórmulas y redondeo: ver adjustment-calc.ts y decimal.ts.
 */
import { pgCode, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, requireStaff, type Actor } from "../auth/actor";
import { conflict, notFound } from "../errors";
import { log } from "../log";
import { calculateAdjustment, DAILY_INDICES, dailyWindow, monthsForPeriod, previousPeriodStart, type IndexKey, type IndexPoint } from "./adjustment-calc";
import { addDays, todayInSalta } from "./dates";
import { firstAdjustmentDate, loadContractForUpdate } from "./contracts";
import { repriceUnpaidFrom } from "./obligations";
import { rejectAdjustmentSchema } from "./schema";

export type ProposeResult =
  | { status: "proposed"; adjustmentId: string; newAmount: string; factor: string }
  | { status: "exists"; adjustmentId: string }
  | { status: "missing_values"; missing: string[] }
  | { status: "rejected_pending_review" }
  | { status: "not_applicable"; reason: string };

async function loadIndexValues(trx: Tx, key: IndexKey, periodStart: string, effectiveDate: string, periodMonths: number): Promise<IndexPoint[]> {
  if ((DAILY_INDICES as readonly string[]).includes(key)) {
    const a = dailyWindow(periodStart);
    const b = dailyWindow(effectiveDate);
    const rows = await trx
      .selectFrom("index_values")
      .select(["period_date", "value"])
      .where("index_key", "=", key)
      .where((eb) => eb.or([eb.between("period_date", a.from, a.to), eb.between("period_date", b.from, b.to)]))
      .execute();
    return rows.map((r) => ({ date: r.period_date, value: r.value }));
  }
  const months = monthsForPeriod(periodStart, periodMonths);
  const rows = await trx.selectFrom("index_values").select(["period_date", "value"]).where("index_key", "=", key).where("period_date", "in", months).execute();
  return rows.map((r) => ({ date: r.period_date, value: r.value }));
}

/**
 * Calcula y deja PROPUESTO el ajuste que vence (next_adjustment_date). Idempotente: si ya hay uno propuesto o aplicado
 * para esa fecha lo devuelve. Con `auto` (automatizaciones/jobs) no recalcula una fecha que una persona rechazó.
 * Si faltan valores del índice no calcula nada y deja el aviso en el contrato.
 */
export async function proposeRentAdjustment(db: Database, actor: Actor, contractId: string, opts: { auto?: boolean } = {}): Promise<ProposeResult> {
  requirePermission(actor, "rentals.adjust");
  try {
    return await db.transaction().execute(async (trx): Promise<ProposeResult> => {
      const c = await loadContractForUpdate(trx, contractId);
      if (c.status !== "active") return { status: "not_applicable", reason: "El contrato no está vigente" };
      if (!c.adjustment_index_key || !c.adjustment_period_months || !c.next_adjustment_date)
        return { status: "not_applicable", reason: "El contrato no tiene ajustes pendientes" };
      const effectiveDate = c.next_adjustment_date;
      const existing = await trx
        .selectFrom("rent_adjustments")
        .select(["id", "status"])
        .where("contract_id", "=", contractId)
        .where("effective_date", "=", effectiveDate)
        .orderBy("calculated_at", "desc")
        .execute();
      const live = existing.find((e) => e.status !== "rejected");
      if (live) return { status: "exists", adjustmentId: live.id };
      if (opts.auto && existing.some((e) => e.status === "rejected")) return { status: "rejected_pending_review" };

      const key = c.adjustment_index_key as IndexKey;
      const periodStart = previousPeriodStart(effectiveDate, c.adjustment_period_months, c.start_date);
      const values = await loadIndexValues(trx, key, periodStart, effectiveDate, c.adjustment_period_months);
      const calc = calculateAdjustment({ indexKey: key, previousAmount: c.current_rent, periodStart, effectiveDate, periodMonths: c.adjustment_period_months, values });

      if (!calc.ok) {
        const note = `Ajuste del ${effectiveDate} sin calcular: faltan ${calc.missing.join(", ")}`;
        await trx.updateTable("rental_contracts").set({ adjustment_pending_note: note, adjustment_checked_at: new Date() }).where("id", "=", contractId).execute();
        log.info("rentals.adjustment_missing_values", { contractId, effectiveDate, missing: calc.missing });
        return { status: "missing_values", missing: calc.missing };
      }
      const row = await trx
        .insertInto("rent_adjustments")
        .values({
          contract_id: contractId,
          effective_date: effectiveDate,
          previous_amount: calc.previousAmount,
          new_amount: calc.newAmount,
          index_key: key,
          index_start_date: calc.start?.usedDate ?? calc.months?.[0]?.month ?? null,
          index_start_value: calc.start?.value ?? null,
          index_end_date: calc.end?.usedDate ?? calc.months?.at(-1)?.month ?? null,
          index_end_value: calc.end?.value ?? null,
          factor: calc.factor,
          method: "index",
          status: "proposed",
          calculated_by: actorUserId(actor),
          calculation: JSON.stringify({ ...calc, periodStart, effectiveDate, periodMonths: c.adjustment_period_months }),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.updateTable("rental_contracts").set({ adjustment_pending_note: null, adjustment_checked_at: new Date() }).where("id", "=", contractId).execute();
      await audit(trx, actor, {
        action: "RENT_ADJUSTMENT_PROPOSED",
        entityType: "rent_adjustment",
        entityId: row.id,
        after: { contractId, effectiveDate, previousAmount: calc.previousAmount, newAmount: calc.newAmount, factor: calc.factor, indexKey: key },
      });
      return { status: "proposed", adjustmentId: row.id, newAmount: calc.newAmount, factor: calc.factor };
    });
  } catch (e) {
    if (pgCode(e) === "23505") {
      const again = await db
        .selectFrom("rent_adjustments")
        .select("id")
        .where("contract_id", "=", contractId)
        .where("status", "<>", "rejected")
        .orderBy("calculated_at", "desc")
        .executeTakeFirst();
      if (again) return { status: "exists", adjustmentId: again.id };
    }
    throw e;
  }
}

/** Aplica un ajuste propuesto: actualiza el alquiler vigente, recalcula cuotas futuras impagas y avanza la próxima fecha. */
export async function applyRentAdjustment(db: Database, actor: Actor, adjustmentId: string): Promise<{ repriced: number; nextAdjustmentDate: string | null }> {
  requirePermission(actor, "rentals.adjust");
  requireStaff(actor); // una persona, nunca el sistema
  return db.transaction().execute(async (trx) => {
    const adj = await trx.selectFrom("rent_adjustments").selectAll().where("id", "=", adjustmentId).forUpdate().executeTakeFirst();
    if (!adj) throw notFound("Ajuste");
    if (adj.status !== "proposed") throw conflict(`El ajuste ya está ${adj.status === "applied" ? "aplicado" : "rechazado"}`);
    const c = await loadContractForUpdate(trx, adj.contract_id);
    if (c.status !== "active") throw conflict("El contrato no está vigente");
    if (c.next_adjustment_date !== adj.effective_date) throw conflict("El ajuste no corresponde a la próxima fecha de ajuste del contrato");
    if (c.current_rent !== adj.previous_amount) throw conflict("El alquiler cambió desde que se calculó el ajuste: rechazalo y recalculá");

    await trx.updateTable("rent_adjustments").set({ status: "applied", applied_at: new Date(), applied_by: actorUserId(actor) }).where("id", "=", adj.id).execute();
    const next = c.adjustment_period_months ? firstAdjustmentDate(adj.effective_date, c.end_date, c.adjustment_period_months) : null;
    await trx
      .updateTable("rental_contracts")
      .set({ current_rent: adj.new_amount, next_adjustment_date: next, adjustment_pending_note: null })
      .where("id", "=", c.id)
      .execute();
    const repriced = await repriceUnpaidFrom(trx, c.id, adj.effective_date, adj.new_amount);
    await audit(trx, actor, {
      action: "RENT_ADJUSTMENT_APPLIED",
      entityType: "rent_adjustment",
      entityId: adj.id,
      before: { status: "proposed", currentRent: c.current_rent, nextAdjustmentDate: c.next_adjustment_date },
      after: { status: "applied", currentRent: adj.new_amount, nextAdjustmentDate: next, obligationsRepriced: repriced },
      metadata: { contractId: c.id, factor: adj.factor },
    });
    return { repriced, nextAdjustmentDate: next };
  });
}

/** Rechaza con motivo. Con `skipPeriod` el alquiler no se ajusta en esta fecha y se pasa a la siguiente. */
export async function rejectRentAdjustment(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "rentals.adjust");
  requireStaff(actor);
  const input = rejectAdjustmentSchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    const adj = await trx.selectFrom("rent_adjustments").selectAll().where("id", "=", input.adjustmentId).forUpdate().executeTakeFirst();
    if (!adj) throw notFound("Ajuste");
    if (adj.status !== "proposed") throw conflict("Solo se rechaza un ajuste propuesto");
    const c = await loadContractForUpdate(trx, adj.contract_id);
    await trx
      .updateTable("rent_adjustments")
      .set({ status: "rejected", rejected_reason: input.reason, rejected_by: actorUserId(actor), rejected_at: new Date() })
      .where("id", "=", adj.id)
      .execute();
    let next = c.next_adjustment_date;
    if (input.skipPeriod && c.next_adjustment_date === adj.effective_date && c.adjustment_period_months) {
      next = firstAdjustmentDate(adj.effective_date, c.end_date, c.adjustment_period_months);
      await trx.updateTable("rental_contracts").set({ next_adjustment_date: next, adjustment_pending_note: null }).where("id", "=", c.id).execute();
    }
    await audit(trx, actor, {
      action: "RENT_ADJUSTMENT_REJECTED",
      entityType: "rent_adjustment",
      entityId: adj.id,
      before: { status: "proposed", nextAdjustmentDate: c.next_adjustment_date },
      after: { status: "rejected", nextAdjustmentDate: next, skipPeriod: input.skipPeriod },
      metadata: { reason: input.reason, contractId: c.id },
    });
  });
}

/** Contratos vigentes cuyo ajuste vence dentro de `aheadDays`. */
export async function contractsWithAdjustmentDue(db: Database, today = todayInSalta(), aheadDays = 7) {
  return db
    .selectFrom("rental_contracts")
    .select(["id", "code", "next_adjustment_date", "adjustment_index_key", "adjustment_pending_note"])
    .where("status", "=", "active")
    .where("next_adjustment_date", "is not", null)
    .where("next_adjustment_date", "<=", addDays(today, aheadDays))
    .execute();
}

/** Reintento silencioso (sin avisos) de los ajustes que quedaron sin calcular por falta de índices. */
export async function retryPendingAdjustments(db: Database, actor: Actor): Promise<{ retried: number; proposed: number }> {
  const pending = await db
    .selectFrom("rental_contracts")
    .select("id")
    .where("status", "=", "active")
    .where("adjustment_pending_note", "is not", null)
    .execute();
  let proposed = 0;
  for (const p of pending) {
    const r = await proposeRentAdjustment(db, actor, p.id, { auto: true });
    if (r.status === "proposed") proposed++;
  }
  return { retried: pending.length, proposed };
}

