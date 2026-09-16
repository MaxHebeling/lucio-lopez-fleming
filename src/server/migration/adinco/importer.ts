/**
 * Importador Adinco → CRM. Pipeline por registro:
 * DISCOVERED → EXTRACTED → NORMALIZED → VALIDATED → IMPORTED → MEDIA VERIFIED → REVIEW REQUIRED | PUBLISHED
 *
 * Garantías:
 * - Idempotente: clave estable source+external_id (external_refs). Correrlo dos veces no duplica nada.
 * - Reiniciable: cada propiedad se importa en su propia transacción; un fallo no aborta la corrida.
 * - Incremental: si el payload de origen no cambió (raw_hash) no se reescribe.
 * - Respeta correcciones humanas: campos en protected_fields no se sobrescriben y propiedades verificadas
 *   manualmente no se tocan (se registran las diferencias como advertencias).
 * - No dispara automatizaciones masivas: una importación no genera borradores de redes ni sincronizaciones.
 */
import { createHash } from "node:crypto";
import { sql, type Database, type Tx } from "../../db";
import { audit } from "../../audit";
import { systemActor, type SystemActor } from "../../auth/actor";
import { organizationId } from "../../org";
import { normalizeEmail, normalizePhone } from "../../contacts/normalize";
import { errorFields, log } from "../../log";
import { fetchAdincoPropertyDetail, fetchAdincoRealEstate, listAdincoProperties, mapLimit, type AdincoRealEstate } from "./client";
import { ADINCO_SOURCE, hasBlockingWarning, mapAdincoProperty, type MigrationWarning, type NormalizedProperty } from "./map";

export type ImportOptions = {
  fetchImpl?: typeof fetch;
  limit?: number;
  codes?: number[];
  verifyMedia?: boolean;
  force?: boolean;
  concurrency?: number;
  delayMs?: number;
  triggeredBy?: string;
  logger?: (msg: string) => void;
};

export type ImportStats = {
  runId: string;
  discovered: number;
  extracted: number;
  failed: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedProtected: number;
  published: number;
  reviewRequired: number;
  missingFromSource: number;
  mediaVerified: number;
  mediaFailed: number;
  warnings: { info: number; warning: number; error: number };
  agentsCreated: number;
};

type Columns = Record<string, unknown>;

