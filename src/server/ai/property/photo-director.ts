/**
 * AI Photo Director: ambiente por foto (manual siempre; con clave, sugerencias de visión a aceptar), orden y portada
 * sugeridos por reglas (photo-order.ts) y «Aplicar orden sugerido» con confirmación y auditoría. Nunca borra fotos.
 *
 * Permisos: ver = `properties.read`; etiquetar, revisar sugerencias, pedir sugerencias y aplicar el orden =
 * `properties.manage_media` (el mismo que ordenar fotos y elegir portada a mano).
 */
import { z } from "zod";
import sharp from "sharp";
import { sql, type Database, type Tx } from "../../db";
import { audit } from "../../audit";
import { actorUserId, requirePermission, type Actor } from "../../auth/actor";
import { emitEvent } from "../../events";
import { AppError, conflict, invalid, notFound } from "../../errors";
import { isEnabled } from "../../flags";
import { enqueue } from "../../jobs/queue";
import { registerJobHandler } from "../../jobs/registry";
import { errorFields, log } from "../../log";
import { protectImportedFields } from "../../properties/service";
import { storage } from "../../storage";
import { untrustedData } from "../core/governance";
import type { AIContentBlock } from "../core/types";
import { photoTagsPrompt } from "../prompts/photo-tags";
import { aiAvailable, runExtractTask, type TaskDeps } from "../run-task";
import { duplicateGroups, IMAGE_METRICS_VERSION, isBlurry, isDark } from "./image-metrics";
import { suggestPhotoOrder, type OrderMedia, type SuggestedOrder } from "./photo-order";
import { enqueuePropertyQuality } from "./quality";
import { ROOM_KEYS, ROOM_LABEL, type RoomKey } from "./quality-rules";

export const PHOTO_DIRECTOR_FLAG = "ai_photo_director";
export const PHOTO_TAGS_JOB = "ai.photo_tags";
/** Imágenes por llamada de visión (y tamaño de la miniatura enviada). */
export const VISION_IMAGES_PER_CALL = 6;
export const VISION_THUMB_EDGE = 512;

const uuid = z.uuid();
const roomSchema = z.enum(ROOM_KEYS);

export async function assertPhotoDirectorEnabled(db: Database | Tx): Promise<void> {
  if (!(await isEnabled(db, PHOTO_DIRECTOR_FLAG))) throw new AppError("unavailable", "El director de fotos está desactivado");
}

async function lockProperty(trx: Tx, actor: Actor, propertyId: string) {
  const p = await trx.selectFrom("properties").select(["id", "organization_id"]).where("id", "=", propertyId).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
  if (!p || p.organization_id !== actor.organizationId) throw notFound("Propiedad");
  return p;
}

async function loadMediaRow(trx: Tx, propertyId: string, mediaId: string) {
  const m = await trx
    .selectFrom("property_media as m")
    .leftJoin("property_media_rooms as r", "r.media_id", "m.id")
    .select(["m.id", "m.kind", "r.room", "r.room_source", "r.suggested_room", "r.suggested_confidence", "r.suggestion_status"])
    .where("m.id", "=", mediaId)
    .where("m.property_id", "=", propertyId)
    .where("m.deleted_at", "is", null)
    .executeTakeFirst();
  if (!m) throw notFound("Foto");
  return m;
}

// ───────────────────────────── Lectura ─────────────────────────────

export type PhotoDirectorItem = {
  id: string;
  kind: string;
  room: RoomKey | null;
  roomSource: "manual" | "ai_accepted" | null;
  suggestion: { room: RoomKey; confidence: number } | null;
  stored: boolean;
  dark: boolean;
  blurry: boolean;
  duplicateOf: string | null;
};

export type PhotoDirectorView = {
  enabled: boolean;
  items: PhotoDirectorItem[];
  suggestion: SuggestedOrder;
  pendingSuggestions: number;
  /** Fotos propias sin etiqueta ni sugerencia vigente: lo único que la visión puede analizar. */
  visionCandidates: number;
  aiAvailable: boolean;
  visionJobQueued: boolean;
};

