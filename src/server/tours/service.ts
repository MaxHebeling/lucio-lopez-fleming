/**
 * Tours virtuales: mutaciones del CRM. Reglas (docs/CONVENTIONS.md):
 * permiso en servidor → zod → transacción con bloqueo del tour → auditoría → evento virtual_tour.* (revalida el sitio).
 * - Editar: `properties.manage_media`. Publicar/despublicar/borrar un tour publicado: `properties.publish`.
 * - La demo (is_demo) no se edita desde el CRM: se actualiza con `pnpm seed:demo-tour` desde el manifiesto.
 * - Un tour publicado nunca queda inválido: si una edición lo rompería (ocultar la escena inicial, borrar un destino),
 *   se rechaza con el motivo.
 * - Archivos: se suben ANTES de la transacción; si falla, se borran. Las bajas marcan files.deleted_at y los objetos
 *   se borran del bucket después del commit.
 */
import "server-only";
import { z } from "zod";
import { sql, type Database, type Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { parseInput } from "../validate";
import { registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { clampPitch, normalizeYaw, parseHttpsUrl, tourPublishBlockers, type GraphTour } from "./model";
import { assertTourStorage, discardObjects, insertPublicFile, processFloorPlan, processPanorama, putPublicObject, removeDeletedTourFiles } from "./media";
import { errorFields, log } from "../log";

export const MAX_SCENES_PER_TOUR = 60;
export const MAX_HOTSPOTS_PER_SCENE = 40;

const uuid = z.uuid();
const yawSchema = z.number().refine(Number.isFinite, "Ángulo inválido").transform(normalizeYaw);
const pitchSchema = z.number().refine(Number.isFinite, "Ángulo inválido").transform(clampPitch);
const providerSchema = z.enum(["matterport", "kuula", "3dvista", "other"]);
const httpsUrl = z
  .string()
  .trim()
  .max(2000, "URL demasiado larga")
  .refine((v) => parseHttpsUrl(v) !== null, "Tiene que ser una URL https:// válida");
const optionalHttpsUrl = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), httpsUrl.nullable().optional());

export const createTourSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("internal") }),
  z.object({ kind: z.literal("external"), provider: providerSchema, externalUrl: httpsUrl, embedUrl: optionalHttpsUrl }),
]);
export const externalTourSchema = z.object({ provider: providerSchema, externalUrl: httpsUrl, embedUrl: optionalHttpsUrl });
export const sceneNameSchema = z.string().trim().min(1, "Poné un nombre").max(80, "Máximo 80 caracteres");
export const updateSceneSchema = z
  .object({
    name: sceneNameSchema.optional(),
    isPublished: z.boolean().optional(),
    initialYaw: yawSchema.optional(),
    initialPitch: pitchSchema.optional(),
    plan: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
  })
  .strict();
export const hotspotSchema = z
  .object({
    kind: z.enum(["scene", "info", "cta"]),
    targetSceneId: uuid.nullable().optional(),
    label: z.string().trim().min(1, "Poné un texto").max(80, "Máximo 80 caracteres"),
    content: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(600, "Máximo 600 caracteres").nullable().optional()),
    yaw: yawSchema,
    pitch: pitchSchema,
  })
  .strict()
  .superRefine((h, ctx) => {
    if (h.kind === "scene" && !h.targetSceneId) ctx.addIssue({ code: "custom", path: ["targetSceneId"], message: "Elegí a qué escena lleva" });
    if (h.kind !== "scene" && h.targetSceneId) ctx.addIssue({ code: "custom", path: ["targetSceneId"], message: "Solo los puntos de navegación llevan a otra escena" });
    if (h.kind === "info" && !h.content) ctx.addIssue({ code: "custom", path: ["content"], message: "Escribí el texto de la tarjeta" });
  });
export const tourSettingsSchema = z.object({ startSceneId: uuid.nullable().optional(), guidedSceneIds: z.array(uuid).max(MAX_SCENES_PER_TOUR).optional() }).strict();

