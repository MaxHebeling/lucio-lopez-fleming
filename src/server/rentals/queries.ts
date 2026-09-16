/** Lecturas del CRM de alquileres. Autorización en cada función (rentals.read y afines). */
import { sql, type Database } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { addDays, todayInSalta } from "./dates";

export type ContractListFilters = { status?: string; q?: string; expiringDays?: number };

export async function listContracts(db: Database, actor: Actor, f: ContractListFilters = {}) {
  requirePermission(actor, "rentals.read");
  const today = todayInSalta();
  let q = db
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
      "c.adjustment_pending_note",
      "p.code as property_code",
      "p.title as property_title",
      sql<string | null>`(select string_agg(ct.display_name, ', ' order by ct.display_name) from rental_contract_parties rp
        join contacts ct on ct.id = rp.contact_id where rp.contract_id = c.id and rp.role = 'tenant')`.as("tenants"),
      sql<string | null>`(select string_agg(ct.display_name, ', ' order by ct.display_name) from rental_contract_parties rp
        join contacts ct on ct.id = rp.contact_id where rp.contract_id = c.id and rp.role = 'owner')`.as("owners"),
      sql<number>`(select count(*)::int from rent_obligations o where o.contract_id = c.id and o.status = 'overdue')`.as("overdue_count"),
      sql<number>`(select count(*)::int from rent_adjustments a where a.contract_id = c.id and a.status = 'proposed')`.as("proposed_adjustments"),
    ]);
  if (f.status) q = q.where("c.status", "=", f.status);
  if (f.q) {
    const term = `%${f.q.trim().slice(0, 100)}%`;
    q = q.where((eb) =>
      eb.or([
        eb("c.code", "ilike", term),
        eb("p.title", "ilike", term),
        eb(sql<string>`p.code::text`, "=", f.q!.trim()),
        eb.exists(
          eb
            .selectFrom("rental_contract_parties as rp")
            .innerJoin("contacts as ct", "ct.id", "rp.contact_id")
            .select("rp.contact_id")
            .whereRef("rp.contract_id", "=", "c.id")
            .where(sql<string>`f_unaccent(lower(ct.display_name))`, "like", sql<string>`f_unaccent(lower(${term}))`),
        ),
      ]),
    );
  }
  if (f.expiringDays) q = q.where("c.status", "=", "active").where("c.end_date", "<=", addDays(today, f.expiringDays));
  return q.orderBy(sql`case c.status when 'active' then 0 when 'draft' then 1 else 2 end`).orderBy("c.end_date").limit(300).execute();
}

