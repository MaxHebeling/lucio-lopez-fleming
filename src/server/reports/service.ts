/**
 * Informes a propietarios. Snapshot en owner_reports.data con datos REALES de la base (nada estimado ni inventado):
 * consultas y visitas (solo conteos), cambios de precio/estado, estado comercial, cobros y liquidaciones del período.
 * Idempotente por (propietario, propiedad|todas, inicio, fin): índice único.
 */
import { z } from "zod";
import { sql, type Database, type Executor } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { conflict, invalid, notFound } from "../errors";
import { queueMessage } from "../messaging/outbound";
import { firstOfMonth, isIsoDate, lastOfMonth, monthLabel } from "../rentals/dates";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export type ReportData = {
  version: 1;
  generatedAt: string;
  period: { start: string; end: string };
  owner: { name: string };
  scope: { propertyId: string | null };
  properties: Array<{
    id: string;
    code: number;
    title: string;
    typeName: string | null;
    status: string;
    isPublished: boolean;
    publicPath: string | null;
    inquiries: { total: number; byChannel: Array<{ channel: string; count: number }> };
    visits: { completed: number; scheduled: number; cancelled: number; noShow: number };
    priceChanges: Array<{ date: string; operation: string; previousCurrency: string | null; previousAmount: string | null; newCurrency: string; newAmount: string | null }>;
    statusChanges: Array<{ date: string; from: string | null; to: string }>;
  }>;
  rentals: {
    contracts: Array<{ code: string; propertyTitle: string; status: string; currency: string; currentRent: string; sharePct: string | null }>;
    dues: Array<{ currency: string; count: number; amount: string; paid: string; overdue: number }>;
    collected: Array<{ currency: string; count: number; amount: string }>;
    settlements: Array<{ code: string; periodStart: string; currency: string; gross: string; fee: string; deductions: string; net: string; status: string }>;
  };
};

const generateSchema = z
  .object({
    ownerContactId: z.uuid("Elegí un propietario"),
    propertyId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
    periodStart: z.string().refine(isIsoDate, "Fecha de inicio inválida"),
    periodEnd: z.string().refine(isIsoDate, "Fecha de fin inválida"),
    refresh: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ["periodEnd"], message: "El fin debe ser posterior al inicio" })
  .refine((v) => v.periodStart.slice(0, 4) >= "2000" && v.periodEnd.slice(0, 4) <= "2100", { path: ["periodStart"], message: "Período fuera de rango" });

/** Límites del período como instantes en hora de Salta: [inicio 00:00, fin+1 00:00). */
const fromTs = (d: string) => sql<Date>`(${d}::date)::timestamp at time zone 'America/Argentina/Salta'`;
const toTs = (d: string) => sql<Date>`(${d}::date + 1)::timestamp at time zone 'America/Argentina/Salta'`;