function assertUuid(v: string, what: string) {
  if (!uuid.safeParse(v).success) throw notFound(what);
}

export function slugifyScene(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "escena"
  );
}

type TourRow = { id: string; property_id: string; kind: string; status: string; is_demo: boolean; start_scene_id: string | null; guided_scene_ids: string[]; floor_plan_file_id: string | null; provider: string | null; external_url: string | null; embed_url: string | null };

async function lockTour(trx: Tx, tourId: string): Promise<TourRow> {
  assertUuid(tourId, "Tour");
  const t = await trx
    .selectFrom("virtual_tours")
    .select(["id", "property_id", "kind", "status", "is_demo", "start_scene_id", "guided_scene_ids", "floor_plan_file_id", "provider", "external_url", "embed_url"])
    .where("id", "=", tourId)
    .forUpdate()
    .executeTakeFirst();
  if (!t) throw notFound("Tour");
  if (t.is_demo) throw forbidden("El tour de la demo se actualiza desde su manifiesto (pnpm seed:demo-tour), no desde el CRM");
  return t as TourRow;
}

async function tourIdOfScene(db: Database | Tx, sceneId: string): Promise<string> {
  assertUuid(sceneId, "Escena");
  const s = await db.selectFrom("virtual_tour_scenes").select("tour_id").where("id", "=", sceneId).executeTakeFirst();
  if (!s) throw notFound("Escena");
  return s.tour_id;
}

async function tourIdOfHotspot(db: Database | Tx, hotspotId: string): Promise<string> {
  assertUuid(hotspotId, "Punto");
  const h = await db.selectFrom("virtual_tour_hotspots as h").innerJoin("virtual_tour_scenes as s", "s.id", "h.scene_id").select("s.tour_id").where("h.id", "=", hotspotId).executeTakeFirst();
  if (!h) throw notFound("Punto");
  return h.tour_id;
}

export async function loadTourGraph(db: Database | Tx, tourId: string): Promise<GraphTour> {
  const t = await db.selectFrom("virtual_tours").select(["kind", "provider", "external_url", "embed_url", "start_scene_id", "guided_scene_ids"]).where("id", "=", tourId).executeTakeFirstOrThrow();
  const scenes = await db.selectFrom("virtual_tour_scenes").select(["id", "name", "is_published"]).where("tour_id", "=", tourId).orderBy("sort_order").orderBy("created_at").execute();
  const hotspots = scenes.length
    ? await db.selectFrom("virtual_tour_hotspots").select(["scene_id", "kind", "target_scene_id", "label"]).where("scene_id", "in", scenes.map((s) => s.id)).execute()
    : [];
  return {
    kind: t.kind as GraphTour["kind"],
    provider: t.provider as GraphTour["provider"],
    externalUrl: t.external_url,
    embedUrl: t.embed_url,
    startSceneId: t.start_scene_id,
    guidedSceneIds: t.guided_scene_ids,
    scenes: scenes.map((s) => ({
      id: s.id,
      name: s.name,
      isPublished: s.is_published,
      hotspots: hotspots.filter((h) => h.scene_id === s.id).map((h) => ({ kind: h.kind as "scene" | "info" | "cta", targetSceneId: h.target_scene_id, label: h.label })),
    })),
  };
}

/** Después de editar un tour publicado: sigue siendo publicable o se revierte la transacción con el motivo. */
async function assertPublishedStillValid(trx: Tx, tour: TourRow): Promise<void> {
  if (tour.status !== "published") return;
  const blockers = tourPublishBlockers(await loadTourGraph(trx, tour.id));
  if (blockers.length) throw conflict(`El tour está publicado y este cambio lo dejaría incompleto: ${blockers.join(" · ")}. Despublicalo antes o corregí eso primero.`);
}

