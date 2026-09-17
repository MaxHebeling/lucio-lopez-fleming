/**
 * Motor de alquileres contra Postgres real. Los valores de índices insertados acá son FIXTURES DE TEST
 * (source = 'import'), no valores oficiales.
 */
import { describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { AppError } from "@/server/errors";
import { activateContract, createContract, endContract, renewContract, updateContract } from "@/server/rentals/contracts";
import { registerPayment, voidPayment } from "@/server/rentals/payments";
import { applyRentAdjustment, proposeRentAdjustment, rejectRentAdjustment } from "@/server/rentals/adjustments";
import { generateSettlements, approveSettlement, cancelSettlement, markSettlementPaid } from "@/server/rentals/settlements";
import { fetchIndicesFromBcra, setManualIndexValue } from "@/server/rentals/indices";
import { markOverdue } from "@/server/rentals/obligations";
import { addMonths, todayInSalta } from "@/server/rentals/dates";
import { monthlyCoefficientFromPct } from "@/server/rentals/adjustment-calc";
import { resetFlagCache } from "@/server/flags";
import { createStaff, testDb, testSystemActor } from "../helpers/db";
import { contractInput, createTestContact, createTestProperty, idemKey, monthStart } from "../helpers/rentals";

async function activeContract(overrides: Record<string, unknown> = {}, ownerShares?: string[]) {
  const db = testDb();
  const staff = await createStaff(db, ["alquileres"]);
  const ownerIds = [];
  for (const [i, share] of (ownerShares ?? [undefined]).entries()) ownerIds.push({ contactId: await createTestContact(db, `Propietaria ${i}`), sharePct: share });
  const tenant = await createTestContact(db, "Inquilino Test", `inquilino-${crypto.randomUUID().slice(0, 8)}@test.local`);
  const property = await createTestProperty(db, { ownerContactIds: ownerIds.map((o) => ({ id: o.contactId, share: o.sharePct })) });
  const c = await createContract(db, staff, contractInput(property.id, ownerIds, [{ contactId: tenant }], overrides));
  await activateContract(db, staff, c.id);
  return { db, staff, contractId: c.id, code: c.code, property, owners: ownerIds.map((o) => o.contactId), tenant };
}

describe("contratos", () => {
  it("alta → activación: cuotas, propiedad alquilada, auditoría y evento en la misma transacción", async () => {
    const db = testDb();
    const staff = await createStaff(db, ["alquileres"]);
    const owner = await createTestContact(db, "María Propietaria");
    const property = await createTestProperty(db, { ownerContactIds: [{ id: owner }] });
    const c = await createContract(db, staff, contractInput(property.id, [{ contactId: owner }], [{ name: "Juan Inquilino", email: "juan.inquilino@test.local" }]));
    expect(c.code).toBe(`ALQ-${property.code}-${monthStart(-2).slice(0, 4)}${monthStart(-2).slice(5, 7)}`);

    const draft = await db.selectFrom("rental_contracts").selectAll().where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(draft).toMatchObject({ status: "draft", current_rent: "450000.00", management_fee_pct: "8.00", next_adjustment_date: null });
    const tenantRole = await db
      .selectFrom("rental_contract_parties as rp")
      .innerJoin("contact_roles as cr", "cr.contact_id", "rp.contact_id")
      .select("cr.role")
      .where("rp.contract_id", "=", c.id)
      .where("rp.role", "=", "tenant")
      .execute();
    expect(tenantRole.map((r) => r.role)).toContain("tenant");

    const r = await activateContract(db, staff, c.id);
    expect(r).toEqual({ obligations: 24, propertyMarkedRented: true });
    const obligations = await db.selectFrom("rent_obligations").select(["period_start", "due_date", "amount", "status"]).where("contract_id", "=", c.id).orderBy("period_start").execute();
    expect(obligations).toHaveLength(24);
    expect(obligations[0]).toMatchObject({ period_start: monthStart(-2), due_date: `${monthStart(-2).slice(0, 8)}10`, amount: "450000.00", status: "overdue" });
    expect(obligations.at(-1)?.period_start).toBe(monthStart(21));

    const prop = await db.selectFrom("properties").select("status").where("id", "=", property.id).executeTakeFirstOrThrow();
    expect(prop.status).toBe("rented");
    const history = await db.selectFrom("property_status_history").select(["to_status", "reason"]).where("property_id", "=", property.id).execute();
    expect(history).toEqual([{ to_status: "rented", reason: `Contrato ${c.code} activado` }]);

    const actions = (await db.selectFrom("audit_logs").select("action").where("entity_id", "=", c.id).orderBy("id").execute()).map((a) => a.action);
    expect(actions).toEqual(["RENTAL_CONTRACT_CREATED", "RENTAL_CONTRACT_ACTIVATED"]);
    const events = await db.selectFrom("domain_events").select("event_type").where("aggregate_id", "=", c.id).execute();
    expect(events.map((e) => e.event_type)).toEqual(["contract.created"]);

    await expect(activateContract(db, staff, c.id)).rejects.toThrow(/borrador/);
    // La generación es idempotente
    expect((await db.selectFrom("rent_obligations").select(sql<number>`count(*)::int`.as("n")).where("contract_id", "=", c.id).executeTakeFirstOrThrow()).n).toBe(24);
  });

  it("no se activan dos contratos superpuestos sobre la misma propiedad", async () => {
    const { db, staff, property, owners, tenant } = await activeContract();
    const other = await createContract(db, staff, contractInput(property.id, [{ contactId: owners[0]! }], [{ contactId: tenant }], { startDate: monthStart(6), endDate: monthStart(30) }));
    await expect(activateContract(db, staff, other.id)).rejects.toThrow(/contrato vigente/);
  });

  it("validaciones del servidor: permisos, índice solo en pesos, porcentajes de condominio", async () => {
    const db = testDb();
    const agent = await createStaff(db, ["agente"]);
    const staff = await createStaff(db, ["alquileres"]);
    const o1 = await createTestContact(db, "Dueño 1");
    const o2 = await createTestContact(db, "Dueño 2");
    const t = await createTestContact(db, "Inquilina");
    const property = await createTestProperty(db);
    await expect(createContract(db, agent, contractInput(property.id, [{ contactId: o1 }], [{ contactId: t }]))).rejects.toBeInstanceOf(AppError);
    await expect(createContract(db, staff, contractInput(property.id, [{ contactId: o1 }], [{ contactId: t }], { currency: "USD", adjustmentIndexKey: "ICL", adjustmentPeriodMonths: 3 }))).rejects.toThrow();
    await expect(createContract(db, staff, contractInput(property.id, [{ contactId: o1, sharePct: "50" }, { contactId: o2, sharePct: "40" }], [{ contactId: t }]))).rejects.toThrow(/sumar 100/);
    await expect(createContract(db, staff, contractInput(property.id, [{ contactId: o1 }], [{ contactId: t }], { startDate: `${monthStart(0).slice(0, 8)}15` }))).rejects.toThrow();
  });

  it("vigente: solo notas editables; rescisión anula cuotas futuras sin pagos; renovación vinculada", async () => {
    const { db, staff, contractId } = await activeContract();
    await updateContract(db, staff, contractId, { notes: "Llaves en oficina" });
    await updateContract(db, staff, contractId, { notes: "Llaves en oficina", initialRent: "1" }); // campos financieros ignorados
    const c = await db.selectFrom("rental_contracts").select(["notes", "initial_rent"]).where("id", "=", contractId).executeTakeFirstOrThrow();
    expect(c).toEqual({ notes: "Llaves en oficina", initial_rent: "450000.00" });

    const renewal = await renewContract(db, staff, contractId, { startDate: monthStart(22), endDate: monthStart(46), currency: "ARS", initialRent: "900000", paymentDueDay: 5, managementFeePct: "8" });
    const r = await db.selectFrom("rental_contracts").select(["status", "renewal_of_contract_id"]).where("id", "=", renewal.id).executeTakeFirstOrThrow();
    expect(r).toEqual({ status: "draft", renewal_of_contract_id: contractId });

    const res = await endContract(db, staff, contractId, { kind: "terminated", effectiveDate: todayInSalta(), reason: "Rescisión anticipada acordada" });
    expect(res.waived).toBe(21); // meses posteriores al actual
    const status = await db.selectFrom("rental_contracts").select(["status", "termination_reason"]).where("id", "=", contractId).executeTakeFirstOrThrow();
    expect(status).toEqual({ status: "terminated", termination_reason: "Rescisión anticipada acordada" });
  });
});

describe("cobros", () => {
  it("doble envío concurrente con la misma clave → un solo pago", async () => {
    const { db, staff, contractId } = await activeContract();
    const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", contractId).orderBy("period_start").executeTakeFirstOrThrow();
    const key = idemKey();
    const input = { obligationId: ob.id, amount: "200000", paidOn: todayInSalta(), method: "transfer" as const, idempotencyKey: key };
    const results = await Promise.all([registerPayment(db, staff, input), registerPayment(db, staff, input), registerPayment(db, staff, input)]);
    expect(new Set(results.map((r) => r.paymentId)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const payments = await db.selectFrom("rent_payments").select("amount").where("obligation_id", "=", ob.id).execute();
    expect(payments).toEqual([{ amount: "200000.00" }]);
    const o = await db.selectFrom("rent_obligations").select(["paid_amount", "status"]).where("id", "=", ob.id).executeTakeFirstOrThrow();
    expect(o).toEqual({ paid_amount: "200000.00", status: "overdue" });
    expect(await db.selectFrom("domain_events").select("id").where("event_type", "=", "payment.registered").where("aggregate_id", "=", contractId).execute()).toHaveLength(1);
  });

  it("cobros concurrentes con claves distintas no superan el saldo (bloqueo de fila)", async () => {
    const { db, staff, contractId } = await activeContract();
    const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", contractId).orderBy("period_start", "desc").executeTakeFirstOrThrow();
    const pay = () => registerPayment(db, staff, { obligationId: ob.id, amount: "300000", paidOn: todayInSalta(), method: "cash", idempotencyKey: idemKey() });
    const settled = await Promise.allSettled([pay(), pay()]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.find((s) => s.status === "rejected")?.reason?.message).toMatch(/saldo pendiente/);
    await registerPayment(db, staff, { obligationId: ob.id, amount: "150000.00", paidOn: todayInSalta(), method: "cash", idempotencyKey: idemKey() });
    const o = await db.selectFrom("rent_obligations").select(["paid_amount", "status"]).where("id", "=", ob.id).executeTakeFirstOrThrow();
    expect(o).toEqual({ paid_amount: "450000.00", status: "paid" });
    await expect(registerPayment(db, staff, { obligationId: ob.id, amount: "1", paidOn: todayInSalta(), method: "cash", idempotencyKey: idemKey() })).rejects.toThrow(/ya está pagada/);
  });

  it("anular requiere rentals.void_payment, no borra y recalcula la cuota; los pagos no se pueden borrar", async () => {
    const { db, staff, contractId } = await activeContract();
    const direccion = await createStaff(db, ["direccion"]);
    const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", contractId).orderBy("period_start", "desc").executeTakeFirstOrThrow();
    const p = await registerPayment(db, staff, { obligationId: ob.id, amount: "450000", paidOn: todayInSalta(), method: "cash", idempotencyKey: idemKey() });
    expect(p.obligationStatus).toBe("paid");
    await expect(voidPayment(db, staff, { paymentId: p.paymentId, reason: "Error de carga" })).rejects.toThrow(/permiso/);
    await voidPayment(db, direccion, { paymentId: p.paymentId, reason: "Error de carga" });
    const o = await db.selectFrom("rent_obligations").select(["paid_amount", "status"]).where("id", "=", ob.id).executeTakeFirstOrThrow();
    expect(o).toEqual({ paid_amount: "0.00", status: "pending" });
    await expect(voidPayment(db, direccion, { paymentId: p.paymentId, reason: "Otra vez" })).rejects.toThrow(/ya está anulado/);
    await expect(sql`delete from rent_payments where id = ${p.paymentId}`.execute(db)).rejects.toThrow(/no se borran/);
    const audit = await db.selectFrom("audit_logs").select("action").where("entity_id", "=", p.paymentId).orderBy("id").execute();
    expect(audit.map((a) => a.action)).toEqual(["RENT_PAYMENT_REGISTERED", "RENT_PAYMENT_VOIDED"]);
  });

  it("job de vencidas es idempotente", async () => {
    const { db } = await activeContract();
    await markOverdue(db);
    expect(await markOverdue(db)).toBe(0);
  });
});

describe("ajustes por índice (valores FIXTURE de test)", () => {
  async function iclContract() {
    const ctx = await activeContract({ startDate: monthStart(-3), endDate: monthStart(21), adjustmentIndexKey: "ICL", adjustmentPeriodMonths: 3, initialRent: "250000" });
    await ctx.db
      .insertInto("index_values")
      .values([
        { index_key: "ICL", period_date: monthStart(-3), value: "12.34", source: "import" },
        { index_key: "ICL", period_date: monthStart(0), value: "15.67", source: "import" },
      ])
      .onConflict((oc) => oc.columns(["index_key", "period_date"]).doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })))
      .execute();
    return ctx;
  }

  it("propone (idempotente), una persona aplica: alquiler vigente, cuotas futuras impagas y próxima fecha", async () => {
    const { db, staff, contractId } = await iclContract();
    const c0 = await db.selectFrom("rental_contracts").select("next_adjustment_date").where("id", "=", contractId).executeTakeFirstOrThrow();
    expect(c0.next_adjustment_date).toBe(monthStart(0));
    // Se paga la cuota del mes del ajuste antes de aplicarlo: no se recalcula
    const current = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", contractId).where("period_start", "=", monthStart(0)).executeTakeFirstOrThrow();
    await registerPayment(db, staff, { obligationId: current.id, amount: "250000", paidOn: todayInSalta(), method: "transfer", idempotencyKey: idemKey() });

    const system = await testSystemActor(db);
    const p1 = await proposeRentAdjustment(db, system, contractId, { auto: true });
    expect(p1).toMatchObject({ status: "proposed", newAmount: "317463.53", factor: "1.26985413" });
    const p2 = await proposeRentAdjustment(db, staff, contractId);
    expect(p2).toEqual({ status: "exists", adjustmentId: (p1 as { adjustmentId: string }).adjustmentId });
    const adj = await db.selectFrom("rent_adjustments").selectAll().where("contract_id", "=", contractId).executeTakeFirstOrThrow();
    expect(adj).toMatchObject({ status: "proposed", previous_amount: "250000.00", new_amount: "317463.53", index_start_value: "12.34000000", index_end_value: "15.67000000", index_start_date: monthStart(-3), index_end_date: monthStart(0) });
    expect(adj.calculation).toMatchObject({ rounding: "half_up_2", periodStart: monthStart(-3) });

    // El sistema nunca aplica
    await expect(applyRentAdjustment(db, system, adj.id)).rejects.toBeInstanceOf(AppError);
    const agent = await createStaff(db, ["agente"]);
    await expect(applyRentAdjustment(db, agent, adj.id)).rejects.toThrow(/permiso/);

    const applied = await applyRentAdjustment(db, staff, adj.id);
    expect(applied.nextAdjustmentDate).toBe(monthStart(3));
    const c = await db.selectFrom("rental_contracts").select(["current_rent", "next_adjustment_date"]).where("id", "=", contractId).executeTakeFirstOrThrow();
    expect(c).toEqual({ current_rent: "317463.53", next_adjustment_date: monthStart(3) });
    const obs = await db.selectFrom("rent_obligations").select(["period_start", "amount", "status"]).where("contract_id", "=", contractId).orderBy("period_start").execute();
    expect(obs.find((o) => o.period_start === monthStart(-1))?.amount).toBe("250000.00");
    expect(obs.find((o) => o.period_start === monthStart(0))).toMatchObject({ amount: "250000.00", status: "paid" });
    expect(obs.find((o) => o.period_start === monthStart(1))?.amount).toBe("317463.53");
    expect(obs.at(-1)?.amount).toBe("317463.53");
    await expect(applyRentAdjustment(db, staff, adj.id)).rejects.toThrow(/aplicado/);
    await expect(sql`update rent_adjustments set new_amount = 1 where id = ${adj.id}`.execute(db)).rejects.toThrow(/no puede modificarse/);
  });

  it("faltan valores → no calcula y deja aviso; rechazo con motivo permite recalcular o saltear el período", async () => {
    const { db, staff, contractId } = await activeContract({ startDate: monthStart(-3), endDate: monthStart(21), adjustmentIndexKey: "CER", adjustmentPeriodMonths: 3 });
    await sql`delete from index_values where index_key = 'CER'`.execute(db);
    const missing = await proposeRentAdjustment(db, staff, contractId);
    expect(missing.status).toBe("missing_values");
    const note = await db.selectFrom("rental_contracts").select("adjustment_pending_note").where("id", "=", contractId).executeTakeFirstOrThrow();
    expect(note.adjustment_pending_note).toMatch(/faltan CER/);
    expect(await db.selectFrom("rent_adjustments").select("id").where("contract_id", "=", contractId).execute()).toHaveLength(0);

    await db
      .insertInto("index_values")
      .values([
        { index_key: "CER", period_date: addMonths(monthStart(-3), 0), value: "700", source: "import" },
        { index_key: "CER", period_date: monthStart(0), value: "770", source: "import" },
      ])
      .execute();
    const p = await proposeRentAdjustment(db, staff, contractId);
    expect(p).toMatchObject({ status: "proposed", newAmount: "495000.00" });
    const id = (p as { adjustmentId: string }).adjustmentId;
    await expect(rejectRentAdjustment(db, staff, { adjustmentId: id, reason: "", skipPeriod: false })).rejects.toThrow();
    await rejectRentAdjustment(db, staff, { adjustmentId: id, reason: "El propietario pidió no ajustar", skipPeriod: false });
    // Automático no recalcula lo que una persona rechazó; manual sí
    const system = await testSystemActor(db);
    expect((await proposeRentAdjustment(db, system, contractId, { auto: true })).status).toBe("rejected_pending_review");
    const again = await proposeRentAdjustment(db, staff, contractId);
    expect(again.status).toBe("proposed");
    await rejectRentAdjustment(db, staff, { adjustmentId: (again as { adjustmentId: string }).adjustmentId, reason: "Se mantiene el valor", skipPeriod: true });
    const c = await db.selectFrom("rental_contracts").select(["current_rent", "next_adjustment_date"]).where("id", "=", contractId).executeTakeFirstOrThrow();
    expect(c).toEqual({ current_rent: "450000.00", next_adjustment_date: monthStart(3) });
  });

  it("IPC con carga manual auditada: producto de variaciones mensuales", async () => {
    const { db, staff, contractId } = await activeContract({ startDate: monthStart(-3), endDate: monthStart(21), adjustmentIndexKey: "IPC", adjustmentPeriodMonths: 3, initialRent: "180000" });
    const agent = await createStaff(db, ["agente"]);
    await expect(setManualIndexValue(db, agent, { indexKey: "IPC", month: monthStart(-3).slice(0, 7), variationPct: "2.5" })).rejects.toThrow(/permiso/);
    await expect(setManualIndexValue(db, staff, { indexKey: "IPC", month: monthStart(2).slice(0, 7), variationPct: "2.5" })).rejects.toThrow(/todavía no empezó/);
    await setManualIndexValue(db, staff, { indexKey: "IPC", month: monthStart(-3).slice(0, 7), variationPct: "2.5" });
    await setManualIndexValue(db, staff, { indexKey: "IPC", month: monthStart(-2).slice(0, 7), variationPct: "9" });
    expect((await proposeRentAdjustment(db, staff, contractId)).status).toBe("missing_values");
    await setManualIndexValue(db, staff, { indexKey: "IPC", month: monthStart(-2).slice(0, 7), variationPct: "3" }); // corrección
    await setManualIndexValue(db, staff, { indexKey: "IPC", month: monthStart(-1).slice(0, 7), variationPct: "2,0" });
    const p = await proposeRentAdjustment(db, staff, contractId);
    expect(p).toMatchObject({ status: "proposed", newAmount: "193835.70", factor: "1.07686500" });
    const audit = await db.selectFrom("audit_logs").select(["action", "before", "after"]).where("entity_type", "=", "index_value").where("entity_id", "=", `IPC:${monthStart(-2)}`).orderBy("id").execute();
    expect(audit.map((a) => a.action)).toEqual(["INDEX_VALUE_LOADED", "INDEX_VALUE_CORRECTED"]);
    expect(audit[1]?.before).toMatchObject({ value: monthlyCoefficientFromPct("9") });
  });

  it("descarga BCRA (respuesta simulada): idempotente por fecha, respeta el flag y registra fallas", async () => {
    const db = testDb();
    await sql`delete from index_values where index_key in ('ICL','CER')`.execute(db);
    const today = todayInSalta();
    const make = (id: number, valor: number) =>
      JSON.stringify({ status: 200, metadata: { resultset: { count: 1, offset: 0, limit: 3000 } }, results: [{ idVariable: id, detalle: [{ fecha: today, valor }] }] });
    const fetchImpl = async (url: string) => new Response(url.includes("/40?") ? make(40, 36.21) : make(30, 840.64786033), { status: 200 });
    const r1 = await fetchIndicesFromBcra(db, { fetchImpl });
    expect(r1.results.map((r) => [r.index, r.inserted])).toEqual([["ICL", 1], ["CER", 1]]);
    const r2 = await fetchIndicesFromBcra(db, { fetchImpl });
    expect(r2.results.map((r) => [r.inserted, r.updated])).toEqual([[0, 0], [0, 0]]);
    const values = await db.selectFrom("index_values").select(["index_key", "value", "source"]).where("period_date", "=", today).where("index_key", "in", ["ICL", "CER"]).orderBy("index_key").execute();
    expect(values).toEqual([
      { index_key: "CER", value: "840.64786033", source: "bcra_api" },
      { index_key: "ICL", value: "36.21000000", source: "bcra_api" },
    ]);

    await db.updateTable("feature_flags").set({ enabled: false }).where("key", "=", "rent_index_fetch").execute();
    resetFlagCache();
    expect(await fetchIndicesFromBcra(db, { fetchImpl })).toEqual({ skipped: "flag_off", results: [] });
    await db.updateTable("feature_flags").set({ enabled: true }).where("key", "=", "rent_index_fetch").execute();
    resetFlagCache();

    const failing = async () => new Response("mantenimiento", { status: 400 });
    const r3 = await fetchIndicesFromBcra(db, { fetchImpl: failing });
    expect(r3.results.every((r) => r.error)).toBe(true);
    const logs = await db.selectFrom("integration_logs").select(["status", "operation"]).where("integration_key", "=", "bcra").orderBy("id", "desc").limit(2).execute();
    expect(logs.every((l) => l.status === "error")).toBe(true);
    await db.updateTable("integrations").set({ consecutive_failures: 0, circuit_open_until: null, status: "active" }).where("key", "=", "bcra").execute();
  });
});

