/**
 * Flujo humano de contenido: editar copy, elegir/ordenar fotos, aprobar, rechazar, programar y desprogramar.
 * Cualquier cambio de copy o fotos sobre un post aprobado/programado lo vuelve a borrador (hay que reaprobar).
 */
import { z } from "zod";
import type { Database, Tx } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { conflict, invalid, notFound } from "../errors";
import { CAPTION_MAX } from "./copy";
import { MAX_POST_ASSETS } from "./drafts";
import { enqueueSocialPublish } from "./publish";
import { TIMEZONE, zonedLocalToUtc } from "./time";

const EDITABLE = ["draft", "in_review", "approved", "scheduled", "rejected", "failed"];

async function loadPost(trx: Tx, id: string) {
  const post = await trx.selectFrom("social_posts").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  if (!post) throw notFound("Publicación");
  return post;
}

function backToDraft(status: string) {
  return ["approved", "scheduled", "rejected", "failed"].includes(status)
    ? { status: "draft", approved_by: null, approved_at: null, scheduled_at: null, rejected_reason: null }
    : {};
}

export const captionSchema = z.object({ postId: z.uuid(), caption: z.string().trim().min(10, "El texto es muy corto").max(CAPTION_MAX.facebook) });

export async function updatePostCaption(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "marketing.create");
  const input = captionSchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    const post = await loadPost(trx, input.postId);
    if (!EDITABLE.includes(post.status)) throw conflict("Esta publicación ya no se puede editar");
    if (post.channel === "instagram" && input.caption.length > CAPTION_MAX.instagram) throw invalid(`Instagram admite hasta ${CAPTION_MAX.instagram} caracteres`);
    if ((input.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) throw invalid("Instagram admite hasta 30 hashtags");
    if (post.caption === input.caption) return;
    await trx
      .updateTable("social_posts")
      .set({ caption: input.caption, generated_by: post.generated_by === "template" || post.generated_by === "ai" ? "human" : post.generated_by, ...backToDraft(post.status) })
      .where("id", "=", post.id)
      .execute();
    await audit(trx, actor, { action: "SOCIAL_POST_EDITED", entityType: "social_post", entityId: post.id, before: { caption: post.caption, status: post.status }, after: { caption: input.caption } });
  });
}

export const assetsSchema = z.object({ postId: z.uuid(), mediaIds: z.array(z.uuid()).min(1, "Elegí al menos una foto").max(MAX_POST_ASSETS, `Máximo ${MAX_POST_ASSETS} fotos`) });

export async function setPostAssets(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "marketing.create");
  const input = assetsSchema.parse(raw);
  if (new Set(input.mediaIds).size !== input.mediaIds.length) throw invalid("Hay fotos repetidas");
  await db.transaction().execute(async (trx) => {
    const post = await loadPost(trx, input.postId);
    if (!EDITABLE.includes(post.status)) throw conflict("Esta publicación ya no se puede editar");
    if (!post.property_id) throw invalid("La publicación no está asociada a una propiedad");
    const media = await trx
      .selectFrom("property_media")
      .select("id")
      .where("property_id", "=", post.property_id)
      .where("id", "in", input.mediaIds)
      .where("kind", "=", "image")
      .where("deleted_at", "is", null)
      .where("status", "in", ["source_only", "verified", "stored"])
      .execute();
    if (media.length !== input.mediaIds.length) throw invalid("Alguna foto no pertenece a la propiedad o no está disponible");
    const before = await trx.selectFrom("social_assets").select(["property_media_id", "sort_order"]).where("social_post_id", "=", post.id).orderBy("sort_order").execute();
    if (before.map((b) => b.property_media_id).join(",") === input.mediaIds.join(",")) return;
    await trx.deleteFrom("social_assets").where("social_post_id", "=", post.id).execute();
    await trx.insertInto("social_assets").values(input.mediaIds.map((id, i) => ({ social_post_id: post.id, property_media_id: id, sort_order: i }))).execute();
    const reset = backToDraft(post.status);
    if (Object.keys(reset).length) await trx.updateTable("social_posts").set(reset).where("id", "=", post.id).execute();
    await audit(trx, actor, { action: "SOCIAL_POST_ASSETS_SET", entityType: "social_post", entityId: post.id, before: before.map((b) => b.property_media_id), after: input.mediaIds });
  });
}