export async function getContractDetail(db: Database, actor: Actor, id: string) {
  requirePermission(actor, "rentals.read");
  const contract = await db
    .selectFrom("rental_contracts as c")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .selectAll("c")
    .select(["p.code as property_code", "p.title as property_title", "p.status as property_status", "p.address_street", "p.address_number"])
    .where("c.id", "=", id)
    .executeTakeFirst();
  if (!contract) throw notFound("Contrato");
  const showContactData = can(actor, "contacts.read");
  const [parties, obligations, payments, adjustments, settlements, documents, renewals, ownerUsers] = await Promise.all([
    db
      .selectFrom("rental_contract_parties as rp")
      .innerJoin("contacts as ct", "ct.id", "rp.contact_id")
      .select([
        "rp.contact_id",
        "rp.role",
        "rp.share_pct",
        "ct.display_name",
        sql<string | null>`(select email from contact_emails e where e.contact_id = ct.id order by e.is_primary desc, e.created_at limit 1)`.as("email"),
        sql<string | null>`(select coalesce(phone_e164, phone_raw) from contact_phones ph where ph.contact_id = ct.id order by ph.is_primary desc, ph.created_at limit 1)`.as("phone"),
      ])
      .where("rp.contract_id", "=", id)
      .orderBy("rp.role")
      .orderBy("ct.display_name")
      .execute(),
    db.selectFrom("rent_obligations").selectAll().where("contract_id", "=", id).orderBy("period_start").orderBy("concept").execute(),
    db
      .selectFrom("rent_payments as pay")
      .innerJoin("rent_obligations as o", "o.id", "pay.obligation_id")
      .leftJoin("users as u", "u.id", "pay.received_by")
      .select(["pay.id", "pay.amount", "pay.currency", "pay.paid_on", "pay.method", "pay.reference", "pay.voided_at", "pay.void_reason", "pay.created_at", "o.period_start", "u.full_name as received_by_name"])
      .where("pay.contract_id", "=", id)
      .orderBy("pay.paid_on", "desc")
      .orderBy("pay.created_at", "desc")
      .execute(),
    db
      .selectFrom("rent_adjustments as a")
      .leftJoin("users as u", "u.id", "a.applied_by")
      .leftJoin("users as r", "r.id", "a.rejected_by")
      .selectAll("a")
      .select(["u.full_name as applied_by_name", "r.full_name as rejected_by_name"])
      .where("a.contract_id", "=", id)
      .orderBy("a.effective_date", "desc")
      .orderBy("a.calculated_at", "desc")
      .execute(),
    db
      .selectFrom("owner_settlements as s")
      .innerJoin("contacts as ct", "ct.id", "s.owner_contact_id")
      .selectAll("s")
      .select("ct.display_name as owner_name")
      .where("s.contract_id", "=", id)
      .orderBy("s.period_start", "desc")
      .execute(),
    db
      .selectFrom("rental_contract_documents as d")
      .innerJoin("files as f", "f.id", "d.file_id")
      .select(["d.id", "d.title", "d.kind", "d.visible_to_owner", "d.created_at", "f.content_type", "f.size_bytes"])
      .where("d.contract_id", "=", id)
      .where("d.deleted_at", "is", null)
      .orderBy("d.created_at", "desc")
      .execute(),
    db.selectFrom("rental_contracts").select(["id", "code", "status"]).where("renewal_of_contract_id", "=", id).execute(),
    db
      .selectFrom("users as u")
      .innerJoin("rental_contract_parties as rp", "rp.contact_id", "u.contact_id")
      .select(["u.contact_id", "u.email", "u.is_active", "u.last_login_at", sql<boolean>`u.password_hash is not null`.as("has_password")])
      .where("rp.contract_id", "=", id)
      .where("rp.role", "=", "owner")
      .where("u.kind", "=", "owner")
      .where("u.deleted_at", "is", null)
      .execute(),
  ]);
  const settlementLines = settlements.length
    ? await db.selectFrom("settlement_lines").selectAll().where("settlement_id", "in", settlements.map((s) => s.id)).orderBy("kind").execute()
    : [];
  const renewalOf = contract.renewal_of_contract_id
    ? await db.selectFrom("rental_contracts").select(["id", "code"]).where("id", "=", contract.renewal_of_contract_id).executeTakeFirst()
    : null;
  return {
    contract,
    parties: parties.map((p) => (showContactData ? p : { ...p, email: null, phone: null })),
    obligations,
    payments,
    adjustments,
    settlements: settlements.map((s) => ({ ...s, lines: settlementLines.filter((l) => l.settlement_id === s.id) })),
    documents,
    renewals,
    renewalOf,
    ownerUsers,
  };
}

export type ReceivableFilter = "all" | "overdue" | "due_soon";

export async function listReceivables(db: Database, actor: Actor, filter: ReceivableFilter = "all", q?: string) {
  requirePermission(actor, "rentals.read");
  const today = todayInSalta();
  let query = db
    .selectFrom("rent_obligations as o")
    .innerJoin("rental_contracts as c", "c.id", "o.contract_id")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select([
      "o.id",
      "o.period_start",
      "o.due_date",
      "o.amount",
      "o.paid_amount",
      "o.currency",
      "o.status",
      "o.concept",
      "c.id as contract_id",
      "c.code",
      "p.title as property_title",
      sql<string | null>`(select string_agg(ct.display_name, ', ') from rental_contract_parties rp join contacts ct on ct.id = rp.contact_id
        where rp.contract_id = c.id and rp.role = 'tenant')`.as("tenants"),
    ])
    .where("o.status", "in", ["pending", "partially_paid", "overdue"])
    .where("c.status", "in", ["active", "ended", "terminated", "renewed"]);
  if (filter === "overdue") query = query.where("o.status", "=", "overdue");
  else if (filter === "due_soon") query = query.where("o.due_date", ">=", today).where("o.due_date", "<=", addDays(today, 10));
  else query = query.where("o.due_date", "<=", addDays(today, 40));
  if (q?.trim()) {
    const term = `%${q.trim().slice(0, 100)}%`;
    query = query.where((eb) => eb.or([eb("c.code", "ilike", term), eb("p.title", "ilike", term)]));
  }
  return query.orderBy("o.due_date").orderBy("c.code").limit(500).execute();
}

export async function listSettlements(db: Database, actor: Actor, f: { status?: string; month?: string } = {}) {
  requirePermission(actor, "rentals.read");
  let q = db
    .selectFrom("owner_settlements as s")
    .innerJoin("rental_contracts as c", "c.id", "s.contract_id")
    .innerJoin("contacts as ct", "ct.id", "s.owner_contact_id")
    .select([
      "s.id",
      "s.period_start",
      "s.currency",
      "s.gross_collected",
      "s.management_fee_amount",
      "s.other_deductions",
      "s.net_amount",
      "s.status",
      "s.generated_at",
      "s.approved_at",
      "s.paid_at",
      "s.cancelled_reason",
      "c.id as contract_id",
      "c.code",
      "ct.display_name as owner_name",
    ]);
  if (f.status) q = q.where("s.status", "=", f.status);
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) q = q.where("s.period_start", "=", `${f.month}-01`);
  return q.orderBy("s.period_start", "desc").orderBy("c.code").limit(300).execute();
}