async function touch(trx: Tx, actor: Actor, tour: TourRow, action: string, entity: { before?: unknown; after?: unknown }) {
  await trx.updateTable("virtual_tours").set({ updated_by: actorUserId(actor) }).where("id", "=", tour.id).execute();
  await audit(trx, actor, { action, entityType: "virtual_tour", entityId: tour.id, before: entity.before, after: entity.after, metadata: { propertyId: tour.property_id } });
  await emitEvent(trx, actor, { type: "virtual_tour.updated", aggregateType: "virtual_tour", aggregateId: tour.id, payload: { propertyId: tour.property_id, action, link: `/crm/propiedades/${tour.property_id}/tour` } });
}

// ───────────────────────── Tour ─────────────────────────

export async function createTour(db: Database, actor: Actor, propertyId: string, raw: unknown): Promise<{ id: string }> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(propertyId, "Propiedad");
  const input = parseInput(createTourSchema, raw);
  return db.transaction().execute(async (trx) => {
    const p = await trx.selectFrom("properties").select(["id", "is_demo"]).where("id", "=", propertyId).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
    if (!p) throw notFound("Propiedad");
    if (p.is_demo) throw forbidden("La propiedad demo tiene su tour desde el manifiesto (pnpm seed:demo-tour)");
    const exists = await trx.selectFrom("virtual_tours").select("id").where("property_id", "=", propertyId).executeTakeFirst();
    if (exists) throw conflict("Esta propiedad ya tiene un tour virtual");
    const row = await trx
      .insertInto("virtual_tours")
      .values({
        property_id: propertyId,
        kind: input.kind,
        provider: input.kind === "external" ? input.provider : null,
        external_url: input.kind === "external" ? input.externalUrl : null,
        embed_url: input.kind === "external" ? (input.embedUrl ?? null) : null,
        created_by: actorUserId(actor),
        updated_by: actorUserId(actor),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await audit(trx, actor, { action: "VIRTUAL_TOUR_CREATED", entityType: "virtual_tour", entityId: row.id, after: input, metadata: { propertyId } });
    await emitEvent(trx, actor, { type: "virtual_tour.updated", aggregateType: "virtual_tour", aggregateId: row.id, payload: { propertyId, action: "created" } });
    return row;
  });
}

export async function updateExternalTour(db: Database, actor: Actor, tourId: string, raw: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const input = parseInput(externalTourSchema, raw);
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    if (t.kind !== "external") throw invalid("Solo un tour externo tiene proveedor y URL");
    const after = { provider: input.provider, external_url: input.externalUrl, embed_url: input.embedUrl ?? null };
    const before = { provider: t.provider, external_url: t.external_url, embed_url: t.embed_url };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await trx.updateTable("virtual_tours").set(after).where("id", "=", t.id).execute();
    await touch(trx, actor, t, "VIRTUAL_TOUR_EXTERNAL_UPDATED", { before, after });
  });
}

/** Borra el tour completo (escenas, puntos y archivos). Si estaba publicado requiere permiso de publicación. */
export async function deleteTour(db: Database, actor: Actor, tourId: string): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const fileIds = await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    if (t.status === "published") requirePermission(actor, "properties.publish");
    const files = await sql<{ id: string }>`
      select unnest(array[panorama_file_id, preview_file_id, thumbnail_file_id]) as id from virtual_tour_scenes where tour_id = ${t.id}
      union select floor_plan_file_id from virtual_tours where id = ${t.id}
      union select cover_file_id from virtual_tours where id = ${t.id}`.execute(trx);
    const ids = files.rows.map((r) => r.id).filter(Boolean);
    await trx.deleteFrom("virtual_tours").where("id", "=", t.id).execute();
    if (ids.length) await trx.updateTable("files").set({ deleted_at: new Date() }).where("id", "in", ids).where("deleted_at", "is", null).execute();
    await audit(trx, actor, { action: "VIRTUAL_TOUR_DELETED", entityType: "virtual_tour", entityId: t.id, before: { kind: t.kind, status: t.status }, metadata: { propertyId: t.property_id } });
    await emitEvent(trx, actor, { type: t.status === "published" ? "virtual_tour.unpublished" : "virtual_tour.updated", aggregateType: "virtual_tour", aggregateId: t.id, payload: { propertyId: t.property_id, action: "deleted" } });
    return ids;
  });
  await removeDeletedTourFiles(db, fileIds).catch((e) => log.error("tours.delete_files_failed", { tourId, ...errorFields(e) }));
}

