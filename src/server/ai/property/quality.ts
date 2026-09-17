/**
 * Property Quality AI — cálculo y persistencia del informe de calidad (job idempotente), análisis de fotos ALMACENADAS
 * y lecturas para el CRM. Reglas puras en quality-rules.ts; métricas de imagen en image-metrics.ts.
 *
 * Garantías (tests/integration/ai-property-quality.test.ts):
 * - Nunca modifica propiedades, operaciones ni multimedia: solo escribe `property_quality_reports` y
 *   `property_media_analysis`.
 * - Idempotente: `input_hash` = hash estable de todo lo que usa el cálculo; si no cambió, no reescribe ni emite.
 * - Fotos `source_only`/`verified` (URL del sitio anterior, sin archivo propio) NO se descargan: se informan como
 *   «no analizada: foto externa». Solo se leen archivos de nuestro storage (`status = 'stored'`).
 * - Recalcula por evento (automatizaciones `ai_quality_*` → acción `enqueue_property_quality`) y de noche.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, type Database, type Executor } from "../../db";
import { requirePermission, type Actor } from "../../auth/actor";
import { registerAction } from "../../automation/actions";
import { emitEvent } from "../../events";
import { notFound } from "../../errors";
import { isEnabled } from "../../flags";
import { enqueue } from "../../jobs/queue";
import { registerJobHandler } from "../../jobs/registry";
import { addScheduledTask } from "../../jobs/scheduled";
import { errorFields, log } from "../../log";
import { storage } from "../../storage";
import { stableStringify } from "../../integrations/portals/snapshot";
import { IMAGE_METRICS_VERSION, imageMetrics } from "./image-metrics";
import {
  buildQualityReport,
  DEFAULT_PRICE_SETTINGS,
  priceCheck,
  QUALITY_RULES_VERSION,
  referenceArea,
  ROOM_KEYS,
  type Criterion,
  type Finding,
  type MediaSummary,
  type PriceSettings,
  type QualityMedia,
  type QualityOperation,
  type QualitySnapshot,
  type RoomKey,
} from "./quality-rules";

export const PROPERTY_QA_FLAG = "ai_property_quality";
export const QUALITY_JOB = "ai.property_quality";
const ACTIVE_STATUSES = ["draft", "available", "reserved", "paused"];
const OP_LABEL: Record<string, string> = { sale: "venta", rent: "alquiler", temporary_rent: "alquiler temporario" };

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

async function numberSetting(db: Executor, key: string, fallback: number): Promise<number> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function priceSettings(db: Executor): Promise<PriceSettings> {
  return {
    minSample: Math.round(await numberSetting(db, "ai.property_quality.price_min_sample", DEFAULT_PRICE_SETTINGS.minSample)),
    lowFactor: await numberSetting(db, "ai.property_quality.price_low_factor", DEFAULT_PRICE_SETTINGS.lowFactor),
    highFactor: await numberSetting(db, "ai.property_quality.price_high_factor", DEFAULT_PRICE_SETTINGS.highFactor),
  };
}

// ───────────────────────────── Snapshot ─────────────────────────────

type SnapshotExtras = { organizationId: string; primaryOperation: QualityOperation | null };

export async function loadQualitySnapshot(db: Executor, propertyId: string): Promise<(QualitySnapshot & SnapshotExtras) | null> {
  const p = await db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .select([
      "p.id", "p.organization_id", "p.code", "p.title", "p.type_key", "t.category", "p.status", "p.is_published", "p.description", "p.location_id",
      "p.address_street", "p.latitude", "p.longitude", "p.total_area_m2", "p.covered_area_m2", "p.land_area_m2", "p.rooms", "p.bedrooms",
      "p.bathrooms", "p.garages", "p.orientation", "p.attributes", "p.is_demo",
    ])
    .where("p.id", "=", propertyId)
    .where("p.deleted_at", "is", null)
    .executeTakeFirst();
  if (!p) return null;
  const [ops, featureCount, agent, tour, media] = await Promise.all([
    db.selectFrom("property_operations").select(["operation", "currency", "amount", "price_hidden"]).where("property_id", "=", propertyId).where("is_active", "=", true).orderBy(sql`array_position(array['sale','rent','temporary_rent'], operation)`).execute(),
    db.selectFrom("property_features").select(sql<number>`count(*)::int`.as("n")).where("property_id", "=", propertyId).executeTakeFirstOrThrow(),
    sql<{ ok: boolean }>`select exists(select 1 from property_agents pa join users u on u.id = pa.user_id where pa.property_id = ${propertyId} and pa.role = 'lead' and u.is_active and u.deleted_at is null) as ok`.execute(db),
    db.selectFrom("virtual_tours").select("status").where("property_id", "=", propertyId).executeTakeFirst(),
    db
      .selectFrom("property_media as m")
      .leftJoin("files as f", (j) => j.onRef("f.id", "=", "m.file_id").on("f.deleted_at", "is", null))
      .leftJoin("property_media_rooms as r", "r.media_id", "m.id")
      .leftJoin("property_media_analysis as a", (j) => j.onRef("a.media_id", "=", "m.id").onRef("a.file_id", "=", "m.file_id"))
      .select(["m.id", "m.kind", "m.status", "m.is_cover", "m.sort_order", "m.file_id", "f.id as f_id", "r.room", "a.dhash", "a.luminance_mean", "a.luminance_p95", "a.laplacian_variance", "a.luminance_variance", "a.algorithm_version"])
      .where("m.property_id", "=", propertyId)
      .where("m.deleted_at", "is", null)
      .orderBy("m.sort_order")
      .orderBy("m.created_at")
      .execute(),
  ]);
  const attrs = (p.attributes ?? {}) as Record<string, unknown>;
  const operations: QualityOperation[] = ops.map((o) => ({ operation: o.operation as QualityOperation["operation"], currency: o.currency as QualityOperation["currency"], amount: num(o.amount), priceHidden: o.price_hidden }));
  return {
    id: p.id,
    organizationId: p.organization_id,
    code: p.code,
    title: p.title,
    typeKey: p.type_key,
    category: p.category,
    status: p.status,
    isPublished: p.is_published,
    description: p.description,
    locationId: p.location_id,
    street: p.address_street,
    hasCoordinates: p.latitude !== null && p.longitude !== null,
    areas: { totalM2: num(p.total_area_m2), coveredM2: num(p.covered_area_m2), landM2: num(p.land_area_m2) },
    rooms: p.rooms,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    garages: p.garages,
    orientation: p.orientation,
    floors: typeof attrs.floors === "number" ? attrs.floors : null,
    featureCount: featureCount.n,
    operations,
    primaryOperation: operations.find((o) => o.amount !== null && o.amount > 0) ?? null,
    hasLeadAgent: agent.rows[0]?.ok ?? false,
    tourPublished: tour?.status === "published",
    media: media.map(
      (m): QualityMedia => ({
        id: m.id,
        kind: m.kind,
        status: m.status,
        isCover: m.is_cover,
        sortOrder: m.sort_order,
        stored: m.status === "stored" && Boolean(m.f_id),
        room: (ROOM_KEYS as readonly string[]).includes(m.room ?? "") ? (m.room as RoomKey) : null,
        metrics:
          m.dhash && m.algorithm_version === IMAGE_METRICS_VERSION
            ? { dhash: m.dhash, luminanceMean: Number(m.luminance_mean), luminanceP95: Number(m.luminance_p95), laplacianVariance: Number(m.laplacian_variance), luminanceVariance: Number(m.luminance_variance) }
            : null,
      }),
    ),
  };
}

// ───────────────────────────── Análisis de fotos almacenadas ─────────────────────────────

/**
 * Analiza hasta `limit` fotos ALMACENADAS sin métricas vigentes. Solo `status = 'stored'` con archivo propio del driver
 * actual: nunca descarga URLs externas. Devuelve cuántas analizó y si quedaron pendientes.
 */
