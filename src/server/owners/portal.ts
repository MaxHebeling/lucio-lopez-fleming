/**
 * Lecturas del portal de propietarios. AISLAMIENTO: toda consulta filtra en el servidor por `actor.contactId`
 * (nunca por un id que venga de la URL sin verificar pertenencia). Un id ajeno responde "no encontrado".
 * Actividad de interesados: solo conteos agregados, nunca datos personales.
 */
import { sql, type Database, type Executor } from "../db";
import { requireOwner, type Actor, type OwnerActor } from "../auth/actor";
import { AppError, notFound } from "../errors";
import { isEnabled } from "../flags";
import { addMonths, firstOfMonth, todayInSalta } from "../rentals/dates";
import { OWNER_VISIBLE_REPORT_STATUSES } from "./visibility";

export async function requirePortalEnabled(db: Executor): Promise<void> {
  if (!(await isEnabled(db, "owner_portal"))) throw new AppError("unavailable", "El portal de propietarios no está disponible en este momento");
}

async function guard(db: Database, actor: Actor): Promise<OwnerActor> {
  requireOwner(actor);
  await requirePortalEnabled(db);
  return actor;
}

/** Subconsulta: ids de propiedades del propietario. */
function ownedPropertyIds(db: Database, contactId: string) {
  return db.selectFrom("property_owners").select("property_id").where("contact_id", "=", contactId);
}

/** Subconsulta: ids de contratos donde el propietario es parte como owner. */
function ownedContractIds(db: Database, contactId: string) {
  return db.selectFrom("rental_contract_parties").select("contract_id").where("contact_id", "=", contactId).where("role", "=", "owner");
}

export async function ownerDashboard(db: Database, actor: Actor) {
  const me = await guard(db, actor);
  const [properties, contracts, settlements, reports] = await Promise.all([
    listOwnerProperties(db, me),
    listOwnerContracts(db, me),
    listOwnerSettlements(db, me, 6),
    listOwnerReports(db, me, 6),
  ]);
  return { properties, contracts, settlements, reports };
}

export async function listOwnerProperties(db: Database, actor: Actor) {
  const me = await guard(db, actor);
  return db
    .selectFrom("properties as p")
    .leftJoin("property_types as t", "t.key", "p.type_key")
    .leftJoin("locations as l", "l.id", "p.location_id")
    .select(["p.id", "p.code", "p.title", "p.status", "p.is_published", "p.slug", "p.address_street", "p.address_number", "t.name as type_name", "l.name as location_name"])
    .where("p.id", "in", ownedPropertyIds(db, me.contactId))
    .where("p.deleted_at", "is", null)
    .orderBy("p.title")
    .execute();
}

/** Ficha de una propiedad propia: datos comerciales + actividad por mes (conteos). */
export async function getOwnerProperty(db: Database, actor: Actor, propertyId: string) {
  const me = await guard(db, actor);
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) throw notFound("Propiedad");
  const property = await db
    .selectFrom("properties as p")
    .leftJoin("property_types as t", "t.key", "p.type_key")
    .leftJoin("locations as l", "l.id", "p.location_id")
    .select(["p.id", "p.code", "p.title", "p.status", "p.is_published", "p.published_at", "p.slug", "p.address_street", "p.address_number", "t.name as type_name", "l.name as location_name"])
    .where("p.id", "=", propertyId)
    .where("p.id", "in", ownedPropertyIds(db, me.contactId))
    .where("p.deleted_at", "is", null)
    .executeTakeFirst();
  if (!property) throw notFound("Propiedad");
  const since = addMonths(firstOfMonth(todayInSalta()), -11);
  const [operations, activity, documents] = await Promise.all([
    db.selectFrom("property_operations").select(["operation", "currency", "amount", "price_hidden"]).where("property_id", "=", property.id).where("is_active", "=", true).execute(),
    sql<{ month: string; inquiries: number; visits: number }>`
      with months as (
        select to_char(m, 'YYYY-MM-01') as month from generate_series(${since}::date, ${todayInSalta()}::date, interval '1 month') m
      )
      select months.month,
        (select count(*)::int from leads l where l.property_id = ${property.id} and l.deleted_at is null
           and to_char(l.created_at at time zone 'America/Argentina/Salta', 'YYYY-MM-01') = months.month) as inquiries,
        (select count(*)::int from appointments a where a.property_id = ${property.id} and a.kind = 'visit' and a.status = 'completed'
           and to_char(a.starts_at at time zone 'America/Argentina/Salta', 'YYYY-MM-01') = months.month) as visits
      from months order by months.month desc`.execute(db),
    db
      .selectFrom("property_documents")
      .select(["id", "title", "kind", "created_at"])
      .where("property_id", "=", property.id)
      .where("visible_to_owner", "=", true)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "desc")
      .execute(),
  ]);
  return { property, operations, activity: activity.rows, documents };
}