export async function buildReportData(db: Executor, ownerContactId: string, propertyId: string | null, start: string, end: string): Promise<ReportData> {
  const owner = await db.selectFrom("contacts").select(["display_name"]).where("id", "=", ownerContactId).where("deleted_at", "is", null).executeTakeFirst();
  if (!owner) throw notFound("Propietario");

  let propQ = db
    .selectFrom("properties as p")
    .innerJoin("property_owners as po", "po.property_id", "p.id")
    .leftJoin("property_types as t", "t.key", "p.type_key")
    .select(["p.id", "p.code", "p.title", "p.status", "p.is_published", "p.slug", "t.name as type_name"])
    .where("po.contact_id", "=", ownerContactId)
    .where("p.deleted_at", "is", null);
  if (propertyId) propQ = propQ.where("p.id", "=", propertyId);
  const props = await propQ.orderBy("p.title").execute();

  const properties: ReportData["properties"] = [];
  for (const p of props) {
    const [channels, visits, prices, statuses] = await Promise.all([
      db
        .selectFrom("leads as l")
        .innerJoin("lead_sources as s", "s.key", "l.source_key")
        .select(["s.channel", sql<number>`count(*)::int`.as("count")])
        .where("l.property_id", "=", p.id)
        .where("l.deleted_at", "is", null)
        .where("l.created_at", ">=", fromTs(start))
        .where("l.created_at", "<", toTs(end))
        .groupBy("s.channel")
        .orderBy("s.channel")
        .execute(),
      db
        .selectFrom("appointments")
        .select(["status", sql<number>`count(*)::int`.as("count")])
        .where("property_id", "=", p.id)
        .where("kind", "=", "visit")
        .where("starts_at", ">=", fromTs(start))
        .where("starts_at", "<", toTs(end))
        .groupBy("status")
        .execute(),
      db
        .selectFrom("property_price_history")
        .select(["changed_at", "operation", "previous_currency", "previous_amount", "new_currency", "new_amount"])
        .where("property_id", "=", p.id)
        .where("changed_at", ">=", fromTs(start))
        .where("changed_at", "<", toTs(end))
        .orderBy("changed_at")
        .execute(),
      db
        .selectFrom("property_status_history")
        .select(["changed_at", "from_status", "to_status"])
        .where("property_id", "=", p.id)
        .where("changed_at", ">=", fromTs(start))
        .where("changed_at", "<", toTs(end))
        .orderBy("changed_at")
        .execute(),
    ]);
    const v = (s: string) => visits.find((x) => x.status === s)?.count ?? 0;
    properties.push({
      id: p.id,
      code: p.code,
      title: p.title,
      typeName: p.type_name,
      status: p.status,
      isPublished: p.is_published,
      publicPath: p.is_published ? `/propiedades/${p.slug}` : null,
      inquiries: { total: channels.reduce((a, c) => a + c.count, 0), byChannel: channels.map((c) => ({ channel: c.channel, count: c.count })) },
      visits: { completed: v("completed"), scheduled: v("scheduled") + v("confirmed"), cancelled: v("cancelled"), noShow: v("no_show") },
      priceChanges: prices.map((x) => ({
        date: x.changed_at.toISOString(),
        operation: x.operation,
        previousCurrency: x.previous_currency,
        previousAmount: x.previous_amount,
        newCurrency: x.new_currency,
        newAmount: x.new_amount,
      })),
      statusChanges: statuses.map((x) => ({ date: x.changed_at.toISOString(), from: x.from_status, to: x.to_status })),
    });
  }

  let contractsQ = db
    .selectFrom("rental_contracts as c")
    .innerJoin("rental_contract_parties as rp", (j) => j.onRef("rp.contract_id", "=", "c.id").on("rp.role", "=", "owner").on("rp.contact_id", "=", ownerContactId))
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select(["c.id", "c.code", "c.status", "c.currency", "c.current_rent", "rp.share_pct", "p.title as property_title"])
    .where("c.status", "<>", "draft")
    .where("c.start_date", "<=", end)
    .where("c.end_date", ">", start);
  if (propertyId) contractsQ = contractsQ.where("c.property_id", "=", propertyId);
  const contracts = await contractsQ.orderBy("c.code").execute();
  const ids = contracts.map((c) => c.id);

  const [dues, collected, settlements] = ids.length
    ? await Promise.all([
        db
          .selectFrom("rent_obligations")
          .select([
            "currency",
            sql<number>`count(*)::int`.as("count"),
            sql<string>`sum(amount)::numeric(14,2)::text`.as("amount"),
            sql<string>`sum(paid_amount)::numeric(14,2)::text`.as("paid"),
            sql<number>`count(*) filter (where status = 'overdue')::int`.as("overdue"),
          ])
          .where("contract_id", "in", ids)
          .where("status", "<>", "waived")
          .where("due_date", ">=", start)
          .where("due_date", "<=", end)
          .groupBy("currency")
          .execute(),
        db
          .selectFrom("rent_payments")
          .select(["currency", sql<number>`count(*)::int`.as("count"), sql<string>`sum(amount)::numeric(14,2)::text`.as("amount")])
          .where("contract_id", "in", ids)
          .where("voided_at", "is", null)
          .where("paid_on", ">=", start)
          .where("paid_on", "<=", end)
          .groupBy("currency")
          .execute(),
        db
          .selectFrom("owner_settlements as s")
          .innerJoin("rental_contracts as c", "c.id", "s.contract_id")
          .select(["c.code", "s.period_start", "s.currency", "s.gross_collected", "s.management_fee_amount", "s.other_deductions", "s.net_amount", "s.status"])
          .where("s.owner_contact_id", "=", ownerContactId)
          .where("s.contract_id", "in", ids)
          .where("s.status", "in", ["approved", "paid"])
          .where("s.period_start", ">=", `${start.slice(0, 7)}-01`)
          .where("s.period_start", "<=", end)
          .orderBy("s.period_start")
          .execute(),
      ])
    : [[], [], []];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    period: { start, end },
    owner: { name: owner.display_name },
    scope: { propertyId },
    properties,
    rentals: {
      contracts: contracts.map((c) => ({ code: c.code, propertyTitle: c.property_title, status: c.status, currency: c.currency, currentRent: c.current_rent, sharePct: c.share_pct })),
      dues: dues.map((d) => ({ currency: d.currency, count: d.count, amount: d.amount, paid: d.paid, overdue: d.overdue })),
      collected: collected.map((c) => ({ currency: c.currency, count: c.count, amount: c.amount })),
      settlements: settlements.map((s) => ({
        code: s.code,
        periodStart: s.period_start,
        currency: s.currency,
        gross: s.gross_collected,
        fee: s.management_fee_amount,
        deductions: s.other_deductions,
        net: s.net_amount,
        status: s.status,
      })),
    },
  };
}