export async function analyzeStoredMedia(db: Database, propertyId: string, limit: number): Promise<{ analyzed: number; failed: number; pending: number }> {
  const driver = storage();
  const rows = await db
    .selectFrom("property_media as m")
    .innerJoin("files as f", "f.id", "m.file_id")
    .leftJoin("property_media_analysis as a", "a.media_id", "m.id")
    .select(["m.id", "m.file_id", "f.bucket", "f.storage_key", "f.storage_driver", "f.checksum_sha256", "a.file_id as analyzed_file_id", "a.algorithm_version", "a.checksum_sha256 as analyzed_checksum"])
    .where("m.property_id", "=", propertyId)
    .where("m.deleted_at", "is", null)
    .where("m.kind", "=", "image")
    .where("m.status", "=", "stored")
    .where("f.deleted_at", "is", null)
    .orderBy("m.sort_order")
    .execute();
  const todo = rows.filter((r) => r.storage_driver === driver.name && (r.analyzed_file_id !== r.file_id || r.algorithm_version !== IMAGE_METRICS_VERSION || (r.checksum_sha256 && r.analyzed_checksum !== r.checksum_sha256)));
  let analyzed = 0;
  let failed = 0;
  for (const r of todo.slice(0, limit)) {
    try {
      const bytes = await driver.get(r.bucket, r.storage_key);
      const m = await imageMetrics(bytes);
      const values = {
        property_id: propertyId,
        file_id: r.file_id!,
        checksum_sha256: r.checksum_sha256,
        algorithm_version: IMAGE_METRICS_VERSION,
        width: m.width || null,
        height: m.height || null,
        dhash: m.dhash,
        luminance_mean: String(m.luminanceMean),
        luminance_p95: String(m.luminanceP95),
        dark_pixel_ratio: String(m.darkPixelRatio),
        laplacian_variance: String(m.laplacianVariance),
        luminance_variance: String(m.luminanceVariance),
        analyzed_at: new Date(),
      };
      await db
        .insertInto("property_media_analysis")
        .values({ media_id: r.id, ...values })
        .onConflict((oc) => oc.column("media_id").doUpdateSet(values))
        .execute();
      analyzed++;
    } catch (e) {
      failed++;
      log.warn("ai.property_quality_media_failed", { propertyId, mediaId: r.id, ...errorFields(e) });
    }
  }
  return { analyzed, failed, pending: Math.max(0, todo.length - limit) };
}

