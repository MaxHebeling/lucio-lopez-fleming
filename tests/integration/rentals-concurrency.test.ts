/**
 * Carreras reales entre transacciones (conexiones distintas del pool). Para que la intercalación sea determinista,
 * una transacción auxiliar retiene un bloqueo y se espera a que las otras queden esperando en pg_stat_activity.
 */
import { describe, expect, it } from "vitest";
import { sql, type Database } from "@/server/db";
import { activateContract, createContract } from "@/server/rentals/contracts";
import { registerPayment, voidPayment } from "@/server/rentals/payments";
import { generateSettlements } from "@/server/rentals/settlements";
import { proposeRentAdjustment } from "@/server/rentals/adjustments";
import { todayInSalta } from "@/server/rentals/dates";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { contractInput, createTestContact, createTestProperty, idemKey, monthStart } from "../helpers/rentals";

async function lockWaiters(db: Database): Promise<number> {
  const r = await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`.execute(db);
  return r.rows[0]?.n ?? 0;
}

/** Espera hasta que haya `n` backends esperando un bloqueo o hasta que `settled` se cumpla (código sin el bloqueo). */
async function waitForWaiters(db: Database, n: number, settled: () => boolean = () => false, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await lockWaiters(db)) >= n || settled()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Abre una transacción que ejecuta `hold` y queda abierta hasta llamar a `release` (commit) o `abort` (rollback). */
function holdTransaction(db: Database, hold: (trx: Database) => Promise<unknown>) {
  let release!: () => void;
  let abort!: () => void;
  let ready!: () => void;
  const gate = new Promise<"commit" | "rollback">((resolve) => {
    release = () => resolve("commit");
    abort = () => resolve("rollback");
  });
  const isReady = new Promise<void>((r) => (ready = r));
  const done = db
    .transaction()
    .execute(async (trx) => {
      await hold(trx as unknown as Database);
      ready();
      if ((await gate) === "rollback") throw new Error("rollback intencional");
    })
    .catch((e: Error) => {
      if (e.message !== "rollback intencional") throw e;
    });
  return { ready: isReady, release, abort, done };
}

function tracked<T>(p: Promise<T>) {
  const state = { settled: false };
  const promise = p.finally(() => (state.settled = true));
  promise.catch(() => undefined);
  return { promise, state };
}

async function paidContract() {
  const db = testDb();
  const staff = await createStaff(db, ["direccion"]);
  const owner = await createTestContact(db, "Propietaria Carrera");
  const tenant = await createTestContact(db, "Inquilino Carrera");
  const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
  const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner }], [{ contactId: tenant }]));
  await activateContract(db, staff, c.id);
  const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", c.id).orderBy("period_start").executeTakeFirstOrThrow();
  const pay = await registerPayment(db, staff, { obligationId: ob.id, amount: "450000", paidOn: todayInSalta(), method: "transfer", idempotencyKey: idemKey() });
  return { db, staff, owner, contractId: c.id, obligationId: ob.id, paymentId: pay.paymentId, month: todayInSalta().slice(0, 7) };
}

async function settledVoidedPayments(db: Database, contractId: string): Promise<number> {
  const r = await sql<{ n: number }>`select count(*)::int as n from settlement_lines l
      join owner_settlements s on s.id = l.settlement_id
      join rent_payments p on p.id = l.payment_id
     where s.contract_id = ${contractId} and s.status <> 'cancelled' and p.voided_at is not null`.execute(db);
  return r.rows[0]!.n;
}

describe("liquidación vs anulación de cobro (concurrencia)", () => {
  it("anulación en curso mientras se genera la liquidación: la liquidación no incluye el pago anulado", async () => {
    const { db, staff, contractId, obligationId, paymentId, month } = await paidContract();
    // La anulación queda frenada a mitad de camino (cuota bloqueada por otra transacción).
    const holder = holdTransaction(db, (trx) => trx.selectFrom("rent_obligations").select("id").where("id", "=", obligationId).forUpdate().execute());
    await holder.ready;
    const voiding = tracked(voidPayment(db, staff, { paymentId, reason: "Transferencia rechazada por el banco" }));
    await waitForWaiters(db, 1, () => voiding.state.settled);
    const generating = tracked(generateSettlements(db, staff, { contractId, month }));
    await waitForWaiters(db, 2, () => generating.state.settled);
    holder.release();
    await holder.done;
    const [v, g] = await Promise.allSettled([voiding.promise, generating.promise]);

    expect(await settledVoidedPayments(db, contractId)).toBe(0);
    expect(v.status).toBe("fulfilled");
    expect(g.status).toBe("fulfilled");
    const payment = await db.selectFrom("rent_payments").select("voided_at").where("id", "=", paymentId).executeTakeFirstOrThrow();
    expect(payment.voided_at).not.toBeNull();
  });

  it("liquidación en curso mientras se anula: la anulación espera y se rechaza porque el pago quedó liquidado", async () => {
    const { db, staff, owner, contractId, paymentId, month } = await paidContract();
    // La generación queda frenada DESPUÉS de leer los cobros: otra transacción bloquea la fila del propietario y el
    // INSERT de la liquidación espera en la verificación de su clave foránea.
    const holder = holdTransaction(db, (trx) => trx.selectFrom("contacts").select("id").where("id", "=", owner).forUpdate().execute());
    await holder.ready;
    const generating = tracked(generateSettlements(db, staff, { contractId, month }));
    await waitForWaiters(db, 1, () => generating.state.settled);
    const voiding = tracked(voidPayment(db, staff, { paymentId, reason: "Transferencia rechazada por el banco" }));
    await waitForWaiters(db, 2, () => voiding.state.settled, 1500);
    holder.release();
    await holder.done;
    const [g, v] = await Promise.allSettled([generating.promise, voiding.promise]);

    expect(await settledVoidedPayments(db, contractId)).toBe(0);
    expect(g.status).toBe("fulfilled");
    expect(v.status).toBe("rejected");
    expect((v as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
    expect((await db.selectFrom("rent_payments").select("voided_at").where("id", "=", paymentId).executeTakeFirstOrThrow()).voided_at).toBeNull();
  });
});

describe("ajustes: fallback ante choque de índice único", () => {
  it("devuelve el ajuste del contrato Y la fecha efectiva en disputa, no otro ajuste vivo del contrato", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createTestContact(db, "Propietario Ajuste");
    const tenant = await createTestContact(db, "Inquilina Ajuste");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    const c = await createContract(
      db,
      staff,
      contractInput(property.id, [{ contactId: owner }], [{ contactId: tenant }], { startDate: monthStart(-3), endDate: monthStart(21), adjustmentIndexKey: "ICL", adjustmentPeriodMonths: 3, initialRent: "250000" }),
    );
    await activateContract(db, staff, c.id);
    await db
      .insertInto("index_values")
      .values([
        { index_key: "ICL", period_date: monthStart(-3), value: "12.34", source: "import" },
        { index_key: "ICL", period_date: monthStart(0), value: "15.67", source: "import" },
      ])
      .onConflict((oc) => oc.columns(["index_key", "period_date"]).doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })))
      .execute();
    const effective = monthStart(0);
    // Otro ajuste vivo del mismo contrato (fecha futura), calculado más recientemente
    const other = await db
      .insertInto("rent_adjustments")
      .values({ contract_id: c.id, effective_date: monthStart(3), previous_amount: "250000", new_amount: "260000", factor: "1.04", method: "manual", status: "proposed", calculated_at: new Date() })
      .returning("id")
      .executeTakeFirstOrThrow();
    // Una transacción concurrente (sin confirmar) propone el ajuste de la fecha efectiva: el INSERT del servicio choca.
    let racingId = "";
    // Sin triggers de FK en esa transacción: así no toma FOR KEY SHARE sobre el contrato y el servicio llega hasta el INSERT.
    const holder = holdTransaction(db, async (trx) => {
      await sql`set local session_replication_role = replica`.execute(trx);
      const r = await trx
        .insertInto("rent_adjustments")
        .values({ contract_id: c.id, effective_date: effective, previous_amount: "250000", new_amount: "317463.53", factor: "1.26985413", method: "index", index_key: "ICL", status: "proposed", calculated_at: new Date(Date.now() - 86_400_000) })
        .returning("id")
        .executeTakeFirstOrThrow();
      racingId = r.id;
    });
    await holder.ready;
    const proposing = tracked(proposeRentAdjustment(db, await testSystemActor(db), c.id, { auto: true }));
    await waitForWaiters(db, 1, () => proposing.state.settled);
    holder.release();
    await holder.done;
    const result = await proposing.promise;
    expect(result).toEqual({ status: "exists", adjustmentId: racingId });
    expect(racingId).not.toBe(other.id);
  });
});