export async function getPhotoDirector(db: Database, actor: Actor, propertyId: string, deps: TaskDeps = {}): Promise<PhotoDirectorView> {
  requirePermission(actor, "properties.read");
  if (!uuid.safeParse(propertyId).success) throw notFound("Propiedad");
  const enabled = await isEnabled(db, PHOTO_DIRECTOR_FLAG);
  const rows = await db
    .selectFrom("property_media as m")
    .innerJoin("properties as p", "p.id", "m.property_id")
    .leftJoin("files as f", (j) => j.onRef("f.id", "=", "m.file_id").on("f.deleted_at", "is", null))
    .leftJoin("property_media_rooms as r", "r.media_id", "m.id")
    .leftJoin("property_media_analysis as a", (j) => j.onRef("a.media_id", "=", "m.id").onRef("a.file_id", "=", "m.file_id").on("a.algorithm_version", "=", IMAGE_METRICS_VERSION))
    .select(["m.id", "m.kind", "m.status", "m.is_cover", "m.sort_order", "f.id as f_id", "f.checksum_sha256", "r.room", "r.room_source", "r.suggested_room", "r.suggested_confidence", "r.suggestion_status", "r.suggestion_checksum", "a.dhash", "a.luminance_mean", "a.luminance_p95", "a.laplacian_variance", "a.luminance_variance"])
    .where("m.property_id", "=", propertyId)
    .where("p.organization_id", "=", actor.organizationId)
    .where("m.deleted_at", "is", null)
    .orderBy("m.sort_order")
    .orderBy("m.created_at")
    .execute();
  const analyzed = rows.filter((r) => r.kind === "image" && r.dhash);
  const dupOf = new Map<string, string>();
  for (const g of duplicateGroups(analyzed.map((r) => ({ id: r.id, dhash: r.dhash! })))) for (const id of g.slice(1)) dupOf.set(id, g[0]!);
  const items: PhotoDirectorItem[] = rows.map((r) => {
    const metrics = r.dhash ? { luminanceMean: Number(r.luminance_mean), luminanceP95: Number(r.luminance_p95), laplacianVariance: Number(r.laplacian_variance), luminanceVariance: Number(r.luminance_variance) } : null;
    return {
      id: r.id,
      kind: r.kind,
      room: (r.room as RoomKey | null) ?? null,
      roomSource: (r.room_source as PhotoDirectorItem["roomSource"]) ?? null,
      suggestion: r.suggestion_status === "pending" && r.suggested_room ? { room: r.suggested_room as RoomKey, confidence: Number(r.suggested_confidence) } : null,
      stored: r.status === "stored" && Boolean(r.f_id),
      dark: metrics ? isDark(metrics) : false,
      blurry: metrics ? isBlurry(metrics) : false,
      duplicateOf: dupOf.get(r.id) ?? null,
    };
  });
  const orderInput: OrderMedia[] = rows.map((r, i) => ({ id: r.id, kind: r.kind, isCover: r.is_cover, sortOrder: r.sort_order * 1000 + i, room: items[i]!.room, dark: items[i]!.dark, blurry: items[i]!.blurry, duplicateOf: items[i]!.duplicateOf }));
  const visionCandidates = rows.filter((r) => r.kind === "image" && r.status === "stored" && r.f_id && !r.room && !(r.suggestion_checksum && r.suggestion_checksum === r.checksum_sha256)).length;
  const queued = await db.selectFrom("jobs").select("id").where("type", "=", PHOTO_TAGS_JOB).where("status", "in", ["queued", "running"]).where(sql<boolean>`payload->>'propertyId' = ${propertyId}`).executeTakeFirst();
  return {
    enabled,
    items,
    suggestion: suggestPhotoOrder(orderInput),
    pendingSuggestions: items.filter((i) => i.suggestion).length,
    visionCandidates,
    aiAvailable: enabled && visionCandidates > 0 ? await aiAvailable(db, deps) : false,
    visionJobQueued: Boolean(queued),
  };
}

// ───────────────────────────── Etiquetado manual y revisión ─────────────────────────────

export const setRoomSchema = z.object({ propertyId: z.uuid(), mediaId: z.uuid(), room: roomSchema.nullable() });