export const idSchema = z.object({ postId: z.uuid() });

export async function approvePost(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "marketing.approve");
  const input = idSchema.parse(raw);
  const userId = actorUserId(actor);
  if (!userId) throw invalid("La aprobación la hace una persona del equipo");
  await db.transaction().execute(async (trx) => {
    const post = await loadPost(trx, input.postId);
    if (!["draft", "in_review"].includes(post.status)) throw conflict("Solo se aprueban borradores");
    const assets = await trx.selectFrom("social_assets").select("id").where("social_post_id", "=", post.id).execute();
    if (!assets.length) throw invalid("Elegí al menos una foto antes de aprobar");
    await trx.updateTable("social_posts").set({ status: "approved", approved_by: userId, approved_at: new Date(), rejected_reason: null, last_error: null }).where("id", "=", post.id).execute();
    await audit(trx, actor, { action: "SOCIAL_POST_APPROVED", entityType: "social_post", entityId: post.id, before: { status: post.status }, after: { status: "approved", caption: post.caption, assets: assets.length } });
  });
}

export const rejectSchema = z.object({ postId: z.uuid(), reason: z.string().trim().min(3, "Indicá el motivo").max(500) });

export async function rejectPost(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "marketing.approve");
  const input = rejectSchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    const post = await loadPost(trx, input.postId);
    if (!["draft", "in_review", "approved", "scheduled", "failed"].includes(post.status)) throw conflict("Esta publicación no se puede rechazar");
    await trx
      .updateTable("social_posts")
      .set({ status: "rejected", rejected_reason: input.reason, approved_by: null, approved_at: null, scheduled_at: null })
      .where("id", "=", post.id)
      .execute();
    await audit(trx, actor, { action: "SOCIAL_POST_REJECTED", entityType: "social_post", entityId: post.id, before: { status: post.status }, after: { status: "rejected", reason: input.reason } });
  });
}

export const scheduleSchema = z.object({ postId: z.uuid(), localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Fecha y hora inválidas") });

export async function schedulePost(db: Database, actor: Actor, raw: unknown, now = new Date()): Promise<{ scheduledAt: Date }> {
  requirePermission(actor, "marketing.approve");
  const input = scheduleSchema.parse(raw);
  const scheduledAt = zonedLocalToUtc(input.localDateTime, TIMEZONE);
  if (Number.isNaN(scheduledAt.getTime())) throw invalid("Fecha y hora inválidas");
  if (scheduledAt.getTime() < now.getTime() + 60_000) throw invalid("Elegí una fecha y hora futura (hora de Salta)");
  if (scheduledAt.getTime() > now.getTime() + 180 * 86_400_000) throw invalid("Se puede programar hasta 180 días hacia adelante");
  return db.transaction().execute(async (trx) => {
    const post = await loadPost(trx, input.postId);
    if (!["approved", "scheduled", "failed"].includes(post.status) || !post.approved_by) throw conflict("Primero hay que aprobar la publicación");
    if (post.external_post_id) throw conflict("Esta publicación ya salió");
    await trx.updateTable("social_posts").set({ status: "scheduled", scheduled_at: scheduledAt, last_error: null }).where("id", "=", post.id).execute();
    await enqueueSocialPublish(trx, post.id, scheduledAt);
    await audit(trx, actor, { action: "SOCIAL_POST_SCHEDULED", entityType: "social_post", entityId: post.id, before: { status: post.status, scheduledAt: post.scheduled_at }, after: { status: "scheduled", scheduledAt: scheduledAt.toISOString() } });
    return { scheduledAt };
  });
}

export async function unschedulePost(db: Database, actor: Actor, raw: unknown): Promise<void> {
  requirePermission(actor, "marketing.approve");
  const input = idSchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    const post = await loadPost(trx, input.postId);
    if (post.status !== "scheduled") throw conflict("La publicación no está programada");
    await trx.updateTable("social_posts").set({ status: "approved", scheduled_at: null }).where("id", "=", post.id).execute();
    await audit(trx, actor, { action: "SOCIAL_POST_UNSCHEDULED", entityType: "social_post", entityId: post.id, before: { status: "scheduled", scheduledAt: post.scheduled_at }, after: { status: "approved" } });
  });
}