export async function publishTour(db: Database, actor: Actor, tourId: string): Promise<{ propertyPublished: boolean }> {
  requirePermission(actor, "properties.publish");
  return db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    const p = await trx.selectFrom("properties").select(["is_published"]).where("id", "=", t.property_id).executeTakeFirstOrThrow();
    if (t.status === "published") return { propertyPublished: p.is_published };
    const blockers = tourPublishBlockers(await loadTourGraph(trx, t.id));
    if (blockers.length) throw invalid(`No se puede publicar el tour: ${blockers.join(" · ")}`);
    await trx.updateTable("virtual_tours").set({ status: "published", published_at: sql`coalesce(published_at, now())`, updated_by: actorUserId(actor) }).where("id", "=", t.id).execute();
    await audit(trx, actor, { action: "VIRTUAL_TOUR_PUBLISHED", entityType: "virtual_tour", entityId: t.id, metadata: { propertyId: t.property_id, propertyPublished: p.is_published } });
    await emitEvent(trx, actor, { type: "virtual_tour.published", aggregateType: "virtual_tour", aggregateId: t.id, payload: { propertyId: t.property_id, link: `/crm/propiedades/${t.property_id}/tour` } });
    return { propertyPublished: p.is_published };
  });
}

export async function unpublishTour(db: Database, actor: Actor, tourId: string): Promise<void> {
  requirePermission(actor, "properties.publish");
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    if (t.status !== "published") return;
    await trx.updateTable("virtual_tours").set({ status: "draft", updated_by: actorUserId(actor) }).where("id", "=", t.id).execute();
    await audit(trx, actor, { action: "VIRTUAL_TOUR_UNPUBLISHED", entityType: "virtual_tour", entityId: t.id, metadata: { propertyId: t.property_id } });
    await emitEvent(trx, actor, { type: "virtual_tour.unpublished", aggregateType: "virtual_tour", aggregateId: t.id, payload: { propertyId: t.property_id } });
  });
}

/** Escena inicial y recorrido guiado (solo escenas de este tour, sin repetidas). */
export async function updateTourSettings(db: Database, actor: Actor, tourId: string, raw: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const input = parseInput(tourSettingsSchema, raw);
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    if (t.kind !== "internal") throw invalid("Solo un tour propio tiene escenas");
    const sceneIds = new Set((await trx.selectFrom("virtual_tour_scenes").select("id").where("tour_id", "=", t.id).execute()).map((s) => s.id));
    const patch: { start_scene_id?: string | null; guided_scene_ids?: string[] } = {};
    if (input.startSceneId !== undefined) {
      if (input.startSceneId && !sceneIds.has(input.startSceneId)) throw invalid("La escena inicial tiene que ser de este tour", { startSceneId: ["Escena inválida"] });
      patch.start_scene_id = input.startSceneId;
    }
    if (input.guidedSceneIds !== undefined) {
      if (new Set(input.guidedSceneIds).size !== input.guidedSceneIds.length) throw invalid("El recorrido guiado repite escenas", { guidedSceneIds: ["Escenas repetidas"] });
      if (input.guidedSceneIds.some((id) => !sceneIds.has(id))) throw invalid("El recorrido guiado solo puede usar escenas de este tour", { guidedSceneIds: ["Escena inválida"] });
      patch.guided_scene_ids = input.guidedSceneIds;
    }
    if (!Object.keys(patch).length) return;
    await trx.updateTable("virtual_tours").set(patch).where("id", "=", t.id).execute();
    await assertPublishedStillValid(trx, t);
    await touch(trx, actor, t, "VIRTUAL_TOUR_SETTINGS_UPDATED", { before: { start_scene_id: t.start_scene_id, guided_scene_ids: t.guided_scene_ids }, after: patch });
  });
}