export async function setMediaRoom(db: Database, actor: Actor, raw: z.input<typeof setRoomSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "properties.manage_media");
  const input = setRoomSchema.parse(raw);
  await assertPhotoDirectorEnabled(db);
  return db.transaction().execute(async (trx) => {
    await lockProperty(trx, actor, input.propertyId);
    const m = await loadMediaRow(trx, input.propertyId, input.mediaId);
    if ((m.room ?? null) === input.room && (input.room === null || m.room_source === "manual")) return { changed: false };
    const now = new Date();
    const values = input.room
      ? { room: input.room, room_source: "manual", room_confidence: null, tagged_by: actorUserId(actor), tagged_at: now }
      : { room: null, room_source: null, room_confidence: null, tagged_by: null, tagged_at: null };
    // Una etiqueta manual resuelve la sugerencia pendiente (la persona decidió).
    const suggestion = m.suggestion_status === "pending" ? { suggestion_status: input.room === m.suggested_room ? "accepted" : "dismissed" } : {};
    await trx
      .insertInto("property_media_rooms")
      .values({ media_id: input.mediaId, property_id: input.propertyId, ...values })
      .onConflict((oc) => oc.column("media_id").doUpdateSet({ ...values, ...suggestion }))
      .execute();
    await audit(trx, actor, { action: "PROPERTY_MEDIA_ROOM_SET", entityType: "property", entityId: input.propertyId, before: { mediaId: input.mediaId, room: m.room ?? null, source: m.room_source ?? null }, after: { mediaId: input.mediaId, room: input.room, source: input.room ? "manual" : null } });
    await enqueuePropertyQuality(trx, input.propertyId, `room:${input.mediaId}:${now.getTime()}`);
    return { changed: true };
  });
}

export const reviewSuggestionSchema = z.object({ propertyId: z.uuid(), mediaIds: z.array(z.uuid()).min(1).max(200), decision: z.enum(["accept", "dismiss"]) });

/** Acepta o descarta sugerencias PENDIENTES (una o todas). Aceptar copia la sugerencia a la etiqueta con su confianza. */
export async function reviewRoomSuggestions(db: Database, actor: Actor, raw: z.input<typeof reviewSuggestionSchema>): Promise<{ changed: number }> {
  requirePermission(actor, "properties.manage_media");
  const input = reviewSuggestionSchema.parse(raw);
  await assertPhotoDirectorEnabled(db);
  return db.transaction().execute(async (trx) => {
    await lockProperty(trx, actor, input.propertyId);
    const pending = await trx
      .selectFrom("property_media_rooms as r")
      .innerJoin("property_media as m", "m.id", "r.media_id")
      .select(["r.media_id", "r.room", "r.suggested_room", "r.suggested_confidence"])
      .where("r.property_id", "=", input.propertyId)
      .where("r.media_id", "in", input.mediaIds)
      .where("r.suggestion_status", "=", "pending")
      .where("m.deleted_at", "is", null)
      .execute();
    if (!pending.length) return { changed: 0 };
    const now = new Date();
    for (const r of pending) {
      await trx
        .updateTable("property_media_rooms")
        .set(
          input.decision === "accept"
            ? { room: r.suggested_room, room_source: "ai_accepted", room_confidence: r.suggested_confidence, tagged_by: actorUserId(actor), tagged_at: now, suggestion_status: "accepted" }
            : { suggestion_status: "dismissed" },
        )
        .where("media_id", "=", r.media_id)
        .execute();
    }
    await audit(trx, actor, {
      action: input.decision === "accept" ? "PROPERTY_MEDIA_ROOM_SUGGESTIONS_ACCEPTED" : "PROPERTY_MEDIA_ROOM_SUGGESTIONS_DISMISSED",
      entityType: "property",
      entityId: input.propertyId,
      after: pending.map((r) => ({ mediaId: r.media_id, suggested: r.suggested_room, confidence: Number(r.suggested_confidence), previous: r.room })),
    });
    if (input.decision === "accept") await enqueuePropertyQuality(trx, input.propertyId, `rooms-accepted:${now.getTime()}`);
    return { changed: pending.length };
  });
}

// ───────────────────────────── Orden sugerido ─────────────────────────────

export const applyOrderSchema = z.object({ propertyId: z.uuid(), order: z.array(z.uuid()).min(1).max(200), heroId: z.uuid().nullable() });

/**
 * Aplica el orden y la portada sugeridos que la persona vio y confirmó. Se recalcula la sugerencia en el servidor: si
 * cambió mientras tanto (otra persona movió fotos o etiquetas), no se aplica nada (conflicto) y hay que revisar de nuevo.
 */
