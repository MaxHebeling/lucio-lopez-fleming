/**
 * Publicación en Página de Facebook e Instagram profesional vía Graph API (graph.facebook.com).
 * Documentación consultada 2026-09 (developers.facebook.com, ejemplos en v25.0 / referencia v26.0):
 * - Facebook: 1 foto → POST /{page-id}/photos (url, caption) → { id, post_id }.
 *   Varias fotos → cada una POST /{page-id}/photos con published=false → POST /{page-id}/feed con
 *   message + attached_media[i]={"media_fbid":"…"} → { id }. Token: Page access token (pages_manage_posts).
 * - Instagram: POST /{ig-user-id}/media (image_url, caption) → contenedor; carrusel: hijos con is_carousel_item=true,
 *   padre media_type=CAROUSEL + children (≤10); GET /{container}?fields=status_code hasta FINISHED;
 *   POST /{ig-user-id}/media_publish (creation_id). Solo JPEG, ≤8 MB, relación 4:5 a 1.91:1, 100 posts/24 h.
 * Las imágenes deben ser URLs públicas https (Meta las descarga).
 */
import type { Database } from "../../db";
import { callIntegration } from "../../resilience";
import { NotConfiguredError, PermanentIntegrationError, requestJson } from "../http";

export const META_INTEGRATION_KEY = "meta_social";

export type MetaConfig = { pageId: string; pageToken: string; igUserId: string | null; version: string };

export function metaConfig(channel: "facebook" | "instagram"): { ok: true; config: MetaConfig } | { ok: false; reason: string } {
  const pageId = process.env.META_PAGE_ID?.trim() ?? "";
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN?.trim() ?? "";
  const igUserId = process.env.META_IG_USER_ID?.trim() || null;
  const version = process.env.META_GRAPH_VERSION?.trim() || "v26.0";
  const missing = [!pageId && "META_PAGE_ID", !pageToken && "META_PAGE_ACCESS_TOKEN", channel === "instagram" && !igUserId && "META_IG_USER_ID"].filter(Boolean);
  if (missing.length) return { ok: false, reason: `Faltan variables de entorno: ${missing.join(", ")}` };
  if (!/^v\d+\.\d+$/.test(version)) return { ok: false, reason: "META_GRAPH_VERSION inválida (formato vNN.N)" };
  return { ok: true, config: { pageId, pageToken, igUserId, version } };
}

type GraphCall = { method?: "GET" | "POST"; form?: Record<string, string>; timeoutMs?: number };

async function graph<T>(db: Database, cfg: MetaConfig, operation: string, path: string, call: GraphCall = {}, entityId?: string): Promise<T> {
  const url = `https://graph.facebook.com/${cfg.version}/${path.replace(/^\//, "")}`;
  return callIntegration(
    db,
    META_INTEGRATION_KEY,
    operation,
    async () =>
      (
        await requestJson<T>(url, {
          method: call.method ?? "POST",
          label: `Meta ${operation}`,
          // El token va en header, nunca en la URL (no queda en logs de proxies).
          headers: { authorization: `Bearer ${cfg.pageToken}` },
          form: call.method === "GET" ? undefined : call.form,
          timeoutMs: call.timeoutMs ?? 30_000,
          attempts: 2,
        })
      ).data,
    { entityType: "social_post", entityId },
  );
}