export async function generateOwnerReport(db: Database, actor: Actor, raw: unknown): Promise<{ id: string; created: boolean; refreshed: boolean }> {
  requirePermission(actor, "reports.generate");
  const input = generateSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const isOwner = await sql<{ ok: boolean }>`select (
        exists (select 1 from property_owners where contact_id = ${input.ownerContactId}
          and (${input.propertyId ?? null}::uuid is null or property_id = ${input.propertyId ?? null}::uuid))
        or exists (select 1 from rental_contract_parties rp join rental_contracts c on c.id = rp.contract_id
          where rp.contact_id = ${input.ownerContactId} and rp.role = 'owner'
          and (${input.propertyId ?? null}::uuid is null or c.property_id = ${input.propertyId ?? null}::uuid))
      ) as ok`.execute(trx);
    if (!isOwner.rows[0]?.ok) throw invalid("El contacto no es propietario de esa propiedad");
    // Serializa generaciones concurrentes del mismo informe.
    await sql`select pg_advisory_xact_lock(hashtext(${`owner_report:${input.ownerContactId}:${input.propertyId ?? ""}:${input.periodStart}:${input.periodEnd}`}))`.execute(trx);
    const existing = await trx
      .selectFrom("owner_reports")
      .select(["id", "status"])
      .where("owner_contact_id", "=", input.ownerContactId)
      .where(sql<string>`coalesce(property_id, ${ZERO_UUID}::uuid)`, "=", input.propertyId ?? ZERO_UUID)
      .where("period_start", "=", input.periodStart)
      .where("period_end", "=", input.periodEnd)
      .forUpdate()
      .executeTakeFirst();
    if (existing && !(input.refresh && existing.status === "generated")) return { id: existing.id, created: false, refreshed: false };
    const data = await buildReportData(trx, input.ownerContactId, input.propertyId ?? null, input.periodStart, input.periodEnd);
    if (existing) {
      await trx.updateTable("owner_reports").set({ data: JSON.stringify(data), generated_at: new Date(), generated_by: actorUserId(actor) }).where("id", "=", existing.id).execute();
      await audit(trx, actor, { action: "OWNER_REPORT_REFRESHED", entityType: "owner_report", entityId: existing.id });
      return { id: existing.id, created: false, refreshed: true };
    }
    const row = await trx
      .insertInto("owner_reports")
      .values({
        owner_contact_id: input.ownerContactId,
        property_id: input.propertyId ?? null,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        status: "generated",
        data: JSON.stringify(data),
        generated_by: actorUserId(actor),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await audit(trx, actor, {
      action: "OWNER_REPORT_GENERATED",
      entityType: "owner_report",
      entityId: row.id,
      after: { ownerContactId: input.ownerContactId, propertyId: input.propertyId ?? null, periodStart: input.periodStart, periodEnd: input.periodEnd },
    });
    return { id: row.id, created: true, refreshed: false };
  });
}

const SHORT_DATE = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "septiembre 2026" si el período es un mes calendario completo; si no, "01/09/2026 al 15/09/2026". */
export function reportPeriodLabel(start: string, end: string): string {
  if (start === firstOfMonth(start) && end === lastOfMonth(start)) return monthLabel(start);
  return start === end ? SHORT_DATE(start) : `${SHORT_DATE(start)} al ${SHORT_DATE(end)}`;
}