export async function applySuggestedOrder(db: Database, actor: Actor, raw: z.input<typeof applyOrderSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "properties.manage_media");
  const input = applyOrderSchema.parse(raw);
  await assertPhotoDirectorEnabled(db);
  const view = await getPhotoDirector(db, actor, input.propertyId);
  const s = view.suggestion;
  if (s.basis === "none") throw invalid("Etiquetá los ambientes de las fotos para poder sugerir un orden");
  if (s.order.join(",") !== input.order.join(",") || s.heroId !== input.heroId) throw conflict("Las fotos cambiaron mientras revisabas la sugerencia: recargá la página y volvé a revisarla");
  if (!s.changed) return { changed: false };
  return db.transaction().execute(async (trx) => {
    await lockProperty(trx, actor, input.propertyId);
    const current = await trx.selectFrom("property_media").select(["id", "is_cover", "kind"]).where("property_id", "=", input.propertyId).where("deleted_at", "is", null).orderBy("sort_order").orderBy("created_at").execute();
    const ids = current.map((m) => m.id);
    if (ids.length !== input.order.length || !input.order.every((id) => ids.includes(id))) throw conflict("La multimedia cambió mientras revisabas: recargá la página");
    const prevCover = current.find((m) => m.is_cover)?.id ?? null;
    await sql`update property_media m set sort_order = o.ord * 10
      from unnest(${input.order}::uuid[]) with ordinality as o(id, ord)
      where m.id = o.id and m.property_id = ${input.propertyId}`.execute(trx);
    if (input.heroId && input.heroId !== prevCover) {
      if (current.find((m) => m.id === input.heroId)?.kind !== "image") throw invalid("Solo una foto puede ser portada");
      await trx.updateTable("property_media").set({ is_cover: false }).where("property_id", "=", input.propertyId).where("is_cover", "=", true).execute();
      await trx.updateTable("property_media").set({ is_cover: true }).where("id", "=", input.heroId).execute();
    }
    await audit(trx, actor, {
      action: "PROPERTY_MEDIA_SUGGESTED_ORDER_APPLIED",
      entityType: "property",
      entityId: input.propertyId,
      before: { order: ids, coverMediaId: prevCover },
      after: { order: input.order, coverMediaId: input.heroId ?? prevCover },
      metadata: { reasons: s.reasons.slice(0, 20).map((r) => r.reason), rules: "photo-order" },
    });
    await protectImportedFields(trx, actor, input.propertyId, ["media"]);
    await trx.updateTable("properties").set({ updated_by: actorUserId(actor) }).where("id", "=", input.propertyId).execute();
    await emitEvent(trx, actor, { type: "property.updated", aggregateType: "property", aggregateId: input.propertyId, payload: { fields: ["media"], link: `/crm/propiedades/${input.propertyId}` } });
    return { changed: true };
  });
}

// ───────────────────────────── Sugerencias por visión (con clave) ─────────────────────────────

export async function requestRoomSuggestions(db: Database, actor: Actor, propertyId: string, deps: TaskDeps = {}): Promise<{ queued: boolean }> {
  requirePermission(actor, "properties.manage_media");
  if (!uuid.safeParse(propertyId).success) throw notFound("Propiedad");
  await assertPhotoDirectorEnabled(db);
  const p = await db.selectFrom("properties").select("id").where("id", "=", propertyId).where("organization_id", "=", actor.organizationId).where("deleted_at", "is", null).executeTakeFirst();
  if (!p) throw notFound("Propiedad");
  if (!(await aiAvailable(db, deps))) throw new AppError("unavailable", "La IA no está configurada o se agotó el presupuesto del día: etiquetá las fotos a mano");
  const id = await enqueue(db, { type: PHOTO_TAGS_JOB, payload: { propertyId, requestedBy: actorUserId(actor) }, dedupeKey: `${PHOTO_TAGS_JOB}:${propertyId}`, maxAttempts: 2, timeoutMs: 180_000 });
  return { queued: Boolean(id) };
}

/**
 * Sugiere ambientes con visión para fotos PROPIAS sin etiqueta (miniatura de 512 px desde nuestro storage; nunca el CDN
 * del sitio anterior). En lotes de 6 imágenes, hasta `ai.photo_director.vision_batch_size` por corrida, con presupuesto.
 * Solo escribe `suggested_*` (pendiente de revisión). Sin clave o ante error, no escribe nada.
 */