export async function contractsForSettlement(db: Database, actor: Actor) {
  requirePermission(actor, "rentals.read");
  return db
    .selectFrom("rental_contracts as c")
    .innerJoin("properties as p", "p.id", "c.property_id")
    .select(["c.id", "c.code", "c.status", "p.title as property_title"])
    .where("c.status", "in", ["active", "ended", "terminated", "renewed"])
    .orderBy("c.code")
    .execute();
}

export async function indicesOverview(db: Database, actor: Actor) {
  requirePermission(actor, "rentals.read");
  const [indices, latest, recentDaily, monthly, integration, logs, flag] = await Promise.all([
    db.selectFrom("adjustment_indices").selectAll().orderBy("key").execute(),
    sql<{ index_key: string; period_date: string; value: string; source: string; total: number; last_fetched: Date | null }>`
      select distinct on (v.index_key) v.index_key, v.period_date::text, v.value, v.source,
        (select count(*)::int from index_values x where x.index_key = v.index_key) as total,
        (select max(fetched_at) from index_values x where x.index_key = v.index_key) as last_fetched
      from index_values v where v.period_date <= ${todayInSalta()}::date
      order by v.index_key, v.period_date desc`.execute(db),
    db
      .selectFrom("index_values")
      .select(["index_key", "period_date", "value", "source"])
      .where("index_key", "in", ["ICL", "CER"])
      .where("period_date", ">=", addDays(todayInSalta(), -7))
      .where("period_date", "<=", addDays(todayInSalta(), 7))
      .orderBy("period_date", "desc")
      .execute(),
    db
      .selectFrom("index_values as v")
      .leftJoin("users as u", "u.id", "v.entered_by")
      .select(["v.index_key", "v.period_date", "v.value", "v.source", "v.fetched_at", "u.full_name as entered_by_name"])
      .where("v.index_key", "in", ["IPC", "CASA_PROPIA"])
      .orderBy("v.period_date", "desc")
      .limit(48)
      .execute(),
    db.selectFrom("integrations").selectAll().where("key", "=", "bcra").executeTakeFirst(),
    db.selectFrom("integration_logs").select(["operation", "status", "error", "duration_ms", "created_at"]).where("integration_key", "=", "bcra").orderBy("id", "desc").limit(10).execute(),
    db.selectFrom("feature_flags").select("enabled").where("key", "=", "rent_index_fetch").executeTakeFirst(),
  ]);
  return { indices, latest: latest.rows, recentDaily, monthly, integration, logs, fetchEnabled: Boolean(flag?.enabled) };
}

export async function propertiesForContract(db: Database, actor: Actor) {
  requirePermission(actor, "rentals.manage");
  const rows = await db
    .selectFrom("properties as p")
    .select(["p.id", "p.code", "p.title", "p.status"])
    .where("p.deleted_at", "is", null)
    .where("p.status", "<>", "archived")
    .orderBy("p.code", "desc")
    .limit(2000)
    .execute();
  const owners = rows.length
    ? await db
        .selectFrom("property_owners as po")
        .innerJoin("contacts as ct", "ct.id", "po.contact_id")
        .select(["po.property_id", "po.contact_id", "po.share_pct", "ct.display_name"])
        .where("ct.deleted_at", "is", null)
        .execute()
    : [];
  return rows.map((r) => ({ ...r, owners: owners.filter((o) => o.property_id === r.id).map((o) => ({ contactId: o.contact_id, name: o.display_name, sharePct: o.share_pct })) }));
}

export async function searchContacts(db: Database, actor: Actor, q: string) {
  requirePermission(actor, "contacts.read");
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  const like = `%${term.toLowerCase()}%`;
  return db
    .selectFrom("contacts as c")
    .select([
      "c.id",
      "c.display_name",
      sql<string | null>`(select email from contact_emails e where e.contact_id = c.id order by e.is_primary desc limit 1)`.as("email"),
    ])
    .where("c.deleted_at", "is", null)
    .where("c.merged_into_id", "is", null)
    .where((eb) =>
      eb.or([
        eb(sql<string>`f_unaccent(lower(c.display_name))`, "like", sql<string>`f_unaccent(${like})`),
        eb.exists(eb.selectFrom("contact_emails as e").select("e.id").whereRef("e.contact_id", "=", "c.id").where("e.email_normalized", "like", like)),
      ]),
    )
    .orderBy("c.display_name")
    .limit(10)
    .execute();
}