describe("liquidaciones", () => {
  it("bruto, honorario half-up, deducciones y neto; idempotente; cancelar y regenerar", async () => {
    const { db, staff, contractId, owners } = await activeContract({ initialRent: "123456.78", managementFeePct: "8.5" });
    const approver = await createStaff(db, ["direccion"]);
    const obs = await db.selectFrom("rent_obligations").select(["id"]).where("contract_id", "=", contractId).orderBy("period_start").limit(2).execute();
    const month = todayInSalta().slice(0, 7);
    await registerPayment(db, staff, { obligationId: obs[0]!.id, amount: "123456.78", paidOn: todayInSalta(), method: "transfer", idempotencyKey: idemKey() });
    await registerPayment(db, staff, { obligationId: obs[1]!.id, amount: "100000.00", paidOn: todayInSalta(), method: "cash", idempotencyKey: idemKey() });

    const [s] = await generateSettlements(db, staff, { contractId, month, deductions: [{ description: "Reparación de canilla", amount: "15000.50" }] });
    const row = await db.selectFrom("owner_settlements").selectAll().where("id", "=", s!.settlementId!).executeTakeFirstOrThrow();
    // bruto 223456.78 · honorario 8.5% = 18993.8263 → 18993.83 · neto = 223456.78 − 18993.83 − 15000.50 = 189462.45
    expect(row).toMatchObject({ owner_contact_id: owners[0], gross_collected: "223456.78", management_fee_amount: "18993.83", other_deductions: "15000.50", net_amount: "189462.45", status: "draft" });
    const lines = await db.selectFrom("settlement_lines").select(["kind", "amount"]).where("settlement_id", "=", row.id).orderBy("kind").orderBy("amount").execute();
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([
      ["deduction", "-15000.50"],
      ["management_fee", "-18993.83"],
      ["payment", "100000.00"],
      ["payment", "123456.78"],
    ]);
    const again = await generateSettlements(db, staff, { contractId, month });
    expect(again[0]).toMatchObject({ settlementId: row.id, duplicate: true });

    // Un pago liquidado no se anula sin cancelar la liquidación
    const pay = await db.selectFrom("rent_payments").select("id").where("contract_id", "=", contractId).executeTakeFirstOrThrow();
    await expect(voidPayment(db, approver, { paymentId: pay.id, reason: "error" })).rejects.toThrow(/liquidación/);

    await expect(approveSettlement(db, staff, row.id)).rejects.toThrow(/permiso/);
    await approveSettlement(db, approver, row.id);
    await markSettlementPaid(db, approver, row.id);
    await expect(cancelSettlement(db, approver, { settlementId: row.id, reason: "error" })).rejects.toThrow(/pagada/);
    expect((await db.selectFrom("domain_events").select("id").where("event_type", "=", "settlement.generated").where("aggregate_id", "=", contractId).execute()).length).toBe(1);
  });

  it("condominio 50/50: los centavos impares se reparten sin perder ni duplicar", async () => {
    const { db, staff, contractId } = await activeContract({ initialRent: "100000.01", managementFeePct: "0" }, ["50", "50"]);
    const direccion = await createStaff(db, ["direccion"]);
    const ob = await db.selectFrom("rent_obligations").select("id").where("contract_id", "=", contractId).orderBy("period_start").executeTakeFirstOrThrow();
    await registerPayment(db, staff, { obligationId: ob.id, amount: "100000.01", paidOn: todayInSalta(), method: "transfer", idempotencyKey: idemKey() });
    const res = await generateSettlements(db, staff, { contractId, month: todayInSalta().slice(0, 7) });
    expect(res).toHaveLength(2);
    const rows = await db.selectFrom("owner_settlements").select(["gross_collected", "net_amount"]).where("contract_id", "=", contractId).execute();
    expect(rows.map((r) => r.gross_collected).sort()).toEqual(["50000.00", "50000.01"]);
    // Cancelar una y regenerar: vuelve a tomar el mismo cobro para ese propietario, sin duplicar el del otro
    const first = res[0]!.settlementId!;
    await cancelSettlement(db, direccion, { settlementId: first, reason: "Revisión" });
    const regen = await generateSettlements(db, staff, { contractId, month: todayInSalta().slice(0, 7) });
    expect(regen.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await db.selectFrom("owner_settlements").select("id").where("contract_id", "=", contractId).where("status", "<>", "cancelled").execute()).length).toBe(2);
  });
});
