/**
 * Liquidaciones a propietarios por contrato + propietario + mes.
 * Base: cobros NO anulados del contrato con fecha de pago hasta el fin del mes que todavía no estén en otra
 * liquidación activa (así un cobro cargado tarde entra en la próxima y nunca se liquida dos veces).
 * - Bruto del propietario: cada cobro × % de condominio, repartido en centavos por mayor resto entre propietarios.
 * - Honorario de administración: bruto × management_fee_pct, redondeo half-up a centavos.
 * - Neto = bruto − honorario − deducciones (lo exige un CHECK en la base).
 * Una sola liquidación activa (no cancelada) por contrato + propietario + mes (índice único parcial).
 */
import { pgCode, type Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, invalid, notFound } from "../errors";
import { lastOfMonth, monthLabel } from "./dates";
import { allocateCents, centsToString, parseRatio, percentOfCents, toCents } from "./decimal";
import { cancelSettlementSchema, generateSettlementSchema } from "./schema";

const PAYMENT_METHOD: Record<string, string> = { cash: "efectivo", transfer: "transferencia", check: "cheque", deposit: "depósito", other: "otro" };

export type GeneratedSettlement = { settlementId: string | null; ownerContactId: string; duplicate: boolean; netAmount: string; skipped?: string };

export async function generateSettlements(db: Database, actor: Actor, raw: unknown): Promise<GeneratedSettlement[]> {
  requirePermission(actor, "settlements.generate");
  const input = generateSettlementSchema.parse(raw);
  const periodStart = `${input.month}-01`;
  const periodEnd = lastOfMonth(periodStart);
  try {
    return await db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom("rental_contracts").selectAll().where("id", "=", input.contractId).forUpdate().executeTakeFirst();
      if (!c) throw notFound("Contrato");
      if (c.status === "draft") throw conflict("Un contrato en borrador no se liquida");
      const owners = await trx
        .selectFrom("rental_contract_parties")
        .select(["contact_id", "share_pct"])
        .where("contract_id", "=", c.id)
        .where("role", "=", "owner")
        .orderBy("contact_id")
        .execute();
      if (!owners.length) throw conflict("El contrato no tiene propietarios");
      if (input.ownerContactId && !owners.some((o) => o.contact_id === input.ownerContactId)) throw invalid("Ese contacto no es propietario del contrato");
      if (owners.length > 1 && owners.some((o) => !o.share_pct)) throw conflict("Faltan los porcentajes de los propietarios");
      if (input.deductions.length && !input.ownerContactId && owners.length > 1)
        throw invalid("Con varios propietarios, las deducciones se cargan por propietario");

      const payments = await trx
        .selectFrom("rent_payments as p")
        .innerJoin("rent_obligations as o", "o.id", "p.obligation_id")
        .select(["p.id", "p.amount", "p.paid_on", "p.method", "o.period_start", "o.concept"])
        .where("p.contract_id", "=", c.id)
        .where("p.voided_at", "is", null)
        .where("p.paid_on", "<=", periodEnd)
        .orderBy("p.paid_on")
        .orderBy("p.id")
        // Con el contrato bloqueado, FOR SHARE además impide que otra ruta anule estos cobros hasta confirmar la liquidación.
        .forShare("p")
        .execute();

      const weights = owners.map((o) => parseRatio(owners.length === 1 ? "100" : o.share_pct!));
      const targets = input.ownerContactId ? owners.filter((o) => o.contact_id === input.ownerContactId) : owners;
      const results: GeneratedSettlement[] = [];

      for (const owner of targets) {
        const idx = owners.findIndex((o) => o.contact_id === owner.contact_id);
        const existing = await trx
          .selectFrom("owner_settlements")
          .select(["id", "net_amount"])
          .where("contract_id", "=", c.id)
          .where("owner_contact_id", "=", owner.contact_id)
          .where("period_start", "=", periodStart)
          .where("status", "<>", "cancelled")
          .executeTakeFirst();
        if (existing) {
          results.push({ settlementId: existing.id, ownerContactId: owner.contact_id, duplicate: true, netAmount: existing.net_amount });
          continue;
        }
        // Cobros ya liquidados a ESTE propietario quedan fuera (en condominio cada propietario liquida su parte).
        const settled = new Set(
          (
            await trx
              .selectFrom("settlement_lines as l")
              .innerJoin("owner_settlements as s", "s.id", "l.settlement_id")
              .select("l.payment_id")
              .where("s.contract_id", "=", c.id)
              .where("s.owner_contact_id", "=", owner.contact_id)
              .where("s.status", "<>", "cancelled")
              .where("l.payment_id", "is not", null)
              .execute()
          ).map((r) => r.payment_id),
        );
        const mine = payments.filter((p) => !settled.has(p.id));
        const lines = mine.map((p) => {
          const share = allocateCents(toCents(p.amount), weights)[idx]!;
          const shareText = owners.length > 1 ? ` · ${owner.share_pct}% de ${centsToString(toCents(p.amount))}` : "";
          return {
            kind: "payment",
            description: `Cobro ${monthLabel(p.period_start)} (${p.concept === "rent" ? "alquiler" : p.concept}) del ${p.paid_on} · ${PAYMENT_METHOD[p.method] ?? p.method}${shareText}`,
            cents: share,
            payment_id: p.id,
          };
        });
        const gross = lines.reduce((a, l) => a + l.cents, 0n);
        const fee = percentOfCents(gross, c.management_fee_pct);
        const deductionsFor = input.ownerContactId || owners.length === 1 ? input.deductions : [];
        const deductions = deductionsFor.reduce((a, d) => a + toCents(d.amount), 0n);
        const net = gross - fee - deductions;
        if (net < 0n) throw invalid(`Las deducciones y honorarios superan lo cobrado (${centsToString(gross)})`);
        if (!lines.length && !deductionsFor.length) {
          results.push({ settlementId: null, ownerContactId: owner.contact_id, duplicate: false, netAmount: "0.00", skipped: "Sin cobros para liquidar" });
          continue;
        }
        const s = await trx
          .insertInto("owner_settlements")
          .values({
            contract_id: c.id,
            owner_contact_id: owner.contact_id,
            period_start: periodStart,
            currency: c.currency,
            gross_collected: centsToString(gross),
            management_fee_amount: centsToString(fee),
            other_deductions: centsToString(deductions),
            net_amount: centsToString(net),
            status: "draft",
            generated_by: actorUserId(actor),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const lineRows = [
          ...lines.map((l) => ({ settlement_id: s.id, kind: l.kind, description: l.description, amount: centsToString(l.cents), payment_id: l.payment_id })),
          ...(fee > 0n ? [{ settlement_id: s.id, kind: "management_fee", description: `Honorario de administración ${c.management_fee_pct}%`, amount: centsToString(-fee), payment_id: null }] : []),
          ...deductionsFor.map((d) => ({ settlement_id: s.id, kind: "deduction", description: d.description, amount: centsToString(-toCents(d.amount)), payment_id: null })),
        ];
        await trx.insertInto("settlement_lines").values(lineRows).execute();
        await audit(trx, actor, {
          action: "SETTLEMENT_GENERATED",
          entityType: "owner_settlement",
          entityId: s.id,
          after: { contractId: c.id, ownerContactId: owner.contact_id, periodStart, gross: centsToString(gross), fee: centsToString(fee), deductions: centsToString(deductions), net: centsToString(net), payments: lines.length },
        });
        await emitEvent(trx, actor, {
          type: "settlement.generated",
          aggregateType: "rental_contract",
          aggregateId: c.id,
          payload: { settlementId: s.id, ownerContactId: owner.contact_id, periodStart, currency: c.currency, net: centsToString(net), link: `/crm/alquileres/${c.id}` },
          dedupeKey: `settlement.generated:${s.id}`,
        });
        results.push({ settlementId: s.id, ownerContactId: owner.contact_id, duplicate: false, netAmount: centsToString(net) });
      }
      return results;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("Ya existe una liquidación activa para ese período. Recargá la página.");
    throw e;
  }
}

export async function approveSettlement(db: Database, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "settlements.approve");
  await transition(db, actor, id, "draft", "approved", "SETTLEMENT_APPROVED", { approved_by: actorUserId(actor), approved_at: new Date() });
}

export async function markSettlementPaid(db: Database, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "settlements.approve");
  await transition(db, actor, id, "approved", "paid", "SETTLEMENT_PAID", { paid_at: new Date() });
}