export async function listOwnerContracts(db: Database, actor: Actor) {
  const me = await guard(db, actor);
  return db
    .selectFrom("rental_contracts as c")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select([
      "c.id",
      "c.code",
      "c.status",
      "c.start_date",
      "c.end_date",
      "c.currency",
      "c.current_rent",
      "c.next_adjustment_date",
      "c.adjustment_index_key",
      "p.title as property_title",
      sql<number>`(select count(*)::int from rent_obligations o where o.contract_id = c.id and o.status = 'overdue')`.as("overdue_count"),
    ])
    .where("c.id", "in", ownedContractIds(db, me.contactId))
    .where("c.status", "<>", "draft")
    .orderBy("c.start_date", "desc")
    .execute();
}

export async function getOwnerContract(db: Database, actor: Actor, contractId: string) {
  const me = await guard(db, actor);
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) throw notFound("Contrato");
  const contract = await db
    .selectFrom("rental_contracts as c")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select([
      "c.id",
      "c.code",
      "c.status",
      "c.start_date",
      "c.end_date",
      "c.currency",
      "c.initial_rent",
      "c.current_rent",
      "c.payment_due_day",
      "c.management_fee_pct",
      "c.adjustment_index_key",
      "c.adjustment_period_months",
      "c.next_adjustment_date",
      "p.id as property_id",
      "p.title as property_title",
    ])
    .where("c.id", "=", contractId)
    .where("c.id", "in", ownedContractIds(db, me.contactId))
    .where("c.status", "<>", "draft")
    .executeTakeFirst();
  if (!contract) throw notFound("Contrato");
  const [share, tenants, obligations, adjustments, documents] = await Promise.all([
    db.selectFrom("rental_contract_parties").select("share_pct").where("contract_id", "=", contract.id).where("contact_id", "=", me.contactId).where("role", "=", "owner").executeTakeFirst(),
    // Solo el nombre visible del inquilino: sin datos de contacto.
    db
      .selectFrom("rental_contract_parties as rp")
      .innerJoin("contacts as ct", "ct.id", "rp.contact_id")
      .select("ct.display_name")
      .where("rp.contract_id", "=", contract.id)
      .where("rp.role", "=", "tenant")
      .execute(),
    db
      .selectFrom("rent_obligations")
      .select(["id", "period_start", "due_date", "amount", "paid_amount", "currency", "status", "concept"])
      .where("contract_id", "=", contract.id)
      .where("status", "<>", "waived")
      .orderBy("period_start", "desc")
      .execute(),
    db
      .selectFrom("rent_adjustments")
      .select(["effective_date", "previous_amount", "new_amount", "index_key", "factor", "applied_at"])
      .where("contract_id", "=", contract.id)
      .where("status", "=", "applied")
      .orderBy("effective_date", "desc")
      .execute(),
    db
      .selectFrom("rental_contract_documents")
      .select(["id", "title", "kind", "created_at"])
      .where("contract_id", "=", contract.id)
      .where("visible_to_owner", "=", true)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "desc")
      .execute(),
  ]);
  return { contract, sharePct: share?.share_pct ?? null, tenants: tenants.map((t) => t.display_name), obligations, adjustments, documents };
}

export async function listOwnerSettlements(db: Database, actor: Actor, limit = 60) {
  const me = await guard(db, actor);
  return db
    .selectFrom("owner_settlements as s")
    .innerJoin("rental_contracts as c", "c.id", "s.contract_id")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select(["s.id", "s.period_start", "s.currency", "s.gross_collected", "s.management_fee_amount", "s.other_deductions", "s.net_amount", "s.status", "s.paid_at", "c.code", "p.title as property_title"])
    .where("s.owner_contact_id", "=", me.contactId)
    // Los borradores pueden cambiar: el propietario ve lo aprobado y lo pagado.
    .where("s.status", "in", ["approved", "paid"])
    .orderBy("s.period_start", "desc")
    .limit(limit)
    .execute();
}