// ───────────────────────── Escenas ─────────────────────────

export async function addScene(db: Database, actor: Actor, tourId: string, bytes: Uint8Array, raw: { name?: unknown; originalName?: string | null }): Promise<{ sceneId: string; width: number; height: number }> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(tourId, "Tour");
  const name = parseInput(sceneNameSchema, raw.name);
  const pre = await db.selectFrom("virtual_tours").select(["kind", "is_demo"]).where("id", "=", tourId).executeTakeFirst();
  if (!pre) throw notFound("Tour");
  if (pre.is_demo) throw forbidden("El tour de la demo se actualiza desde su manifiesto (pnpm seed:demo-tour), no desde el CRM");
  if (pre.kind !== "internal") throw invalid("Un tour externo no tiene escenas propias");
  assertTourStorage();
  const img = await processPanorama(bytes);
  const prefix = `tours/${tourId}/scenes`;
  const stored: Array<{ bucket: string; key: string }> = [];
  try {
    const pano = await putPublicObject(prefix, img.panorama.bytes, "image/jpeg", "jpg");
    stored.push(pano);
    const preview = await putPublicObject(`${prefix}/previews`, img.preview.bytes, "image/jpeg", "jpg");
    stored.push(preview);
    const thumb = await putPublicObject(`${prefix}/thumbs`, img.thumbnail.bytes, "image/jpeg", "jpg");
    stored.push(thumb);
    const fileName = raw.originalName ? raw.originalName.replace(/[\p{Cc}\\/]/gu, "_").slice(0, 200) : null;
    return await db.transaction().execute(async (trx) => {
      const t = await lockTour(trx, tourId);
      const counts = await trx
        .selectFrom("virtual_tour_scenes")
        .select([sql<number>`count(*)::int`.as("n"), sql<number>`coalesce(max(sort_order), 0)::int`.as("max_order")])
        .where("tour_id", "=", t.id)
        .executeTakeFirstOrThrow();
      if (counts.n >= MAX_SCENES_PER_TOUR) throw conflict(`El tour ya tiene ${MAX_SCENES_PER_TOUR} escenas`);
      const uploader = actorUserId(actor);
      const f1 = await insertPublicFile(trx, pano, { bytes: img.panorama.bytes, contentType: "image/jpeg", width: img.panorama.width, height: img.panorama.height, name: fileName, uploadedBy: uploader });
      const f2 = await insertPublicFile(trx, preview, { bytes: img.preview.bytes, contentType: "image/jpeg", width: img.preview.width, height: img.preview.height, name: fileName, uploadedBy: uploader });
      const f3 = await insertPublicFile(trx, thumb, { bytes: img.thumbnail.bytes, contentType: "image/jpeg", width: img.thumbnail.width, height: img.thumbnail.height, name: fileName, uploadedBy: uploader });
      const base = slugifyScene(name);
      const taken = new Set((await trx.selectFrom("virtual_tour_scenes").select("slug").where("tour_id", "=", t.id).execute()).map((s) => s.slug));
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
      const scene = await trx
        .insertInto("virtual_tour_scenes")
        .values({
          tour_id: t.id,
          name,
          slug,
          panorama_file_id: f1.fileId,
          preview_file_id: f2.fileId,
          thumbnail_file_id: f3.fileId,
          width: img.panorama.width,
          height: img.panorama.height,
          sort_order: counts.max_order + 10,
          is_published: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (!t.start_scene_id) await trx.updateTable("virtual_tours").set({ start_scene_id: scene.id }).where("id", "=", t.id).execute();
      await touch(trx, actor, t, "VIRTUAL_TOUR_SCENE_ADDED", { after: { sceneId: scene.id, name, slug, width: img.panorama.width, height: img.panorama.height, sourceWidth: img.sourceWidth } });
      return { sceneId: scene.id, width: img.panorama.width, height: img.panorama.height };
    });
  } catch (e) {
    await discardObjects(stored);
    throw e;
  }
}

export async function updateScene(db: Database, actor: Actor, sceneId: string, raw: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const input = parseInput(updateSceneSchema, raw);
  const tourId = await tourIdOfScene(db, sceneId);
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    const s = await trx.selectFrom("virtual_tour_scenes").select(["id", "name", "is_published", "initial_yaw", "initial_pitch", "plan_x", "plan_y"]).where("id", "=", sceneId).where("tour_id", "=", t.id).forUpdate().executeTakeFirst();
    if (!s) throw notFound("Escena");
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== s.name) patch.name = input.name;
    if (input.isPublished !== undefined && input.isPublished !== s.is_published) patch.is_published = input.isPublished;
    if (input.initialYaw !== undefined) patch.initial_yaw = input.initialYaw;
    if (input.initialPitch !== undefined) patch.initial_pitch = input.initialPitch;
    if (input.plan !== undefined) {
      patch.plan_x = input.plan?.x ?? null;
      patch.plan_y = input.plan?.y ?? null;
    }
    if (!Object.keys(patch).length) return;
    await trx.updateTable("virtual_tour_scenes").set(patch).where("id", "=", s.id).execute();
    await assertPublishedStillValid(trx, t);
    await touch(trx, actor, t, "VIRTUAL_TOUR_SCENE_UPDATED", { before: { sceneId, name: s.name, is_published: s.is_published, initial_yaw: s.initial_yaw, initial_pitch: s.initial_pitch, plan_x: s.plan_x, plan_y: s.plan_y }, after: { sceneId, ...patch } });
  });
}

