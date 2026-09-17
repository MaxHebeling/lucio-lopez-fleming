/**
 * Tareas periódicas y acciones de automatización del módulo de alquileres.
 * Todas idempotentes: eventos con dedupe_key por entidad + fecha, cuotas con unique, mensajes con dedupe por evento.
 */
import { z } from "zod";
import { sql, type Database } from "../db";
import type { Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { PermanentJobError, registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { registerAction, type ActionContext } from "../automation/actions";
import { queueMessage } from "../messaging/outbound";
import { buildWhatsAppTemplate } from "../messaging/templates";
import { log } from "../log";
import { addDays, monthLabel, todayInSalta } from "./dates";
import { centsToString, toCents } from "./decimal";
import { generateMissingObligations } from "./contracts";
import { markOverdue } from "./obligations";
import { contractsWithAdjustmentDue, proposeRentAdjustment, retryPendingAdjustments } from "./adjustments";
import { fetchIndicesFromBcra } from "./indices";
import { syncReportDeliveryStatus } from "../reports/service";

async function settingNumber(db: Database, key: string, fallback: number): Promise<number> {
  const s = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
  const n = Number(s?.value);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : fallback;
}

/** contract.expiring: contratos vigentes que vencen dentro de rentals.expiring_notice_days. Un evento por contrato y fecha de fin. */
export async function emitExpiringContracts(db: Database, actor: Actor, today = todayInSalta()): Promise<number> {
  const days = await settingNumber(db, "rentals.expiring_notice_days", 60);
  const rows = await db
    .selectFrom("rental_contracts as c")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select(["c.id", "c.code", "c.end_date", "p.title"])
    .where("c.status", "=", "active")
    .where("c.end_date", ">=", today)
    .where("c.end_date", "<=", addDays(today, days))
    .execute();
  let n = 0;
  for (const c of rows) {
    const id = await emitEvent(db, actor, {
      type: "contract.expiring",
      aggregateType: "rental_contract",
      aggregateId: c.id,
      payload: { code: c.code, endDate: c.end_date, summary: `El contrato ${c.code} (${c.title}) vence el ${c.end_date}`, link: `/crm/alquileres/${c.id}` },
      dedupeKey: `contract.expiring:${c.id}:${c.end_date}`,
    });
    if (id) n++;
  }
  return n;
}

/** rent.due: cuotas impagas que vencen dentro de rentals.due_reminder_days. Un evento por cuota y vencimiento. */
export async function emitRentDue(db: Database, actor: Actor, today = todayInSalta()): Promise<number> {
  const days = await settingNumber(db, "rentals.due_reminder_days", 3);
  const rows = await db
    .selectFrom("rent_obligations as o")
    .innerJoin("rental_contracts as c", "c.id", "o.contract_id")
    .select(["o.id", "o.due_date", "o.amount", "o.paid_amount", "o.currency", "o.period_start", "c.id as contract_id", "c.code"])
    .where("c.status", "=", "active")
    .where("o.status", "in", ["pending", "partially_paid"])
    .where("o.due_date", ">=", today)
    .where("o.due_date", "<=", addDays(today, days))
    .execute();
  let n = 0;
  for (const o of rows) {
    const id = await emitEvent(db, actor, {
      type: "rent.due",
      aggregateType: "rent_obligation",
      aggregateId: o.id,
      payload: {
        contractId: o.contract_id,
        code: o.code,
        dueDate: o.due_date,
        periodStart: o.period_start,
        amount: o.amount,
        paidAmount: o.paid_amount,
        currency: o.currency,
        link: `/crm/alquileres/${o.contract_id}`,
      },
      dedupeKey: `rent.due:${o.id}:${o.due_date}`,
    });
    if (id) n++;
  }
  return n;
}

/** rent_adjustment.due: ajustes que vencen en los próximos 7 días. Un evento por contrato y fecha de ajuste. */
export async function emitAdjustmentsDue(db: Database, actor: Actor, today = todayInSalta()): Promise<number> {
  const rows = await contractsWithAdjustmentDue(db, today, 7);
  let n = 0;
  for (const c of rows) {
    const id = await emitEvent(db, actor, {
      type: "rent_adjustment.due",
      aggregateType: "rental_contract",
      aggregateId: c.id,
      payload: {
        contractId: c.id,
        code: c.code,
        effectiveDate: c.next_adjustment_date,
        indexKey: c.adjustment_index_key,
        summary: `Ajuste ${c.adjustment_index_key} del contrato ${c.code} desde ${c.next_adjustment_date}`,
        link: `/crm/alquileres/${c.id}`,
      },
      dedupeKey: `rent_adjustment.due:${c.id}:${c.next_adjustment_date}`,
    });
    if (id) n++;
  }
  return n;
}

// ───────────── Tareas periódicas ─────────────

addScheduledTask({ type: "rentals.fetch_indices", every: "daily", timeoutMs: 120_000 });
addScheduledTask({ type: "rentals.generate_obligations", every: "daily", timeoutMs: 120_000 });
addScheduledTask({ type: "rentals.mark_overdue", every: "daily" });
addScheduledTask({ type: "rentals.expiring_contracts", every: "daily" });
addScheduledTask({ type: "rentals.due_reminders", every: "daily" });
addScheduledTask({ type: "rentals.adjustments_due", every: "daily", timeoutMs: 120_000 });
addScheduledTask({ type: "reports.sync_delivery", every: "hourly" });

registerJobHandler("rentals.fetch_indices", async (_p, { db, actor }) => {
  const r = await fetchIndicesFromBcra(db);
  const failed = r.results.filter((x) => x.error);
  // Con valores nuevos se reintentan los ajustes que esperaban índices (sin avisos repetidos).
  const retried = r.results.some((x) => x.inserted > 0) ? await retryPendingAdjustments(db, actor) : null;
  if (failed.length) throw new Error(`BCRA: ${failed.map((f) => `${f.index}: ${f.error}`).join(" | ")}`);
  return { ...r, retried };
});
registerJobHandler("rentals.generate_obligations", async (_p, { db }) => generateMissingObligations(db));
registerJobHandler("rentals.mark_overdue", async (_p, { db }) => ({ overdue: await markOverdue(db) }));
registerJobHandler("rentals.expiring_contracts", async (_p, { db, actor }) => ({ events: await emitExpiringContracts(db, actor) }));
registerJobHandler("rentals.due_reminders", async (_p, { db, actor }) => ({ events: await emitRentDue(db, actor) }));
registerJobHandler("rentals.adjustments_due", async (_p, { db, actor }) => ({
  events: await emitAdjustmentsDue(db, actor),
  retried: await retryPendingAdjustments(db, actor),
}));
registerJobHandler("reports.sync_delivery", async (_p, { db }) => syncReportDeliveryStatus(db));

// ───────────── Acciones de automatización ─────────────

function contractIdFromEvent(event: { aggregateType: string; aggregateId: string; payload: Record<string, unknown> }): string | null {
  if (event.aggregateType === "rental_contract") return event.aggregateId;
  return typeof event.payload.contractId === "string" ? event.payload.contractId : null;
}

registerAction("propose_rent_adjustment", async (_raw, ctx) => {
  const contractId = contractIdFromEvent(ctx.event);
  if (!contractId) return { skipped: "evento sin contrato" };
  const r = await proposeRentAdjustment(ctx.db, ctx.actor, contractId, { auto: true });
  return r;
});

const queueMessageParams = z.object({
  template: z.string().regex(/^[a-z0-9_]{2,60}$/),
  to: z.enum(["tenants", "owners"]),
  channel: z.enum(["auto", "email", "whatsapp"]).default("auto"),
});

type Recipient = { contact_id: string; display_name: string; email: string | null; whatsapp: string | null };

/**
 * Datos de negocio de cada plantilla que puede encolar esta acción (contrato en src/server/messaging/templates.ts).
 * Se leen de la base al ejecutar la acción, no del evento: si la cuota se pagó en el medio, no se avisa o se avisa el saldo real.
 * `dedupeKey` es de negocio (cuota + vencimiento): otro evento o una corrida a otra hora no duplican el aviso.
 */
type Prepared = { skipped: string } | { entityType: string; entityId: string; payload: (r: Recipient) => Record<string, unknown>; dedupeKey: (r: Recipient, channel: string) => string };

const PAYLOAD_BUILDERS: Record<string, (ctx: ActionContext) => Promise<Prepared>> = {
  rent_due_reminder: async (ctx) => {
    if (ctx.event.aggregateType !== "rent_obligation") throw new PermanentJobError("rent_due_reminder necesita un evento de cuota (rent.due)");
    const o = await ctx.db
      .selectFrom("rent_obligations as o")
      .innerJoin("rental_contracts as c", "c.id", "o.contract_id")
      .innerJoin("properties as p", "p.id", "c.property_id")
      .select(["o.id", "o.contract_id", "o.status", "o.amount", "o.paid_amount", "o.currency", "o.due_date", "o.period_start", "c.status as contract_status", "p.title as property_title"])
      .where("o.id", "=", ctx.event.aggregateId)
      .executeTakeFirst();
    if (!o) return { skipped: "cuota inexistente" };
    if (o.contract_status !== "active") return { skipped: "el contrato no está vigente" };
    if (!["pending", "partially_paid", "overdue"].includes(o.status)) return { skipped: `la cuota está ${o.status}` };
    const pending = toCents(o.amount) - toCents(o.paid_amount);
    if (pending <= 0n) return { skipped: "la cuota no tiene saldo pendiente" };
    const fields = {
      propertyLabel: o.property_title.slice(0, 200),
      dueDate: o.due_date,
      amount: centsToString(pending),
      currency: o.currency,
      periodLabel: monthLabel(o.period_start),
    };
    return {
      entityType: "rental_contract",
      entityId: o.contract_id,
      payload: (r) => {
        const base = { recipientName: r.display_name.slice(0, 200), ...fields };
        return { ...base, whatsappTemplate: buildWhatsAppTemplate("rent_due_reminder", base) };
      },
      dedupeKey: (r, channel) => `rent_due_reminder:${o.id}:${o.due_date}:${r.contact_id}:${channel}`,
    };
  },
};

/**
 * Encola un mensaje a los inquilinos (o propietarios) del contrato del evento, con la plantilla indicada.
 * Solo plantillas con datos definidos en PAYLOAD_BUILDERS (otra → error permanente visible en la corrida: nunca se encola
 * un mensaje que no puede renderizarse). Sin email ni WhatsApp del contacto no se inventa destino: se informa en el resultado.
 */
registerAction("queue_message", async (raw, ctx) => {
  const p = queueMessageParams.parse(raw);
  const builder = PAYLOAD_BUILDERS[p.template];
  if (!builder) throw new PermanentJobError(`queue_message: la plantilla ${p.template} no tiene datos definidos para esta acción`);
  const contractId = contractIdFromEvent(ctx.event);
  if (!contractId) return { skipped: "evento sin contrato" };
  const prepared = await builder(ctx);
  if ("skipped" in prepared) return prepared;
  const recipients = await sql<Recipient>`
    select ct.id as contact_id, ct.display_name,
      (select e.email_normalized from contact_emails e where e.contact_id = ct.id order by e.is_primary desc, e.created_at limit 1) as email,
      (select ph.phone_e164 from contact_phones ph where ph.contact_id = ct.id and ph.is_whatsapp and ph.phone_e164 is not null
        order by ph.is_primary desc, ph.created_at limit 1) as whatsapp
    from rental_contract_parties rp join contacts ct on ct.id = rp.contact_id
    where rp.contract_id = ${contractId} and rp.role = ${p.to === "tenants" ? "tenant" : "owner"} and ct.deleted_at is null`.execute(ctx.db);

  const queued: string[] = [];
  const withoutAddress: string[] = [];
  for (const r of recipients.rows) {
    const channel = p.channel === "auto" ? (r.email ? "email" : r.whatsapp ? "whatsapp" : null) : p.channel;
    const to = channel === "email" ? r.email : channel === "whatsapp" ? r.whatsapp : null;
    if (!channel || !to) {
      withoutAddress.push(r.contact_id);
      continue;
    }
    const id = await queueMessage(ctx.db, {
      channel,
      to,
      templateKey: p.template,
      payload: prepared.payload(r),
      dedupeKey: prepared.dedupeKey(r, channel),
      entityType: prepared.entityType,
      entityId: prepared.entityId,
    });
    if (id) queued.push(id);
  }
  if (withoutAddress.length) log.warn("rentals.queue_message_without_address", { contractId, contacts: withoutAddress.length, template: p.template });
  return { queued: queued.length, withoutAddress: withoutAddress.length };
});