/** Encola el email `owner_report_ready` con link al portal. Requiere que el propietario tenga acceso al portal. */
export async function sendOwnerReport(db: Database, actor: Actor, reportId: string): Promise<{ messageId: string | null }> {
  requirePermission(actor, "reports.generate");
  return db.transaction().execute(async (trx) => {
    const r = await trx.selectFrom("owner_reports").select(["id", "status", "owner_contact_id", "period_start", "period_end"]).where("id", "=", reportId).forUpdate().executeTakeFirst();
    if (!r) throw notFound("Informe");
    if (!["generated", "failed"].includes(r.status)) throw conflict("El informe ya fue enviado");
    const user = await trx
      .selectFrom("users")
      .select(["id", "email", "full_name"])
      .where("contact_id", "=", r.owner_contact_id)
      .where("kind", "=", "owner")
      .where("is_active", "=", true)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!user) throw conflict("El propietario no tiene acceso al portal: invitalo primero");
    const attempts = await trx
      .selectFrom("outbound_messages")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("entity_type", "=", "owner_report")
      .where("entity_id", "=", r.id)
      .executeTakeFirst();
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const messageId = await queueMessage(trx, {
      channel: "email",
      to: user.email,
      templateKey: "owner_report_ready",
      // Contrato de la plantilla owner_report_ready (src/server/messaging/templates.ts).
      payload: { fullName: user.full_name, periodLabel: reportPeriodLabel(r.period_start, r.period_end), reportUrl: `${appUrl}/propietarios/informes/${r.id}` },
      dedupeKey: `owner_report_ready:${r.id}:${attempts?.n ?? 0}`,
      entityType: "owner_report",
      entityId: r.id,
    });
    await trx.updateTable("owner_reports").set({ status: "queued", last_error: null }).where("id", "=", r.id).execute();
    await audit(trx, actor, { action: "OWNER_REPORT_QUEUED", entityType: "owner_report", entityId: r.id, before: { status: r.status }, after: { status: "queued", to: user.email } });
    return { messageId };
  });
}

/** Job: refleja en el informe el estado real del email (enviado / entregado / fallido). */
export async function syncReportDeliveryStatus(db: Database): Promise<{ updated: number }> {
  const r = await sql`
    update owner_reports r set
      status = case m.status when 'sent' then 'sent' when 'delivered' then 'delivered' else 'failed' end,
      sent_at = case when m.status in ('sent', 'delivered') then coalesce(m.sent_at, now()) else r.sent_at end,
      last_error = case when m.status in ('failed', 'cancelled') then coalesce(m.last_error, 'Envío fallido') else null end
    from (
      select distinct on (o.entity_id) o.entity_id, o.status, o.sent_at, o.last_error
        from outbound_messages o where o.entity_type = 'owner_report'
       order by o.entity_id, o.created_at desc
    ) m
    where m.entity_id = r.id and r.status in ('queued', 'failed', 'sent')
      and m.status in ('sent', 'delivered', 'failed', 'cancelled')
      and r.status is distinct from (case m.status when 'sent' then 'sent' when 'delivered' then 'delivered' else 'failed' end)`.execute(db);
  return { updated: Number(r.numAffectedRows ?? 0) };
}

export async function listReports(db: Database, actor: Actor) {
  requirePermission(actor, "reports.read");
  return db
    .selectFrom("owner_reports as r")
    .innerJoin("contacts as c", "c.id", "r.owner_contact_id")
    .leftJoin("properties as p", "p.id", "r.property_id")
    .select(["r.id", "r.period_start", "r.period_end", "r.status", "r.generated_at", "r.sent_at", "r.last_error", "r.owner_contact_id", "c.display_name as owner_name", "p.title as property_title"])
    .orderBy("r.generated_at", "desc")
    .limit(300)
    .execute();
}

export async function getReport(db: Database, actor: Actor, id: string) {
  requirePermission(actor, "reports.read");
  const r = await db
    .selectFrom("owner_reports as r")
    .innerJoin("contacts as c", "c.id", "r.owner_contact_id")
    .select(["r.id", "r.period_start", "r.period_end", "r.status", "r.generated_at", "r.sent_at", "r.last_error", "r.data", "r.owner_contact_id", "r.property_id", "c.display_name as owner_name"])
    .where("r.id", "=", id)
    .executeTakeFirst();
  if (!r) throw notFound("Informe");
  const portalUser = await db.selectFrom("users").select(["email", "is_active"]).where("contact_id", "=", r.owner_contact_id).where("kind", "=", "owner").where("deleted_at", "is", null).executeTakeFirst();
  return { ...r, portalUser: portalUser ?? null };
}

/** Propietarios (contactos con propiedades o contratos como owner) para el formulario de informes. */
export async function listOwnersForReports(db: Database, actor: Actor) {
  requirePermission(actor, "reports.read");
  const owners = await sql<{ id: string; display_name: string }>`
    select c.id, c.display_name from contacts c
     where c.deleted_at is null and c.merged_into_id is null and (
       exists (select 1 from property_owners po where po.contact_id = c.id)
       or exists (select 1 from rental_contract_parties rp where rp.contact_id = c.id and rp.role = 'owner'))
     order by c.display_name limit 2000`.execute(db);
  const props = await db
    .selectFrom("property_owners as po")
    .innerJoin("properties as p", "p.id", "po.property_id")
    .select(["po.contact_id", "p.id", "p.code", "p.title"])
    .where("p.deleted_at", "is", null)
    .execute();
  return owners.rows.map((o) => ({ ...o, properties: props.filter((p) => p.contact_id === o.id).map((p) => ({ id: p.id, code: p.code, title: p.title })) }));
}