export async function getOwnerSettlement(db: Database, actor: Actor, settlementId: string) {
  const me = await guard(db, actor);
  if (!/^[0-9a-f-]{36}$/i.test(settlementId)) throw notFound("Liquidación");
  const s = await db
    .selectFrom("owner_settlements as s")
    .innerJoin("rental_contracts as c", "c.id", "s.contract_id")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select(["s.id", "s.period_start", "s.currency", "s.gross_collected", "s.management_fee_amount", "s.other_deductions", "s.net_amount", "s.status", "s.approved_at", "s.paid_at", "c.code", "p.title as property_title"])
    .where("s.id", "=", settlementId)
    .where("s.owner_contact_id", "=", me.contactId)
    .where("s.status", "in", ["approved", "paid"])
    .executeTakeFirst();
  if (!s) throw notFound("Liquidación");
  const lines = await db.selectFrom("settlement_lines").select(["id", "kind", "description", "amount"]).where("settlement_id", "=", s.id).orderBy("kind").execute();
  return { settlement: s, lines };
}

export async function listOwnerDocuments(db: Database, actor: Actor) {
  const me = await guard(db, actor);
  const [propertyDocs, contractDocs] = await Promise.all([
    db
      .selectFrom("property_documents as d")
      .innerJoin("properties as p", "p.id", "d.property_id")
      .select(["d.id", "d.title", "d.kind", "d.created_at", "p.title as parent_title"])
      .where("d.property_id", "in", ownedPropertyIds(db, me.contactId))
      .where("d.visible_to_owner", "=", true)
      .where("d.deleted_at", "is", null)
      .execute(),
    db
      .selectFrom("rental_contract_documents as d")
      .innerJoin("rental_contracts as c", "c.id", "d.contract_id")
      .select(["d.id", "d.title", "d.kind", "d.created_at", "c.code as parent_title"])
      .where("d.contract_id", "in", ownedContractIds(db, me.contactId))
      .where("d.visible_to_owner", "=", true)
      .where("d.deleted_at", "is", null)
      .execute(),
  ]);
  return [
    ...propertyDocs.map((d) => ({ ...d, source: "propiedad" as const })),
    ...contractDocs.map((d) => ({ ...d, source: "contrato" as const })),
  ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

/** Archivo de un documento visible para el propietario (propiedad o contrato propio). null si no le pertenece. */
export async function ownerDocumentFile(db: Database, actor: Actor, source: "propiedad" | "contrato", documentId: string) {
  const me = await guard(db, actor);
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  const fileCols = ["f.id", "f.storage_driver", "f.bucket", "f.storage_key", "f.content_type", "f.original_name", "d.title"] as const;
  if (source === "propiedad") {
    return (
      (await db
        .selectFrom("property_documents as d")
        .innerJoin("files as f", "f.id", "d.file_id")
        .select(fileCols)
        .where("d.id", "=", documentId)
        .where("d.property_id", "in", ownedPropertyIds(db, me.contactId))
        .where("d.visible_to_owner", "=", true)
        .where("d.deleted_at", "is", null)
        .where("f.deleted_at", "is", null)
        .executeTakeFirst()) ?? null
    );
  }
  return (
    (await db
      .selectFrom("rental_contract_documents as d")
      .innerJoin("files as f", "f.id", "d.file_id")
      .select(fileCols)
      .where("d.id", "=", documentId)
      .where("d.contract_id", "in", ownedContractIds(db, me.contactId))
      .where("d.visible_to_owner", "=", true)
      .where("d.deleted_at", "is", null)
      .where("f.deleted_at", "is", null)
      .executeTakeFirst()) ?? null
  );
}

export async function listOwnerReports(db: Database, actor: Actor, limit = 60) {
  const me = await guard(db, actor);
  return db
    .selectFrom("owner_reports as r")
    .leftJoin("properties as p", "p.id", "r.property_id")
    .select(["r.id", "r.period_start", "r.period_end", "r.generated_at", "r.status", "p.title as property_title"])
    .where("r.owner_contact_id", "=", me.contactId)
    // Un informe recién generado lo revisa el equipo; el propietario lo ve cuando se le envió.
    .where("r.status", "in", [...OWNER_VISIBLE_REPORT_STATUSES])
    .orderBy("r.period_start", "desc")
    .limit(limit)
    .execute();
}

export async function getOwnerReport(db: Database, actor: Actor, reportId: string) {
  const me = await guard(db, actor);
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw notFound("Informe");
  const r = await db
    .selectFrom("owner_reports")
    .select(["id", "period_start", "period_end", "generated_at", "status", "data"])
    .where("id", "=", reportId)
    .where("owner_contact_id", "=", me.contactId)
    .where("status", "in", [...OWNER_VISIBLE_REPORT_STATUSES])
    .executeTakeFirst();
  if (!r) throw notFound("Informe");
  return r;
}