export async function publishFacebookPost(db: Database, input: { message: string; imageUrls: string[]; postId?: string }): Promise<{ externalPostId: string }> {
  const cfg = metaConfig("facebook");
  if (!cfg.ok) throw new NotConfiguredError(cfg.reason);
  const c = cfg.config;
  if (!input.imageUrls.length) throw new PermanentIntegrationError("El post no tiene fotos");
  if (input.imageUrls.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(db, c, "facebook.photos", `${c.pageId}/photos`, { form: { url: input.imageUrls[0]!, caption: input.message } }, input.postId);
    const id = r?.post_id ?? r?.id;
    if (!id) throw new PermanentIntegrationError("Facebook respondió sin id de publicación");
    return { externalPostId: id };
  }
  const mediaIds: string[] = [];
  for (const url of input.imageUrls) {
    const r = await graph<{ id: string }>(db, c, "facebook.photos_unpublished", `${c.pageId}/photos`, { form: { url, published: "false" } }, input.postId);
    if (!r?.id) throw new PermanentIntegrationError("Facebook no devolvió id de foto");
    mediaIds.push(r.id);
  }
  const form: Record<string, string> = { message: input.message };
  mediaIds.forEach((id, i) => (form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  const post = await graph<{ id: string }>(db, c, "facebook.feed", `${c.pageId}/feed`, { form }, input.postId);
  if (!post?.id) throw new PermanentIntegrationError("Facebook respondió sin id de publicación");
  return { externalPostId: post.id };
}

export type ContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

export async function instagramContainerStatus(db: Database, containerId: string, postId?: string): Promise<ContainerStatus> {
  const cfg = metaConfig("instagram");
  if (!cfg.ok) throw new NotConfiguredError(cfg.reason);
  const r = await graph<{ status_code?: ContainerStatus }>(db, cfg.config, "instagram.container_status", `${containerId}?fields=status_code`, { method: "GET" }, postId);
  return r?.status_code ?? "IN_PROGRESS";
}

async function waitFinished(db: Database, containerId: string, postId: string | undefined, sleep: (ms: number) => Promise<void>, maxWaitMs: number): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const status = await instagramContainerStatus(db, containerId, postId);
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new PermanentIntegrationError(`Instagram no pudo procesar la imagen (contenedor ${status})`);
    if (Date.now() > deadline) throw new PermanentIntegrationError("Instagram tardó demasiado en procesar las imágenes");
    await sleep(2_000);
  }
}

export type InstagramPublishHooks = {
  /** Se llama apenas existe el contenedor final, ANTES de media_publish (para no publicar dos veces tras un corte). */
  onContainer: (containerId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
};

export async function publishInstagramPost(db: Database, input: { caption: string; imageUrls: string[]; postId?: string }, hooks: InstagramPublishHooks): Promise<{ externalPostId: string; containerId: string }> {
  const cfg = metaConfig("instagram");
  if (!cfg.ok) throw new NotConfiguredError(cfg.reason);
  const c = cfg.config;
  const ig = c.igUserId!;
  const sleep = hooks.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxWait = hooks.maxWaitMs ?? 60_000;
  if (!input.imageUrls.length) throw new PermanentIntegrationError("El post no tiene fotos");
  if (input.imageUrls.length > 10) throw new PermanentIntegrationError("Instagram admite hasta 10 fotos por carrusel");

  let containerId: string;
  if (input.imageUrls.length === 1) {
    const r = await graph<{ id: string }>(db, c, "instagram.media", `${ig}/media`, { form: { image_url: input.imageUrls[0]!, caption: input.caption } }, input.postId);
    if (!r?.id) throw new PermanentIntegrationError("Instagram no devolvió contenedor");
    containerId = r.id;
  } else {
    const children: string[] = [];
    for (const url of input.imageUrls) {
      const r = await graph<{ id: string }>(db, c, "instagram.media_child", `${ig}/media`, { form: { image_url: url, is_carousel_item: "true" } }, input.postId);
      if (!r?.id) throw new PermanentIntegrationError("Instagram no devolvió contenedor de foto");
      children.push(r.id);
    }
    for (const child of children) await waitFinished(db, child, input.postId, sleep, maxWait);
    const r = await graph<{ id: string }>(db, c, "instagram.media_carousel", `${ig}/media`, { form: { media_type: "CAROUSEL", children: children.join(","), caption: input.caption } }, input.postId);
    if (!r?.id) throw new PermanentIntegrationError("Instagram no devolvió contenedor de carrusel");
    containerId = r.id;
  }
  await waitFinished(db, containerId, input.postId, sleep, maxWait);
  await hooks.onContainer(containerId);
  const published = await graph<{ id: string }>(db, c, "instagram.media_publish", `${ig}/media_publish`, { form: { creation_id: containerId } }, input.postId);
  if (!published?.id) throw new PermanentIntegrationError("Instagram respondió sin id de publicación");
  return { externalPostId: published.id, containerId };
}
