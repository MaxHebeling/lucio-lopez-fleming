/**
 * Cobros. Garantías:
 * - idempotency_key obligatorio (lo genera el formulario): un doble envío o reintento devuelve el mismo pago.
 * - la cuota se bloquea (FOR UPDATE) antes de sumar: dos cobros concurrentes no pisan paid_amount.
 * - los montos se suman en centavos (bigint), nunca en float.
 * - un pago nunca se borra (trigger): se anula con motivo y permiso propio. Anular bloquea contrato → pago → cuota,
 *   el mismo orden que la liquidación, para que nunca quede liquidado un pago anulado.
 */
import type { Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid, notFound } from "../errors";
import { todayInSalta } from "./dates";
import { centsToString, toCents } from "./decimal";
import { obligationStatus } from "./obligations";
import { registerPaymentSchema, voidPaymentSchema, type RegisterPaymentInput } from "./schema";

export type RegisterPaymentResult = { paymentId: string; duplicate: boolean; obligationStatus: string; paidAmount: string };

export async function registerPayment(db: Database, actor: Actor, raw: RegisterPaymentInput): Promise<RegisterPaymentResult> {
  requirePermission(actor, "rentals.register_payment");
  const input = registerPaymentSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const ob = await trx
      .selectFrom("rent_obligations as o")
      .innerJoin("rental_contracts as c", "c.id", "o.contract_id")
      .select(["o.id", "o.contract_id", "o.amount", "o.paid_amount", "o.status", "o.due_date", "o.currency", "o.period_start", "c.status as contract_status", "c.code"])
      .where("o.id", "=", input.obligationId)
      .forUpdate("o")
      .executeTakeFirst();
    if (!ob) throw notFound("Cuota");

    // Con la cuota bloqueada, un envío repetido ya confirmado se detecta acá.
    const existing = await trx.selectFrom("rent_payments").select(["id", "obligation_id"]).where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (existing) {
      if (existing.obligation_id !== ob.id) throw conflict("La clave de envío ya se usó para otra cuota. Recargá la página.");
      return { paymentId: existing.id, duplicate: true, obligationStatus: ob.status, paidAmount: ob.paid_amount };
    }

    if (ob.status === "paid") throw conflict("La cuota ya está pagada");
    if (ob.status === "waived") throw conflict("La cuota está anulada");
    if (!["active", "ended", "terminated", "renewed"].includes(ob.contract_status)) throw conflict("El contrato no admite cobros");
    const remaining = toCents(ob.amount) - toCents(ob.paid_amount);
    const amount = toCents(input.amount);
    if (amount > remaining) throw invalid(`El monto supera el saldo pendiente (${centsToString(remaining)})`, { amount: ["Supera el saldo"] });
    if (input.paidOn > todayInSalta()) throw invalid("La fecha de pago no puede ser futura", { paidOn: ["Fecha futura"] });

    const inserted = await trx
      .insertInto("rent_payments")
      .values({
        contract_id: ob.contract_id,
        obligation_id: ob.id,
        amount: input.amount,
        currency: ob.currency,
        paid_on: input.paidOn,
        method: input.method,
        reference: input.reference ?? null,
        idempotency_key: input.idempotencyKey,
        received_by: actorUserId(actor),
      })
      .onConflict((oc) => oc.column("idempotency_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) {
      // Carrera con otro envío de la misma clave que confirmó mientras tanto.
      const again = await trx.selectFrom("rent_payments").select("id").where("idempotency_key", "=", input.idempotencyKey).executeTakeFirstOrThrow();
      return { paymentId: again.id, duplicate: true, obligationStatus: ob.status, paidAmount: ob.paid_amount };
    }

    const paid = centsToString(toCents(ob.paid_amount) + amount);
    const status = obligationStatus(ob.amount, paid, ob.due_date, todayInSalta());
    await trx.updateTable("rent_obligations").set({ paid_amount: paid, status }).where("id", "=", ob.id).execute();
    await audit(trx, actor, {
      action: "RENT_PAYMENT_REGISTERED",
      entityType: "rent_payment",
      entityId: inserted.id,
      before: { obligationId: ob.id, paidAmount: ob.paid_amount, status: ob.status },
      after: { amount: input.amount, currency: ob.currency, paidOn: input.paidOn, method: input.method, paidAmount: paid, status },
      metadata: { contractId: ob.contract_id },
    });
    await emitEvent(trx, actor, {
      type: "payment.registered",
      aggregateType: "rental_contract",
      aggregateId: ob.contract_id,
      payload: { paymentId: inserted.id, obligationId: ob.id, amount: input.amount, currency: ob.currency, periodStart: ob.period_start, link: `/crm/alquileres/${ob.contract_id}` },
      dedupeKey: `payment.registered:${inserted.id}`,
    });
    return { paymentId: inserted.id, duplicate: false, obligationStatus: status, paidAmount: paid };
  });
}

export async function voidPayment(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "rentals.void_payment");
  const input = voidPaymentSchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    // Mismo orden de bloqueos que la generación de liquidaciones (contrato → cobros): una liquidación en curso termina
    // antes (y la anulación ve sus líneas) o arranca después (y ve el pago anulado). contract_id de un pago no cambia.
    const ref = await trx.selectFrom("rent_payments").select("contract_id").where("id", "=", input.paymentId).executeTakeFirst();
    if (!ref) throw notFound("Pago");
    await trx.selectFrom("rental_contracts").select("id").where("id", "=", ref.contract_id).forUpdate().execute();
    const p = await trx.selectFrom("rent_payments").selectAll().where("id", "=", input.paymentId).forUpdate().executeTakeFirst();
    if (!p) throw notFound("Pago");
    if (p.voided_at) throw conflict("El pago ya está anulado");
    const settled = await trx
      .selectFrom("settlement_lines as l")
      .innerJoin("owner_settlements as s", "s.id", "l.settlement_id")
      .select(["s.id", "s.status"])
      .where("l.payment_id", "=", p.id)
      .where("s.status", "<>", "cancelled")
      .executeTakeFirst();
    if (settled) throw conflict("El pago está incluido en una liquidación. Cancelá primero la liquidación.");
    const ob = await trx.selectFrom("rent_obligations").selectAll().where("id", "=", p.obligation_id).forUpdate().executeTakeFirstOrThrow();
    const paid = centsToString(toCents(ob.paid_amount) - toCents(p.amount));
    if (toCents(paid) < 0n) throw new Error(`Inconsistencia: pagado negativo en cuota ${ob.id}`);
    const status = ob.status === "waived" ? "waived" : obligationStatus(ob.amount, paid, ob.due_date, todayInSalta());
    await trx.updateTable("rent_payments").set({ voided_at: new Date(), voided_by: actorUserId(actor), void_reason: input.reason }).where("id", "=", p.id).execute();
    await trx.updateTable("rent_obligations").set({ paid_amount: paid, status }).where("id", "=", ob.id).execute();
    await audit(trx, actor, {
      action: "RENT_PAYMENT_VOIDED",
      entityType: "rent_payment",
      entityId: p.id,
      before: { voided: false, obligationPaid: ob.paid_amount, obligationStatus: ob.status },
      after: { voided: true, obligationPaid: paid, obligationStatus: status },
      metadata: { reason: input.reason, contractId: p.contract_id, amount: p.amount },
    });
  });
}