// ───────────────────────────── Comparables de precio ─────────────────────────────

export async function priceComparables(db: Executor, s: QualitySnapshot & SnapshotExtras): Promise<Array<{ pricePerM2: number }>> {
  const op = s.primaryOperation;
  if (!op || !s.locationId) return [];
  const areaExpr = s.category === "land" ? sql`coalesce(nullif(p.land_area_m2, 0), nullif(p.total_area_m2, 0))` : sql`coalesce(nullif(p.covered_area_m2, 0), nullif(p.total_area_m2, 0))`;
  const r = await sql<{ ppm2: string }>`
    select (o.amount / ${areaExpr})::numeric(14, 2)::text as ppm2
      from properties p
      join property_operations o on o.property_id = p.id and o.is_active and o.operation = ${op.operation} and o.currency = ${op.currency} and o.amount > 0
     where p.organization_id = ${s.organizationId} and p.id <> ${s.id} and p.deleted_at is null and not p.is_demo
       and p.type_key = ${s.typeKey} and p.location_id = ${s.locationId}
       and p.status = any(${["available", "reserved"]}::text[])
       and ${areaExpr} > 0
     limit 500`.execute(db);
  return r.rows.map((x) => ({ pricePerM2: Number(x.ppm2) }));
}

// ───────────────────────────── Cálculo ─────────────────────────────

export type ComputeResult = { status: "skipped"; reason: string } | { status: "unchanged"; score: number } | { status: "computed"; score: number; previousScore: number | null; pendingMedia: number };