export async function reorderScenes(db: Database, actor: Actor, tourId: string, rawIds: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const ids = parseInput(z.array(uuid).min(1).max(MAX_SCENES_PER_TOUR), rawIds);
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    const current = (await trx.selectFrom("virtual_tour_scenes").select("id").where("tour_id", "=", t.id).orderBy("sort_order").orderBy("created_at").execute()).map((s) => s.id);
    if (current.length !== ids.length || new Set(ids).size !== ids.length || !ids.every((i) => current.includes(i))) throw conflict("Las escenas cambiaron mientras ordenabas: recargá la página");
    if (current.every((v, i) => v === ids[i])) return;
    await sql`update virtual_tour_scenes s set sort_order = o.ord * 10 from unnest(${ids}::uuid[]) with ordinality as o(id, ord) where s.id = o.id and s.tour_id = ${t.id}`.execute(trx);
    await touch(trx, actor, t, "VIRTUAL_TOUR_SCENES_REORDERED", { before: { order: current }, after: { order: ids } });
  });
}

export async function deleteScene(db: Database, actor: Actor, sceneId: string): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const tourId = await tourIdOfScene(db, sceneId);
  const fileIds = await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    const s = await trx.selectFrom("virtual_tour_scenes").select(["id", "name", "panorama_file_id", "preview_file_id", "thumbnail_file_id"]).where("id", "=", sceneId).where("tour_id", "=", t.id).forUpdate().executeTakeFirst();
    if (!s) throw notFound("Escena");
    const pointing = await trx.selectFrom("virtual_tour_hotspots as h").innerJoin("virtual_tour_scenes as o", "o.id", "h.scene_id").select(["o.name", "h.label"]).where("h.target_scene_id", "=", s.id).execute();
    await trx.deleteFrom("virtual_tour_scenes").where("id", "=", s.id).execute(); // cascada: sus puntos y los que llevaban a ella
    const guided = t.guided_scene_ids.filter((id) => id !== s.id);
    let start = t.start_scene_id === s.id ? null : t.start_scene_id;
    if (!start) start = (await trx.selectFrom("virtual_tour_scenes").select("id").where("tour_id", "=", t.id).orderBy("is_published", "desc").orderBy("sort_order").limit(1).executeTakeFirst())?.id ?? null;
    await trx.updateTable("virtual_tours").set({ guided_scene_ids: guided, start_scene_id: start }).where("id", "=", t.id).execute();
    const ids = [s.panorama_file_id, s.preview_file_id, s.thumbnail_file_id].filter((x): x is string => Boolean(x));
    if (ids.length) await trx.updateTable("files").set({ deleted_at: new Date() }).where("id", "in", ids).where("deleted_at", "is", null).execute();
    await assertPublishedStillValid(trx, t);
    await touch(trx, actor, t, "VIRTUAL_TOUR_SCENE_DELETED", { before: { sceneId: s.id, name: s.name, removedHotspotsPointingHere: pointing }, after: { startSceneId: start } });
    return ids;
  });
  await removeDeletedTourFiles(db, fileIds).catch((e) => log.error("tours.scene_files_failed", { sceneId, ...errorFields(e) }));
}