export async function suggestRoomsWithVision(db: Database, actor: Actor, propertyId: string, deps: TaskDeps = {}): Promise<{ suggested: number; reason?: string }> {
  if (!(await isEnabled(db, PHOTO_DIRECTOR_FLAG))) return { suggested: 0, reason: "flag apagado" };
  const batchSetting = await db.selectFrom("settings").select("value").where("key", "=", "ai.photo_director.vision_batch_size").executeTakeFirst();
  const maxPerRun = Math.min(48, Math.max(1, Number(batchSetting?.value) || 12));
  const driver = storage();
  const rows = await db
    .selectFrom("property_media as m")
    .innerJoin("files as f", "f.id", "m.file_id")
    .innerJoin("properties as p", "p.id", "m.property_id")
    .leftJoin("property_media_rooms as r", "r.media_id", "m.id")
    .select(["m.id", "f.bucket", "f.storage_key", "f.storage_driver", "f.checksum_sha256", "p.organization_id", "r.room", "r.suggestion_checksum"])
    .where("m.property_id", "=", propertyId)
    .where("m.deleted_at", "is", null)
    .where("m.kind", "=", "image")
    .where("m.status", "=", "stored")
    .where("f.deleted_at", "is", null)
    .orderBy("m.sort_order")
    .execute();
  const todo = rows.filter((r) => r.storage_driver === driver.name && !r.room && r.checksum_sha256 && r.suggestion_checksum !== r.checksum_sha256).slice(0, maxPerRun);
  if (!todo.length) return { suggested: 0, reason: "sin fotos propias pendientes" };
  let suggested = 0;
  for (let i = 0; i < todo.length; i += VISION_IMAGES_PER_CALL) {
    const batch = todo.slice(i, i + VISION_IMAGES_PER_CALL);
    const images: AIContentBlock[] = [];
    for (const [n, r] of batch.entries()) {
      const bytes = await driver.get(r.bucket, r.storage_key);
      const thumb = await sharp(Buffer.from(bytes)).rotate().resize({ width: VISION_THUMB_EDGE, height: VISION_THUMB_EDGE, fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
      images.push({ type: "text", text: `Imagen ${n + 1}:` }, { type: "image", mediaType: "image/jpeg", data: thumb.toString("base64") });
    }
    const res = await runExtractTask({
      db,
      who: { organizationId: batch[0]!.organization_id, userId: null, requestId: actor.requestId },
      purpose: "photo_tags",
      feature: "ai.photo_director.tags",
      task: "vision",
      prompt: photoTagsPrompt,
      context: [untrustedData("fotos", `Cantidad de imágenes: ${batch.length}. Devolvé una entrada por imagen (index 1…${batch.length}).`, 200)],
      messages: [{ role: "user", content: [...images, { type: "text", text: "Clasificá cada imagen." }] }],
      maxTokens: 400,
      timeoutMs: 40_000,
      entityType: "property",
      entityId: propertyId,
      deps,
      verify: (v) => v.photos.filter((p) => p.index > batch.length).map((p) => ({ kind: "unknown_index", value: String(p.index) })),
    });
    if (!res.ok) {
      log.warn("ai.photo_tags_unavailable", { propertyId, reason: res.reason });
      if (suggested === 0) return { suggested: 0, reason: res.reason };
      break;
    }
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      for (const p of res.value.photos) {
        const r = batch[p.index - 1]!;
        const values = { suggested_room: p.room, suggested_confidence: String(Math.round(p.confidence * 1000) / 1000), suggested_at: now, suggestion_status: "pending", suggestion_prompt: res.promptRef, suggestion_checksum: r.checksum_sha256 };
        // Nunca pisa una etiqueta puesta mientras tanto: solo completa la sugerencia.
        await trx
          .insertInto("property_media_rooms")
          .values({ media_id: r.id, property_id: propertyId, ...values })
          .onConflict((oc) => oc.column("media_id").doUpdateSet(values).where("property_media_rooms.room", "is", null))
          .execute();
        suggested++;
      }
      await emitEvent(trx, actor, { type: "media.tags_suggested", aggregateType: "property", aggregateId: propertyId, payload: { count: res.value.photos.length, prompt: res.promptRef }, dedupeKey: `media.tags_suggested:${propertyId}:${res.interactionId}` });
    });
  }
  return { suggested };
}

const tagsJobPayload = z.object({ propertyId: z.uuid() });
registerJobHandler(PHOTO_TAGS_JOB, async (payload, ctx) => {
  const { propertyId } = tagsJobPayload.parse(payload);
  try {
    return await suggestRoomsWithVision(ctx.db, ctx.actor, propertyId);
  } catch (e) {
    log.error("ai.photo_tags_failed", { propertyId, ...errorFields(e) });
    throw e;
  }
});

export { ROOM_LABEL, ROOM_KEYS };