export async function computePropertyQuality(db: Database, actor: Actor, propertyId: string, opts: { force?: boolean } = {}): Promise<ComputeResult> {
  if (!(await isEnabled(db, PROPERTY_QA_FLAG))) return { status: "skipped", reason: "flag apagado" };
  const exists = await db.selectFrom("properties").select(["id", "is_demo"]).where("id", "=", propertyId).where("deleted_at", "is", null).executeTakeFirst();
  if (!exists) return { status: "skipped", reason: "propiedad inexistente" };
  if (exists.is_demo) return { status: "skipped", reason: "propiedad demo" };

  const mediaLimit = Math.round(await numberSetting(db, "ai.property_quality.max_media_per_run", 40));
  const media = await analyzeStoredMedia(db, propertyId, mediaLimit).catch((e) => {
    // Storage sin configurar o caído: el informe sale igual (las fotos quedan sin analizar).
    log.warn("ai.property_quality_storage_unavailable", { propertyId, ...errorFields(e) });
    return { analyzed: 0, failed: 0, pending: 0 };
  });
  const snap = await loadQualitySnapshot(db, propertyId);
  if (!snap) return { status: "skipped", reason: "propiedad inexistente" };
  const settings = await priceSettings(db);
  const comparables = await priceComparables(db, snap);
  const op = snap.primaryOperation;
  const area = referenceArea(snap.category, snap.areas);
  const check = priceCheck(op && area ? op.amount! / area : null, comparables, settings);
  const report = buildQualityReport(snap, { check, operation: op ? OP_LABEL[op.operation]! : "", currency: op?.currency ?? "" });
  const inputHash = createHash("sha256")
    .update(stableStringify({ v: QUALITY_RULES_VERSION, m: IMAGE_METRICS_VERSION, snap, comparables: comparables.map((c) => c.pricePerM2).sort((a, b) => a - b), settings }))
    .digest("hex");

  const result = await db.transaction().execute(async (trx) => {
    const prev = await trx.selectFrom("property_quality_reports").select(["score", "input_hash"]).where("property_id", "=", propertyId).forUpdate().executeTakeFirst();
    if (prev && prev.input_hash === inputHash && !opts.force) return { status: "unchanged" as const, score: prev.score };
    const values = {
      organization_id: snap.organizationId,
      score: report.score,
      completeness_score: report.completenessScore,
      criteria: JSON.stringify(report.criteria),
      findings: JSON.stringify(report.findings),
      media_summary: JSON.stringify({ ...report.mediaSummary, priceCheck: report.priceCheck }),
      missing_count: report.missingCount,
      warning_count: report.warningCount,
      input_hash: inputHash,
      rules_version: QUALITY_RULES_VERSION,
      computed_at: new Date(),
    };
    await trx
      .insertInto("property_quality_reports")
      .values({ property_id: propertyId, ...values })
      .onConflict((oc) => oc.column("property_id").doUpdateSet(values))
      .execute();
    // Sin datos personales: id, score y versión. Nadie escucha este evento (no hay loops).
    await emitEvent(trx, actor, {
      type: "property.quality_computed",
      aggregateType: "property",
      aggregateId: propertyId,
      payload: { score: report.score, previousScore: prev?.score ?? null, rulesVersion: QUALITY_RULES_VERSION, findings: report.findings.length },
      dedupeKey: `property.quality_computed:${propertyId}:${inputHash.slice(0, 32)}`,
    });
    return { status: "computed" as const, score: report.score, previousScore: prev?.score ?? null, pendingMedia: media.pending };
  });
  // Quedaron fotos sin analizar por el tope de la corrida: otra pasada en un minuto (idempotente).
  if (media.pending > 0) await enqueuePropertyQuality(db, propertyId, `media:${Math.floor(Date.now() / 60_000)}`, new Date(Date.now() + 60_000));
  return result;
}

/** Encola el recálculo (idempotente: un job vivo por clave). Se puede llamar dentro de una transacción. */
export async function enqueuePropertyQuality(db: Executor, propertyId: string, reason: string, runAt?: Date): Promise<string | null> {
  return enqueue(db, { type: QUALITY_JOB, payload: { propertyId }, dedupeKey: `${QUALITY_JOB}:${propertyId}:${reason}`.slice(0, 200), maxAttempts: 3, timeoutMs: 120_000, runAt });
}

const jobPayload = z.object({ propertyId: z.uuid() });