// ───────────────────────── Puntos (hotspots) ─────────────────────────

async function assertTarget(trx: Tx, tourId: string, sceneId: string, targetSceneId: string | null | undefined) {
  if (!targetSceneId) return;
  if (targetSceneId === sceneId) throw invalid("Un punto no puede llevar a la misma escena", { targetSceneId: ["Elegí otra escena"] });
  const target = await trx.selectFrom("virtual_tour_scenes").select("id").where("id", "=", targetSceneId).where("tour_id", "=", tourId).executeTakeFirst();
  if (!target) throw invalid("El destino tiene que ser una escena de este tour", { targetSceneId: ["Escena inválida"] });
}

export async function addHotspot(db: Database, actor: Actor, sceneId: string, raw: unknown): Promise<{ id: string }> {
  requirePermission(actor, "properties.manage_media");
  const input = parseInput(hotspotSchema, raw);
  const tourId = await tourIdOfScene(db, sceneId);
  return db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    await assertTarget(trx, t.id, sceneId, input.targetSceneId);
    const n = await trx.selectFrom("virtual_tour_hotspots").select([sql<number>`count(*)::int`.as("n"), sql<number>`coalesce(max(sort_order), 0)::int`.as("max_order")]).where("scene_id", "=", sceneId).executeTakeFirstOrThrow();
    if (n.n >= MAX_HOTSPOTS_PER_SCENE) throw conflict(`La escena ya tiene ${MAX_HOTSPOTS_PER_SCENE} puntos`);
    const row = await trx
      .insertInto("virtual_tour_hotspots")
      .values({ scene_id: sceneId, kind: input.kind, target_scene_id: input.kind === "scene" ? input.targetSceneId! : null, label: input.label, content: input.content ?? null, yaw: input.yaw, pitch: input.pitch, sort_order: n.max_order + 10 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await assertPublishedStillValid(trx, t);
    await touch(trx, actor, t, "VIRTUAL_TOUR_HOTSPOT_ADDED", { after: { hotspotId: row.id, sceneId, ...input } });
    return row;
  });
}

export async function updateHotspot(db: Database, actor: Actor, hotspotId: string, raw: unknown): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const input = parseInput(hotspotSchema, raw);
  const tourId = await tourIdOfHotspot(db, hotspotId);
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    const h = await trx.selectFrom("virtual_tour_hotspots").selectAll().where("id", "=", hotspotId).forUpdate().executeTakeFirstOrThrow();
    await assertTarget(trx, t.id, h.scene_id, input.targetSceneId);
    const patch = { kind: input.kind, target_scene_id: input.kind === "scene" ? input.targetSceneId! : null, label: input.label, content: input.content ?? null, yaw: input.yaw, pitch: input.pitch };
    await trx.updateTable("virtual_tour_hotspots").set(patch).where("id", "=", h.id).execute();
    await assertPublishedStillValid(trx, t);
    await touch(trx, actor, t, "VIRTUAL_TOUR_HOTSPOT_UPDATED", { before: { hotspotId, kind: h.kind, target_scene_id: h.target_scene_id, label: h.label, content: h.content, yaw: h.yaw, pitch: h.pitch }, after: { hotspotId, ...patch } });
  });
}