export async function cancelSettlement(db: Database, actor: Actor, raw: unknown): Promise<void> {
  const input = cancelSettlementSchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    const s = await trx.selectFrom("owner_settlements").select(["id", "status", "contract_id"]).where("id", "=", input.settlementId).forUpdate().executeTakeFirst();
    if (!s) throw notFound("Liquidación");
    requirePermission(actor, s.status === "draft" ? "settlements.generate" : "settlements.approve");
    if (s.status === "paid") throw conflict("Una liquidación pagada no se cancela");
    if (s.status === "cancelled") throw conflict("La liquidación ya está cancelada");
    await trx.updateTable("owner_settlements").set({ status: "cancelled", cancelled_reason: input.reason }).where("id", "=", s.id).execute();
    await audit(trx, actor, { action: "SETTLEMENT_CANCELLED", entityType: "owner_settlement", entityId: s.id, before: { status: s.status }, after: { status: "cancelled" }, metadata: { reason: input.reason, contractId: s.contract_id } });
  });
}

async function transition(db: Database, actor: Actor, id: string, from: string, to: string, action: string, extra: Record<string, unknown>) {
  await db.transaction().execute(async (trx) => {
    const s = await trx.selectFrom("owner_settlements").select(["id", "status", "contract_id"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!s) throw notFound("Liquidación");
    if (s.status === to) return;
    if (s.status !== from) throw conflict(`La liquidación está ${s.status}; no se puede pasar a ${to}`);
    await trx.updateTable("owner_settlements").set({ status: to, ...extra }).where("id", "=", id).execute();
    await audit(trx, actor, { action, entityType: "owner_settlement", entityId: id, before: { status: from }, after: { status: to }, metadata: { contractId: s.contract_id } });
  });
}
