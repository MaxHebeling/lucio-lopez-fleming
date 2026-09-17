/**
 * Obligaciones (cuotas mensuales). Generación idempotente: unique (contrato, período, concepto) + on conflict do nothing.
 * El monto de cada período es el alquiler vigente en ese período: el del último ajuste APLICADO con fecha efectiva
 * ≤ inicio del período, o el alquiler inicial.
 */
import { sql, type Executor, type Tx } from "../db";
import { dueDateFor, monthlyPeriods, todayInSalta } from "./dates";
import { centsToString, toCents } from "./decimal";

export type ObligationStatus = "pending" | "partially_paid" | "paid" | "overdue" | "waived";

/** Estado de una cuota según lo pagado y el vencimiento (hoy en Salta). */
export function obligationStatus(amount: string, paid: string, dueDate: string, today: string): ObligationStatus {
  const a = toCents(amount);
  const p = toCents(paid);
  if (p >= a) return "paid";
  if (dueDate < today) return "overdue";
  return p > 0n ? "partially_paid" : "pending";
}

export function amountForPeriod(initialRent: string, applied: Array<{ effective_date: string; new_amount: string }>, period: string): string {
  let amount = initialRent;
  let best = "";
  for (const a of applied) {
    if (a.effective_date <= period && a.effective_date > best) {
      best = a.effective_date;
      amount = a.new_amount;
    }
  }
  return centsToString(toCents(amount));
}

/** Crea las cuotas que falten de un contrato vigente. Devuelve cuántas creó. */
export async function ensureObligations(trx: Tx, contractId: string, today = todayInSalta()): Promise<number> {
  const c = await trx
    .selectFrom("rental_contracts")
    .select(["id", "status", "start_date", "end_date", "currency", "initial_rent", "payment_due_day"])
    .where("id", "=", contractId)
    .executeTakeFirst();
  if (!c || c.status !== "active") return 0;
  const applied = await trx
    .selectFrom("rent_adjustments")
    .select(["effective_date", "new_amount"])
    .where("contract_id", "=", contractId)
    .where("status", "=", "applied")
    .execute();
  const rows = monthlyPeriods(c.start_date, c.end_date).map((period) => {
    const amount = amountForPeriod(c.initial_rent, applied, period);
    const due = dueDateFor(period, c.payment_due_day);
    return {
      contract_id: c.id,
      period_start: period,
      concept: "rent",
      due_date: due,
      currency: c.currency,
      amount,
      status: obligationStatus(amount, "0", due, today),
    };
  });
  if (!rows.length) return 0;
  const r = await trx
    .insertInto("rent_obligations")
    .values(rows)
    .onConflict((oc) => oc.columns(["contract_id", "period_start", "concept"]).doNothing())
    .executeTakeFirst();
  return Number(r.numInsertedOrUpdatedRows ?? 0);
}

/** Tras aplicar un ajuste: las cuotas desde la fecha efectiva que no estén pagadas toman el monto nuevo. */
export async function repriceUnpaidFrom(trx: Tx, contractId: string, effectiveDate: string, newAmount: string, today = todayInSalta()): Promise<number> {
  const rows = await trx
    .selectFrom("rent_obligations")
    .select(["id", "paid_amount", "due_date"])
    .where("contract_id", "=", contractId)
    .where("concept", "=", "rent")
    .where("period_start", ">=", effectiveDate)
    .where("status", "in", ["pending", "partially_paid", "overdue"])
    .forUpdate()
    .execute();
  for (const o of rows) {
    await trx
      .updateTable("rent_obligations")
      .set({ amount: newAmount, status: obligationStatus(newAmount, o.paid_amount, o.due_date, today) })
      .where("id", "=", o.id)
      .execute();
  }
  return rows.length;
}

/** Job diario: cuotas impagas con vencimiento anterior a hoy pasan a `overdue`. Idempotente. */
export async function markOverdue(db: Executor, today = todayInSalta()): Promise<number> {
  const r = await sql`update rent_obligations set status = 'overdue'
    where status in ('pending', 'partially_paid') and due_date < ${today}::date`.execute(db);
  return Number(r.numAffectedRows ?? 0);
}