const PROPERTY_FIELDS: Array<[keyof NormalizedProperty, string]> = [
  ["title", "title"],
  ["description", "description"],
  ["typeKey", "type_key"],
  ["addressStreet", "address_street"],
  ["addressNumber", "address_number"],
  ["addressFloor", "address_floor"],
  ["addressUnit", "address_unit"],
  ["hideExactAddress", "hide_exact_address"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
  ["totalAreaM2", "total_area_m2"],
  ["coveredAreaM2", "covered_area_m2"],
  ["landAreaM2", "land_area_m2"],
  ["rooms", "rooms"],
  ["bedrooms", "bedrooms"],
  ["bathrooms", "bathrooms"],
  ["garages", "garages"],
  ["ageYears", "age_years"],
  ["creditEligible", "credit_eligible"],
  ["professionalUse", "professional_use"],
  ["allowsPets", "allows_pets"],
  ["attributes", "attributes"],
];

const NUMERIC_COLUMNS = new Set(["latitude", "longitude", "total_area_m2", "covered_area_m2", "land_area_m2"]);

function toDb(column: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (column === "attributes") return JSON.stringify(v);
  if (NUMERIC_COLUMNS.has(column)) return String(v);
  return v;
}

/** Comparación tolerante a formato (numeric "230000.00" vs 230000, jsonb). */
function same(column: string, current: unknown, incoming: unknown): boolean {
  if (current === null || current === undefined) return incoming === null || incoming === undefined;
  if (incoming === null || incoming === undefined) return false;
  if (NUMERIC_COLUMNS.has(column)) return Math.abs(Number(current) - Number(incoming)) < 1e-6;
  if (column === "attributes") return JSON.stringify(sortKeys(current)) === JSON.stringify(sortKeys(incoming));
  return current === incoming;
}

function sortKeys(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
}

export async function runAdincoImport(db: Database, opts: ImportOptions = {}): Promise<ImportStats> {
  const logger = opts.logger ?? (() => {});
  const orgId = await organizationId(db);
  const actor = systemActor(orgId, "migracion-adinco");
  const run = await db
    .insertInto("migration_runs")
    .values({ source: ADINCO_SOURCE, triggered_by: opts.triggeredBy ?? "cli", options: JSON.stringify({ limit: opts.limit, codes: opts.codes, verifyMedia: opts.verifyMedia, force: opts.force }) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const stats: ImportStats = {
    runId: run.id,
    discovered: 0,
    extracted: 0,
    failed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skippedProtected: 0,
    published: 0,
    reviewRequired: 0,
    missingFromSource: 0,
    mediaVerified: 0,
    mediaFailed: 0,
    warnings: { info: 0, warning: 0, error: 0 },
    agentsCreated: 0,
  };

  try {
    // 1. Oficinas y vendedores (agentes)
    const realEstate = await fetchAdincoRealEstate(opts.fetchImpl);
    const { branches, agents, created } = await importOfficesAndSellers(db, actor, realEstate);
    stats.agentsCreated = created;
    logger(`Oficinas: ${branches.size} · agentes: ${agents.size} (${created} nuevos)`);

    // 2. DISCOVERED
    let listed = await listAdincoProperties(opts.fetchImpl);
    const allListedIds = new Set(listed.map((p) => String(p.id)));
    if (opts.codes?.length) listed = listed.filter((p) => opts.codes!.includes(p.code));
    if (opts.limit) listed = listed.slice(0, opts.limit);
    stats.discovered = listed.length;
    logger(`Descubiertas: ${listed.length}`);
    for (const p of listed) {
      await sql`insert into migration_records(source, external_id, last_run_id, stage)
        values (${ADINCO_SOURCE}, ${String(p.id)}, ${run.id}, 'discovered')
        on conflict (source, external_id) do update set last_run_id = excluded.last_run_id`.execute(db);
    }

    // 3–7. EXTRACT → … → PUBLISHED, por propiedad
    const importedIds: string[] = [];
    await mapLimit(
      listed,
      opts.concurrency ?? 3,
      async (item, i) => {
        const externalId = String(item.id);
        let raw: unknown;
        try {
          raw = await fetchAdincoPropertyDetail(item.code, opts.fetchImpl);
          stats.extracted++;
        } catch (e) {
          stats.failed++;
          await setRecord(db, externalId, run.id, { stage: "failed", error: `extracción: ${(e as Error).message}` });
          log.warn("migration.extract_failed", { code: item.code, ...errorFields(e) });
          return;
        }
        try {
          const outcome = await importOne(db, actor, run.id, externalId, raw, { branches, agents, force: Boolean(opts.force) });
          stats[outcome.result]++;
          if (outcome.published) stats.published++;
          if (outcome.reviewRequired) stats.reviewRequired++;
          for (const w of outcome.warnings) stats.warnings[w.severity]++;
          if (outcome.propertyId && outcome.result !== "unchanged") importedIds.push(outcome.propertyId);
        } catch (e) {
          stats.failed++;
          await setRecord(db, externalId, run.id, { stage: "failed", error: (e as Error).message.slice(0, 2000) });
          log.error("migration.import_failed", { code: item.code, ...errorFields(e) });
        }
        if ((i + 1) % 25 === 0) logger(`  ${i + 1}/${listed.length}`);
      },
      opts.delayMs ?? 150,
    );

    // Propiedades importadas antes que ya no están en el origen: no se tocan, se avisan.
    if (!opts.codes?.length && !opts.limit) {
      const previous = await db
        .selectFrom("migration_records")
        .select(["external_id", "property_id"])
        .where("source", "=", ADINCO_SOURCE)
        .where("stage", "in", ["imported", "media_verified", "review_required", "verified", "published", "skipped_protected"])
        .execute();
      for (const r of previous) {
        if (allListedIds.has(r.external_id)) continue;
        stats.missingFromSource++;
        await upsertWarnings(db, run.id, r.external_id, r.property_id, [
          { code: "missing_from_source", field: "*", severity: "warning", message: "Ya no figura publicada en el sitio anterior (¿vendida, alquilada o dada de baja?). Revisar estado." },
        ], { closeStale: false });
      }
    }

    // 8. MEDIA VERIFIED
    if (opts.verifyMedia && importedIds.length) {
      const r = await verifyMedia(db, run.id, importedIds, opts.fetchImpl, logger);
      stats.mediaVerified = r.verified;
      stats.mediaFailed = r.failed;
    }

    await sql`select setval('property_code_seq', greatest((select coalesce(max(code), 0) from properties), (select last_value from property_code_seq)))`.execute(db);
    await db
      .updateTable("migration_runs")
      .set({ status: stats.failed ? "completed_with_errors" : "completed", stats: JSON.stringify(stats), finished_at: new Date() })
      .where("id", "=", run.id)
      .execute();
    return stats;
  } catch (e) {
    await db.updateTable("migration_runs").set({ status: "failed", error: (e as Error).message.slice(0, 2000), stats: JSON.stringify(stats), finished_at: new Date() }).where("id", "=", run.id).execute();
    throw e;
  }
}

async function setRecord(db: Database | Tx, externalId: string, runId: string, patch: { stage: string; error?: string | null; raw?: unknown; rawHash?: string; normalized?: unknown; propertyId?: string | null }) {
  await sql`insert into migration_records(source, external_id, last_run_id, stage, error, raw, raw_hash, normalized, property_id)
    values (${ADINCO_SOURCE}, ${externalId}, ${runId}, ${patch.stage}, ${patch.error ?? null},
            ${patch.raw === undefined ? null : JSON.stringify(patch.raw)}::jsonb, ${patch.rawHash ?? null},
            ${patch.normalized === undefined ? null : JSON.stringify(patch.normalized)}::jsonb, ${patch.propertyId ?? null})
    on conflict (source, external_id) do update set
      last_run_id = excluded.last_run_id, stage = excluded.stage, error = excluded.error,
      raw = coalesce(excluded.raw, migration_records.raw), raw_hash = coalesce(excluded.raw_hash, migration_records.raw_hash),
      normalized = coalesce(excluded.normalized, migration_records.normalized),
      property_id = coalesce(excluded.property_id, migration_records.property_id)`.execute(db);
}

type Maps = { branches: Map<string, string>; agents: Map<string, string>; force: boolean };
type Outcome = { result: "created" | "updated" | "unchanged" | "skippedProtected" | "failed"; propertyId: string | null; published: boolean; reviewRequired: boolean; warnings: MigrationWarning[] };

export async function importOne(db: Database, actor: SystemActor, runId: string, externalId: string, raw: unknown, maps: Maps): Promise<Outcome> {
  const rawHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const prev = await db.selectFrom("migration_records").select(["raw_hash", "stage", "property_id"]).where("source", "=", ADINCO_SOURCE).where("external_id", "=", externalId).executeTakeFirst();
  if (!maps.force && prev?.raw_hash === rawHash && prev.property_id && ["published", "review_required", "verified", "media_verified", "skipped_protected"].includes(prev.stage)) {
    await setRecord(db, externalId, runId, { stage: prev.stage });
    return { result: "unchanged", propertyId: prev.property_id, published: false, reviewRequired: false, warnings: [] };
  }
  await setRecord(db, externalId, runId, { stage: "extracted", raw, rawHash });

  const { property: n, warnings } = mapAdincoProperty(raw);
  if (!n) {
    await upsertWarnings(db, runId, externalId, null, warnings);
    await setRecord(db, externalId, runId, { stage: "failed", error: warnings.map((w) => w.message).join(" · ") });
    return { result: "failed", propertyId: null, published: false, reviewRequired: false, warnings };
  }
  await setRecord(db, externalId, runId, { stage: "normalized", normalized: n });
  await setRecord(db, externalId, runId, { stage: "validated" });

  return db.transaction().execute(async (trx) => {
    // Estado real de la multimedia ya verificada: si todas las fotos conocidas fallaron, sigue bloqueada
    // aunque el mapeo del origen no lo detecte (evita republicar una ficha sin fotos visibles).
    const existingRef = await trx.selectFrom("external_refs").select("entity_id").where("source", "=", ADINCO_SOURCE).where("external_type", "=", "property").where("external_id", "=", externalId).executeTakeFirst();
    if (existingRef) {
      const media = await sql<{ usable: number; failed: number }>`select
          count(*) filter (where status <> 'failed')::int as usable, count(*) filter (where status = 'failed')::int as failed
        from property_media where property_id = ${existingRef.entity_id} and kind = 'image' and deleted_at is null
          and source_url = any(${n.media.filter((m) => m.kind === "image").map((m) => m.sourceUrl)}::text[])`.execute(trx);
      const m = media.rows[0];
      if (m && m.failed > 0 && m.usable === 0) warnings.push({ code: "media_unreachable", field: "media", severity: "error", message: "Ninguna foto del origen responde: no se publica" });
    }
    const blocking = hasBlockingWarning(warnings);

    const ref = await trx.selectFrom("external_refs").select("entity_id").where("source", "=", ADINCO_SOURCE).where("external_type", "=", "property").where("external_id", "=", externalId).executeTakeFirst();
    const locationId = await upsertLocations(trx, n);
    const branchId = n.officeExternalId ? (maps.branches.get(n.officeExternalId) ?? null) : null;
    const agentUserId = n.sellerExternalId ? (maps.agents.get(n.sellerExternalId) ?? null) : null;
    const allWarnings = [...warnings];

    let propertyId: string;
    let result: Outcome["result"];
    let published = false;

    if (!ref) {
      const clash = await trx.selectFrom("properties").select(["id", "source"]).where("code", "=", n.code).executeTakeFirst();
      if (clash) throw new Error(`El código ${n.code} ya lo usa otra propiedad del CRM (${clash.id})`);
      const slugTaken = await trx.selectFrom("properties").select("id").where("slug", "=", n.slug).executeTakeFirst();
      const cols: Columns = {};
      for (const [field, column] of PROPERTY_FIELDS) cols[column] = toDb(column, n[field]);
      const row = await trx
        .insertInto("properties")
        .values({
          ...(cols as object),
          organization_id: actor.organizationId,
          branch_id: branchId,
          code: n.code,
          slug: slugTaken ? `${n.slug}-${externalId}` : n.slug,
          status: n.status,
          location_id: locationId,
          is_published: !blocking,
          published_at: !blocking ? new Date() : null,
          source: "adinco_import",
          imported_at: new Date(),
          last_synced_at: new Date(),
        } as never)
        .returning("id")
        .executeTakeFirstOrThrow();
      propertyId = row.id;
      result = "created";
      published = !blocking;
      await trx.insertInto("external_refs").values({ source: ADINCO_SOURCE, external_type: "property", external_id: externalId, entity_type: "property", entity_id: propertyId }).execute();
      await trx.insertInto("property_status_history").values({ property_id: propertyId, from_status: null, to_status: n.status, reason: "Importada del sitio anterior" }).execute();
      await upsertOperation(trx, propertyId, n);
      await setFeatures(trx, propertyId, n);
      await syncMedia(trx, propertyId, n, true);
      if (agentUserId) await trx.insertInto("property_agents").values({ property_id: propertyId, user_id: agentUserId, role: "lead" }).onConflict((oc) => oc.doNothing()).execute();
      await trx.insertInto("property_publications").values({ property_id: propertyId, channel_key: "web", desired_state: published ? "published" : "unpublished", sync_status: "synced", last_synced_at: new Date() }).onConflict((oc) => oc.columns(["property_id", "channel_key"]).doNothing()).execute();
      await audit(trx, actor, { action: "PROPERTY_IMPORTED", entityType: "property", entityId: propertyId, after: { code: n.code, externalId, published, warnings: warnings.length }, metadata: { runId } });
    } else {
      propertyId = ref.entity_id;
      const current = await trx.selectFrom("properties").selectAll().where("id", "=", propertyId).forUpdate().executeTakeFirstOrThrow();
      const protectedFields = new Set(current.protected_fields);
      const diffs: Array<{ column: string; current: unknown; incoming: unknown }> = [];
      for (const [field, column] of PROPERTY_FIELDS) {
        const incoming = toDb(column, n[field]);
        const cur = (current as Record<string, unknown>)[column];
        if (!same(column, cur, column === "attributes" ? n.attributes : incoming)) diffs.push({ column, current: cur, incoming });
      }
      if (current.manually_verified_at) {
        // Verificada por una persona: el CRM manda. Solo se informan diferencias del origen.
        for (const d of diffs) allWarnings.push({ code: "source_changed_after_verification", field: d.column, severity: "info", message: "El sitio anterior cambió este dato después de la verificación manual (no se aplicó)", valueA: fmt(d.current), valueB: fmt(d.incoming) });
        result = "skippedProtected";
      } else {
        const patch: Columns = {};
        for (const d of diffs) {
          if (protectedFields.has(d.column)) {
            allWarnings.push({ code: "protected_field_conflict", field: d.column, severity: "warning", message: "El origen trae otro valor, pero el campo fue corregido en el CRM (se conserva el del CRM)", valueA: fmt(d.current), valueB: fmt(d.incoming) });
          } else patch[d.column] = d.incoming;
        }
        if (!protectedFields.has("location_id") && current.location_id !== locationId) patch.location_id = locationId;
        if (!protectedFields.has("branch_id") && branchId && current.branch_id !== branchId) patch.branch_id = branchId;
        if (!protectedFields.has("status") && current.status !== n.status && ["available", "reserved"].includes(current.status)) {
          patch.status = n.status;
          await trx.insertInto("property_status_history").values({ property_id: propertyId, from_status: current.status, to_status: n.status, reason: "Cambio en el sitio anterior" }).execute();
        }
        if (!protectedFields.has(`price:${n.operation}`)) await upsertOperation(trx, propertyId, n);
        else allWarnings.push({ code: "protected_field_conflict", field: `price:${n.operation}`, severity: "info", message: "Precio corregido en el CRM: no se tomó el del origen", valueB: n.amount === null ? "consultar" : `${n.currency} ${n.amount}` });
        if (!protectedFields.has("features")) await setFeatures(trx, propertyId, n);
        await syncMedia(trx, propertyId, n, !protectedFields.has("media"));
        if (agentUserId && !protectedFields.has("agents")) {
          await trx.deleteFrom("property_agents").where("property_id", "=", propertyId).where("role", "=", "lead").where("user_id", "<>", agentUserId).execute();
          await trx.insertInto("property_agents").values({ property_id: propertyId, user_id: agentUserId, role: "lead" }).onConflict((oc) => oc.doNothing()).execute();
        }
        // Una advertencia bloqueante nueva despublica; una resuelta en origen vuelve a publicar solo si nadie la despublicó a mano.
        if (blocking && current.is_published) patch.is_published = false;
        if (!blocking && !current.is_published && !protectedFields.has("is_published") && ["available", "reserved"].includes(String(patch.status ?? current.status))) {
          patch.is_published = true;
          patch.published_at = current.published_at ?? new Date();
        }
        patch.last_synced_at = new Date();
        await trx.updateTable("properties").set(patch as never).where("id", "=", propertyId).execute();
        published = Boolean(patch.is_published ?? current.is_published) && !blocking;
        result = diffs.length || patch.status || patch.is_published !== undefined ? "updated" : "unchanged";
        if (result === "updated") {
          await audit(trx, actor, { action: "PROPERTY_REIMPORTED", entityType: "property", entityId: propertyId, before: Object.fromEntries(diffs.map((d) => [d.column, d.current])), after: patch, metadata: { runId } });
        }
      }
    }

    await trx.insertInto("property_redirects").values({ path: n.redirectPath, property_id: propertyId }).onConflict((oc) => oc.column("path").doUpdateSet({ property_id: propertyId })).execute();
    await upsertWarnings(trx, runId, externalId, propertyId, allWarnings);
    const reviewRequired = blocking;
    await setRecord(trx, externalId, runId, {
      stage: result === "skippedProtected" ? "skipped_protected" : reviewRequired ? "review_required" : "published",
      propertyId,
      error: null,
    });
    return { result, propertyId, published, reviewRequired, warnings: allWarnings };
  });
}

function fmt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v.slice(0, 500) : JSON.stringify(v).slice(0, 500);
}

async function upsertLocations(trx: Tx, n: NormalizedProperty): Promise<string | null> {
  let parentId: string | null = null;
  let lastId: string | null = null;
  for (const loc of n.locations) {
    const ref = await trx.selectFrom("external_refs").select("entity_id").where("source", "=", ADINCO_SOURCE).where("external_type", "=", "location").where("external_id", "=", loc.externalId).executeTakeFirst();
    let id = ref?.entity_id ?? null;
    if (!id) {
      // Concurrencia: dos fichas del mismo barrio pueden crear la ubicación a la vez → on conflict + relectura.
      await sql`insert into locations(parent_id, kind, name, slug) values (${parentId}, ${loc.kind}, ${loc.name}, ${loc.slug})
        on conflict (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, slug) do nothing`.execute(trx);
      const existing = await sql<{ id: string }>`select id from locations
        where coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${parentId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          and kind = ${loc.kind} and slug = ${loc.slug}`.execute(trx);
      id = existing.rows[0]!.id;
      await trx.insertInto("external_refs").values({ source: ADINCO_SOURCE, external_type: "location", external_id: loc.externalId, entity_type: "location", entity_id: id }).onConflict((oc) => oc.doNothing()).execute();
    }
    parentId = id;
    lastId = id;
  }
  return lastId;
}

async function upsertOperation(trx: Tx, propertyId: string, n: NormalizedProperty) {
  const prev = await trx.selectFrom("property_operations").selectAll().where("property_id", "=", propertyId).where("operation", "=", n.operation).executeTakeFirst();
  const values = {
    currency: n.currency,
    amount: n.amount === null ? null : String(n.amount),
    price_hidden: n.priceHidden,
    expenses_amount: n.expensesAmount === null ? null : String(n.expensesAmount),
    expenses_currency: n.expensesAmount === null ? null : "ARS",
    is_active: true,
  };
  const changed = !prev || prev.currency !== values.currency || Number(prev.amount ?? NaN) !== Number(values.amount ?? NaN) || prev.price_hidden !== values.price_hidden || Number(prev.expenses_amount ?? NaN) !== Number(values.expenses_amount ?? NaN);
  if (!changed) return;
  if (prev) await trx.updateTable("property_operations").set(values).where("id", "=", prev.id).execute();
  else await trx.insertInto("property_operations").values({ property_id: propertyId, operation: n.operation, ...values }).execute();
  if (!prev || prev.currency !== values.currency || Number(prev.amount ?? NaN) !== Number(values.amount ?? NaN)) {
    await trx
      .insertInto("property_price_history")
      .values({ property_id: propertyId, operation: n.operation, previous_currency: prev?.currency ?? null, previous_amount: prev?.amount ?? null, new_currency: n.currency, new_amount: values.amount, source: "import", reason: prev ? "Cambio en el sitio anterior" : "Precio al migrar" })
      .execute();
  }
}

async function setFeatures(trx: Tx, propertyId: string, n: NormalizedProperty) {
  const ids: string[] = [];
  for (const f of n.features) {
    const row = await trx
      .insertInto("features")
      .values({ key: f.key, name: f.name, grp: f.grp })
      .onConflict((oc) => oc.column("key").doUpdateSet({ key: f.key }))
      .returning("id")
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  await trx.deleteFrom("property_features").where("property_id", "=", propertyId).execute();
  if (ids.length) await trx.insertInto("property_features").values([...new Set(ids)].map((feature_id) => ({ property_id: propertyId, feature_id }))).execute();
}

/** Agrega multimedia nueva; con `prune`, da de baja la que ya no está en el origen y nunca se copió a storage propio. */
async function syncMedia(trx: Tx, propertyId: string, n: NormalizedProperty, prune: boolean) {
  const existing = await trx.selectFrom("property_media").select(["id", "source_url", "file_id", "is_cover"]).where("property_id", "=", propertyId).where("deleted_at", "is", null).execute();
  const incoming = new Set(n.media.map((m) => m.sourceUrl));
  if (prune) {
    const gone = existing.filter((e) => e.source_url && !incoming.has(e.source_url) && !e.file_id).map((e) => e.id);
    if (gone.length) await trx.updateTable("property_media").set({ deleted_at: new Date(), is_cover: false }).where("id", "in", gone).execute();
  }
  const hasCover = existing.some((e) => e.is_cover && (!e.source_url || incoming.has(e.source_url)));
  for (const m of n.media) {
    await trx
      .insertInto("property_media")
      .values({ property_id: propertyId, kind: m.kind, source_url: m.sourceUrl, sort_order: m.sortOrder, is_cover: !hasCover && m.isCover, status: "source_only" })
      .onConflict((oc) => oc.columns(["property_id", "source_url"]).where("source_url", "is not", null).where("deleted_at", "is", null).doUpdateSet({ sort_order: m.sortOrder }))
      .execute();
  }
}

export async function upsertWarnings(db: Database | Tx, runId: string, externalId: string, propertyId: string | null, warnings: MigrationWarning[], opts: { closeStale?: boolean } = {}) {
  const seen = new Set<string>();
  for (const w of warnings) {
    seen.add(`${w.code}|${w.field}`);
    await sql`insert into migration_warnings(run_id, source, external_id, property_id, code, field, value_a, value_b, message, severity)
      values (${runId}, ${ADINCO_SOURCE}, ${externalId}, ${propertyId}, ${w.code}, ${w.field}, ${w.valueA ?? null}, ${w.valueB ?? null}, ${w.message}, ${w.severity})
      on conflict (source, external_id, code, field) do update set
        run_id = excluded.run_id, property_id = coalesce(excluded.property_id, migration_warnings.property_id),
        message = excluded.message, severity = excluded.severity,
        -- si el valor cambió respecto de lo revisado, se reabre
        status = case when migration_warnings.value_a is distinct from excluded.value_a or migration_warnings.value_b is distinct from excluded.value_b
                      then 'open' else migration_warnings.status end,
        value_a = excluded.value_a, value_b = excluded.value_b`.execute(db);
  }
  // Las advertencias abiertas que ya no aplican se cierran solas (reviewed_by null = cierre automático).
  // Solo en una evaluación completa del registro: un aviso puntual no debe cerrar los demás.
  if (opts.closeStale === false) return;
  const open = await db.selectFrom("migration_warnings").select(["id", "code", "field"]).where("source", "=", ADINCO_SOURCE).where("external_id", "=", externalId).where("status", "=", "open").execute();
  const stale = open.filter((w) => !seen.has(`${w.code}|${w.field}`) && w.code !== "missing_from_source").map((w) => w.id);
  if (stale.length) await db.updateTable("migration_warnings").set({ status: "resolved", reviewed_at: new Date() }).where("id", "in", stale).execute();
}

async function importOfficesAndSellers(db: Database, actor: SystemActor, re: AdincoRealEstate): Promise<{ branches: Map<string, string>; agents: Map<string, string>; created: number }> {
  const branches = new Map<string, string>();
  const agents = new Map<string, string>();
  let created = 0;
  const allBranches = await db.selectFrom("branches").select(["id", "slug", "is_main", "latitude"]).where("organization_id", "=", actor.organizationId).execute();

  for (const office of re.offices) {
    const externalId = String(office.id);
    const ref = await db.selectFrom("external_refs").select("entity_id").where("source", "=", ADINCO_SOURCE).where("external_type", "=", "office").where("external_id", "=", externalId).executeTakeFirst();
    let branchId = ref?.entity_id;
    if (!branchId) {
      const isSanLorenzo = /lorenzo/i.test(`${office.address.neighborhood ?? ""} ${office.address.zp_3 ?? ""}`);
      const match = allBranches.find((b) => (isSanLorenzo ? b.slug === "san-lorenzo-chico" : b.is_main));
      if (!match) continue;
      branchId = match.id;
      await db.insertInto("external_refs").values({ source: ADINCO_SOURCE, external_type: "office", external_id: externalId, entity_type: "branch", entity_id: branchId }).onConflict((oc) => oc.doNothing()).execute();
      if (!match.latitude && office.latitude && office.longitude) {
        await db.updateTable("branches").set({ latitude: String(office.latitude), longitude: String(office.longitude) }).where("id", "=", branchId).execute();
      }
    }
    branches.set(externalId, branchId);

    for (const s of office.sellers) {
      const sid = String(s.id);
      if (agents.has(sid)) continue;
      const sref = await db.selectFrom("external_refs").select("entity_id").where("source", "=", ADINCO_SOURCE).where("external_type", "=", "seller").where("external_id", "=", sid).executeTakeFirst();
      if (sref) {
        agents.set(sid, sref.entity_id);
        continue;
      }
      const email = normalizeEmail(s.contact.email);
      if (!email) continue;
      const fullName = `${s.name.trim()} ${s.lastname.trim()}`.replace(/\s+/g, " ").replace(/^Secretaria Inmobiliaria$/i, "Secretaría Inmobiliaria");
      const isShared = /secretar/i.test(fullName);
      const wa = s.contact.phoneNumbers.find((p) => /whats/i.test(p.type)) ?? s.contact.phoneNumbers.find((p) => /celular/i.test(p.type));
      const phoneRaw = wa ? `${wa.areaCode ?? ""}${wa.number}` : null;
      const whatsapp = normalizePhone(phoneRaw, { assumeMobile: true, defaultAreaCode: "387" });
      const any = s.contact.phoneNumbers[0];
      const userId = await db.transaction().execute(async (trx) => {
        const existing = await trx.selectFrom("users").select("id").where("email", "=", email).where("deleted_at", "is", null).executeTakeFirst();
        let id = existing?.id;
        if (!id) {
          id = (
            await trx
              .insertInto("users")
              .values({
                organization_id: actor.organizationId,
                kind: "staff",
                email,
                full_name: fullName,
                phone: any ? `${any.areaCode ?? ""} ${any.number}`.trim() : null,
                whatsapp_e164: whatsapp?.e164 ?? null,
                public_profile: !isShared,
                password_hash: null, // sin acceso hasta que se lo invite desde Usuarios
                must_change_password: true,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
          await trx.insertInto("user_roles").values({ user_id: id, role_key: "agente" }).onConflict((oc) => oc.doNothing()).execute();
          await audit(trx, actor, { action: "USER_IMPORTED", entityType: "user", entityId: id, after: { fullName, source: "adinco", sellerId: sid } });
          created++;
        }
        await trx.insertInto("user_branches").values({ user_id: id, branch_id: branchId! }).onConflict((oc) => oc.doNothing()).execute();
        await trx.insertInto("external_refs").values({ source: ADINCO_SOURCE, external_type: "seller", external_id: sid, entity_type: "user", entity_id: id }).onConflict((oc) => oc.doNothing()).execute();
        return id;
      });
      agents.set(sid, userId);
    }
  }
  return { branches, agents, created };
}

/** HEAD a cada foto nueva: verified si responde imagen, failed si no. Una propiedad sin ninguna foto válida queda en revisión. */
async function verifyMedia(db: Database, runId: string, propertyIds: string[], fetchImpl: typeof fetch = fetch, logger: (m: string) => void = () => {}) {
  const media = await db
    .selectFrom("property_media as m")
    .innerJoin("properties as p", "p.id", "m.property_id")
    .innerJoin("external_refs as r", (j) => j.onRef("r.entity_id", "=", "p.id").on("r.external_type", "=", "property").on("r.source", "=", ADINCO_SOURCE))
    .select(["m.id", "m.source_url", "m.property_id", "r.external_id"])
    .where("m.property_id", "in", propertyIds)
    .where("m.deleted_at", "is", null)
    .where("m.status", "in", ["source_only", "pending", "failed"])
    .execute();
  let verified = 0;
  let failed = 0;
  await mapLimit(
    media,
    8,
    async (m) => {
      let ok = false;
      let error: string | null = null;
      try {
        const res = await fetchImpl(m.source_url!, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
        ok = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
        if (!ok) error = `HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`;
      } catch (e) {
        error = (e as Error).message;
      }
      if (ok) verified++;
      else failed++;
      // source_only se mantiene como "servida desde el origen" pero verificada; failed no se muestra.
      await db.updateTable("property_media").set({ status: ok ? "verified" : "failed", last_checked_at: new Date(), last_error: error }).where("id", "=", m.id).execute();
    },
    0,
  );
  logger(`Multimedia verificada: ${verified} ok · ${failed} con error`);
  const noImages = await sql<{ property_id: string; external_id: string }>`
    select p.id as property_id, r.external_id from properties p
    join external_refs r on r.entity_id = p.id and r.external_type = 'property' and r.source = ${ADINCO_SOURCE}
    where p.id = any(${propertyIds}::uuid[])
      and not exists (select 1 from property_media m where m.property_id = p.id and m.kind = 'image' and m.deleted_at is null and m.status in ('verified','stored'))`.execute(db);
  for (const r of noImages.rows) {
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("properties").set({ is_published: false }).where("id", "=", r.property_id).execute();
      await upsertWarnings(trx, runId, r.external_id, r.property_id, [{ code: "media_unreachable", field: "media", severity: "error", message: "Ninguna foto del origen responde: no se publica" }], { closeStale: false });
      await setRecord(trx, r.external_id, runId, { stage: "review_required", propertyId: r.property_id });
    });
  }
  await sql`update migration_records set stage = 'media_verified' where source = ${ADINCO_SOURCE} and last_run_id = ${runId} and stage = 'imported'`.execute(db);
  return { verified, failed };
}