export async function deleteHotspot(db: Database, actor: Actor, hotspotId: string): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const tourId = await tourIdOfHotspot(db, hotspotId);
  await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    const h = await trx.selectFrom("virtual_tour_hotspots").select(["id", "scene_id", "kind", "label", "target_scene_id"]).where("id", "=", hotspotId).forUpdate().executeTakeFirstOrThrow();
    await trx.deleteFrom("virtual_tour_hotspots").where("id", "=", h.id).execute();
    await touch(trx, actor, t, "VIRTUAL_TOUR_HOTSPOT_DELETED", { before: h });
  });
}

// ───────────────────────── Plano ─────────────────────────

export async function setFloorPlan(db: Database, actor: Actor, tourId: string, bytes: Uint8Array, originalName: string | null = null): Promise<{ width: number; height: number }> {
  requirePermission(actor, "properties.manage_media");
  assertUuid(tourId, "Tour");
  const pre = await db.selectFrom("virtual_tours").select(["kind", "is_demo"]).where("id", "=", tourId).executeTakeFirst();
  if (!pre) throw notFound("Tour");
  if (pre.is_demo) throw forbidden("El tour de la demo se actualiza desde su manifiesto (pnpm seed:demo-tour), no desde el CRM");
  if (pre.kind !== "internal") throw invalid("Un tour externo no tiene plano propio");
  assertTourStorage();
  const img = await processFloorPlan(bytes);
  const obj = await putPublicObject(`tours/${tourId}/plans`, img.bytes, "image/webp", "webp");
  try {
    const previous = await db.transaction().execute(async (trx) => {
      const t = await lockTour(trx, tourId);
      const f = await insertPublicFile(trx, obj, { bytes: img.bytes, contentType: "image/webp", width: img.width, height: img.height, name: originalName?.slice(0, 200) ?? null, uploadedBy: actorUserId(actor) });
      await trx.updateTable("virtual_tours").set({ floor_plan_file_id: f.fileId, floor_plan_url: null, floor_plan_width: img.width, floor_plan_height: img.height }).where("id", "=", t.id).execute();
      if (t.floor_plan_file_id) await trx.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", t.floor_plan_file_id).where("deleted_at", "is", null).execute();
      await touch(trx, actor, t, "VIRTUAL_TOUR_FLOOR_PLAN_SET", { before: { fileId: t.floor_plan_file_id }, after: { fileId: f.fileId, width: img.width, height: img.height } });
      return t.floor_plan_file_id;
    });
    if (previous) await removeDeletedTourFiles(db, [previous]).catch((e) => log.error("tours.plan_files_failed", { tourId, ...errorFields(e) }));
    return { width: img.width, height: img.height };
  } catch (e) {
    await discardObjects([obj]);
    throw e;
  }
}

export async function removeFloorPlan(db: Database, actor: Actor, tourId: string): Promise<void> {
  requirePermission(actor, "properties.manage_media");
  const previous = await db.transaction().execute(async (trx) => {
    const t = await lockTour(trx, tourId);
    if (!t.floor_plan_file_id) return null;
    await trx.updateTable("virtual_tours").set({ floor_plan_file_id: null, floor_plan_url: null, floor_plan_width: null, floor_plan_height: null }).where("id", "=", t.id).execute();
    await trx.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", t.floor_plan_file_id).where("deleted_at", "is", null).execute();
    await touch(trx, actor, t, "VIRTUAL_TOUR_FLOOR_PLAN_REMOVED", { before: { fileId: t.floor_plan_file_id } });
    return t.floor_plan_file_id;
  });
  if (previous) await removeDeletedTourFiles(db, [previous]).catch((e) => log.error("tours.plan_files_failed", { tourId, ...errorFields(e) }));
}

// Reintento horario de objetos de tours dados de baja que no se pudieron borrar del bucket.
registerJobHandler("tours.purge_deleted_files", async (_p, { db }) => removeDeletedTourFiles(db));
addScheduledTask({ type: "tours.purge_deleted_files", every: "hourly", timeoutMs: 60_000 });