registerJobHandler(QUALITY_JOB, async (payload, ctx) => {
  const { propertyId } = jobPayload.parse(payload);
  return computePropertyQuality(ctx.db, ctx.actor, propertyId);
});

/** Nocturno: comparables y fotos cambian aunque la propiedad no. Encola las activas (el cálculo sin cambios no escribe). */
export async function enqueueNightlyQuality(db: Database): Promise<{ enqueued: number }> {
  if (!(await isEnabled(db, PROPERTY_QA_FLAG))) return { enqueued: 0 };
  const day = new Date().toISOString().slice(0, 10);
  const rows = await db.selectFrom("properties").select("id").where("deleted_at", "is", null).where("is_demo", "=", false).where((eb) => eb.or([eb("status", "in", ACTIVE_STATUSES), eb("is_published", "=", true)])).limit(5000).execute();
  let enqueued = 0;
  for (const r of rows) if (await enqueuePropertyQuality(db, r.id, `nightly:${day}`)) enqueued++;
  return { enqueued };
}

registerJobHandler("ai.property_quality_nightly", async (_p, ctx) => enqueueNightlyQuality(ctx.db));
addScheduledTask({ type: "ai.property_quality_nightly", every: "daily", timeoutMs: 120_000 });

registerAction("enqueue_property_quality", async (_raw, ctx) => {
  if (ctx.event.aggregateType !== "property") return { skipped: "el evento no es de una propiedad" };
  if (!(await isEnabled(ctx.db, PROPERTY_QA_FLAG))) return { skipped: "flag ai_property_quality apagado" };
  const id = await enqueuePropertyQuality(ctx.db, ctx.event.aggregateId, `event:${ctx.event.id}`);
  return { enqueued: Boolean(id) };
});

// ───────────────────────────── Lecturas para el CRM ─────────────────────────────

export type QualityView = {
  score: number;
  completenessScore: number;
  criteria: Criterion[];
  findings: Finding[];
  mediaSummary: MediaSummary;
  computedAt: Date;
  rulesVersion: string;
  stale: boolean;
};

export async function getPropertyQuality(db: Database, actor: Actor, propertyId: string): Promise<{ enabled: boolean; report: QualityView | null }> {
  requirePermission(actor, "properties.read");
  if (!z.uuid().safeParse(propertyId).success) throw notFound("Propiedad");
  const enabled = await isEnabled(db, PROPERTY_QA_FLAG);
  if (!enabled) return { enabled, report: null };
  const row = await db
    .selectFrom("property_quality_reports as q")
    .innerJoin("properties as p", "p.id", "q.property_id")
    .select(["q.score", "q.completeness_score", "q.criteria", "q.findings", "q.media_summary", "q.computed_at", "q.rules_version", "p.updated_at"])
    .where("q.property_id", "=", propertyId)
    .where("p.organization_id", "=", actor.organizationId)
    .executeTakeFirst();
  if (!row) return { enabled, report: null };
  return {
    enabled,
    report: {
      score: row.score,
      completenessScore: row.completeness_score,
      criteria: row.criteria as unknown as Criterion[],
      findings: row.findings as unknown as Finding[],
      mediaSummary: row.media_summary as unknown as MediaSummary,
      computedAt: new Date(row.computed_at),
      rulesVersion: row.rules_version,
      stale: row.rules_version !== QUALITY_RULES_VERSION || new Date(row.updated_at).getTime() > new Date(row.computed_at).getTime() + 1000,
    },
  };
}

/** «Recalcular ahora» desde la ficha (lo mismo que hace el job; no modifica la propiedad). */
export async function recomputeQualityNow(db: Database, actor: Actor, propertyId: string): Promise<ComputeResult> {
  requirePermission(actor, "properties.read");
  if (!z.uuid().safeParse(propertyId).success) throw notFound("Propiedad");
  const p = await db.selectFrom("properties").select("id").where("id", "=", propertyId).where("organization_id", "=", actor.organizationId).where("deleted_at", "is", null).executeTakeFirst();
  if (!p) throw notFound("Propiedad");
  return computePropertyQuality(db, actor, propertyId);
}
