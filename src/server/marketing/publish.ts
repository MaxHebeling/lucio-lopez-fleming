/**
 * Publicador de redes (job `social.publish`, flag `social_publishing`).
 * - Solo posts `scheduled` (aprobados por una persona: lo garantiza el CHECK) cuya hora llegó.
 * - Idempotente: con external_post_id no republica. Pasa a `publishing` antes de llamar a Meta; si un proceso muere
 *   a mitad, NO se reintenta a ciegas: en Instagram se consulta el contenedor guardado; en Facebook queda `failed`
 *   pidiendo verificación humana (evita posts duplicados).
 * - Instagram guarda `external_container_id` apenas se crea el contenedor. Cualquier intento posterior (reintento por
 *   falla transitoria, lease vencido, reprogramación) consulta ese contenedor antes de nada: PUBLISHED → publicado;
 *   listo/en proceso → se publica ESE contenedor; ERROR/EXPIRED → se crea otro. Si no se puede consultar → `failed`
 *   pidiendo verificar en Meta.
 * - Timeout / corte / 5xx en el POST que publica → resultado incierto: `failed` pidiendo verificación (sin reintento).
 * - Sin credenciales: el post sigue `scheduled` con el motivo visible y se retoma cuando se configuren.
 */
import { sql, type Database, type Executor } from "../db";
import { isEnabled } from "../flags";
import { log } from "../log";
import { RetryableError, UncertainOutcomeError } from "../resilience";
import { enqueue } from "../jobs/queue";
import { PermanentJobError, registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";
import { NotConfiguredError, PermanentIntegrationError } from "../integrations/http";
import { reflectIntegrationConfig } from "../integrations/status";
import { META_INTEGRATION_KEY, instagramContainerStatus, metaConfig, publishFacebookPost, publishInstagramContainer, publishInstagramPost } from "../integrations/meta/graph";
import { socialImageUrls } from "./images";

export const SOCIAL_PUBLISH_MAX_ATTEMPTS = 4;
const PUBLISHING_LEASE_MS = 15 * 60_000;

export function uncertainPublishMessage(channel: "instagram" | "facebook", detail?: string): string {
  const where = channel === "instagram" ? "Instagram" : "Facebook";
  return `Resultado incierto: Meta no confirmó la publicación y pudo haber salido. Verificá en ${where} si el post está publicado antes de reprogramarlo.${detail ? ` (${detail})` : ""}`.slice(0, 1000);
}

export function socialPublishDedupeKey(postId: string, scheduledAt: Date): string {
  return `social.publish:${postId}:${scheduledAt.toISOString()}`;
}

export async function enqueueSocialPublish(db: Executor, postId: string, scheduledAt: Date): Promise<string | null> {
  return enqueue(db, {
    type: "social.publish",
    payload: { postId },
    dedupeKey: socialPublishDedupeKey(postId, scheduledAt),
    runAt: scheduledAt,
    maxAttempts: SOCIAL_PUBLISH_MAX_ATTEMPTS,
    timeoutMs: 180_000,
  });
}

export type PublishResult = { status: "published" | "already_published" | "skipped" | "awaiting_credentials" | "failed"; detail?: string; externalPostId?: string };

type Claim =
  | { kind: "return"; result: PublishResult }
  | { kind: "publish"; channel: "instagram" | "facebook"; caption: string; recoverContainerId: string | null };

export async function publishSocialPost(db: Database, postId: string, opts: { attempt?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<PublishResult> {
  const attempt = opts.attempt ?? 1;
  if (!(await isEnabled(db, "social_publishing"))) return { status: "skipped", detail: "feature flag social_publishing apagado" };

  const claim = await db.transaction().execute(async (trx): Promise<Claim> => {
    const post = await trx.selectFrom("social_posts").selectAll().where("id", "=", postId).forUpdate().executeTakeFirst();
    if (!post) throw new PermanentJobError(`Post ${postId} inexistente`);
    if (post.external_post_id) {
      if (post.status !== "published") await trx.updateTable("social_posts").set({ status: "published", published_at: post.published_at ?? new Date() }).where("id", "=", post.id).execute();
      return { kind: "return", result: { status: "already_published", externalPostId: post.external_post_id } };
    }
    const channel = post.channel as "instagram" | "facebook";
    let recoverContainerId: string | null = null;
    if (post.status === "publishing") {
      if (Date.now() - new Date(post.updated_at).getTime() < PUBLISHING_LEASE_MS) throw new RetryableError("El post se está publicando en otro proceso");
      if (channel === "instagram" && post.external_container_id) {
        recoverContainerId = post.external_container_id;
      } else {
        const error = `La publicación se interrumpió y su resultado es incierto: verificá en ${channel === "instagram" ? "Instagram" : "Facebook"} si salió antes de reprogramar.`;
        await trx.updateTable("social_posts").set({ status: "failed", last_error: error }).where("id", "=", post.id).execute();
        return { kind: "return", result: { status: "failed", detail: error } };
      }
    } else {
      if (post.status !== "scheduled") return { kind: "return", result: { status: "skipped", detail: `estado ${post.status}` } };
      if (!post.scheduled_at || new Date(post.scheduled_at).getTime() > Date.now() + 30_000) return { kind: "return", result: { status: "skipped", detail: "todavía no es la hora programada" } };
      // Un intento anterior ya creó el contenedor: se consulta antes de crear/publicar otro.
      if (channel === "instagram" && post.external_container_id) recoverContainerId = post.external_container_id;
    }
    if (!post.approved_by) throw new PermanentJobError("Post sin aprobación humana");
    const cfg = metaConfig(channel);
    await reflectIntegrationConfig(trx, META_INTEGRATION_KEY, cfg.ok, cfg.ok ? undefined : cfg.reason);
    if (!cfg.ok) {
      await trx.updateTable("social_posts").set({ last_error: `Sin credenciales de Meta: ${cfg.reason}` }).where("id", "=", post.id).execute();
      return { kind: "return", result: { status: "awaiting_credentials", detail: cfg.reason } };
    }
    await trx.updateTable("social_posts").set({ status: "publishing", last_error: null }).where("id", "=", post.id).execute();
    return { kind: "publish", channel, caption: post.caption, recoverContainerId };
  });
  if (claim.kind === "return") return claim.result;

  const markPublished = async (externalPostId: string) => {
    await db.updateTable("social_posts").set({ status: "published", published_at: new Date(), external_post_id: externalPostId, last_error: null }).where("id", "=", postId).execute();
  };
  const markFailed = async (error: string): Promise<PublishResult> => {
    await db.updateTable("social_posts").set({ status: "failed", last_error: error }).where("id", "=", postId).execute();
    log.warn("social.publish_uncertain", { postId, error });
    return { status: "failed", detail: error };
  };

  try {
    if (claim.recoverContainerId) {
      let status: Awaited<ReturnType<typeof instagramContainerStatus>>;
      try {
        status = await instagramContainerStatus(db, claim.recoverContainerId, postId);
      } catch (e) {
        if (e instanceof NotConfiguredError) throw e;
        return await markFailed(uncertainPublishMessage("instagram", `no se pudo consultar el contenedor ${claim.recoverContainerId}: ${(e as Error).message}`));
      }
      if (status === "PUBLISHED") {
        const externalPostId = `container:${claim.recoverContainerId}`;
        await markPublished(externalPostId);
        return { status: "published", externalPostId, detail: "recuperado desde el contenedor de Instagram" };
      }
      if (status === "FINISHED" || status === "IN_PROGRESS") {
        const r = await publishInstagramContainer(db, claim.recoverContainerId, { postId, sleep: opts.sleep });
        await markPublished(r.externalPostId);
        return { status: "published", externalPostId: r.externalPostId, detail: "publicado desde el contenedor ya creado" };
      }
      // ERROR / EXPIRED: ese contenedor no se publicó ni se va a publicar; se crea otro.
      await db.updateTable("social_posts").set({ external_container_id: null }).where("id", "=", postId).execute();
    }
    const imageUrls = await socialImageUrls(db, postId);
    const r =
      claim.channel === "facebook"
        ? await publishFacebookPost(db, { message: claim.caption, imageUrls, postId })
        : await publishInstagramPost(db, { caption: claim.caption, imageUrls, postId }, {
            sleep: opts.sleep,
            onContainer: async (containerId) => {
              await db.updateTable("social_posts").set({ external_container_id: containerId }).where("id", "=", postId).execute();
            },
          });
    await markPublished(r.externalPostId);
    return { status: "published", externalPostId: r.externalPostId };
  } catch (e) {
    const message = ((e as Error).message ?? String(e)).slice(0, 1000);
    if (e instanceof NotConfiguredError) {
      await db.updateTable("social_posts").set({ status: "scheduled", last_error: message }).where("id", "=", postId).execute();
      return { status: "awaiting_credentials", detail: message };
    }
    const containerId =
      claim.channel === "instagram" ? ((await db.selectFrom("social_posts").select("external_container_id").where("id", "=", postId).executeTakeFirst())?.external_container_id ?? null) : null;
    if (e instanceof UncertainOutcomeError) {
      // No se republica a ciegas. En Instagram se consulta una vez el contenedor por si ya figura publicado.
      if (containerId) {
        const status = await instagramContainerStatus(db, containerId, postId).catch(() => null);
        if (status === "PUBLISHED") {
          const externalPostId = `container:${containerId}`;
          await markPublished(externalPostId);
          return { status: "published", externalPostId, detail: "confirmado desde el contenedor de Instagram" };
        }
      }
      return await markFailed(uncertainPublishMessage(claim.channel, message));
    }
    if (e instanceof PermanentIntegrationError) {
      await db.updateTable("social_posts").set({ status: "failed", last_error: message }).where("id", "=", postId).execute();
      throw new PermanentJobError(message);
    }
    const final = attempt >= SOCIAL_PUBLISH_MAX_ATTEMPTS;
    // Falla transitoria segura. Si ya hay contenedor guardado, el reintento lo consulta antes de hacer nada.
    await db.updateTable("social_posts").set({ status: final ? "failed" : "scheduled", last_error: message }).where("id", "=", postId).execute();
    log.warn("social.publish_failed", { postId, attempt, final, error: message, containerId });
    throw e;
  }
}

registerJobHandler("social.publish", async (payload, ctx) => {
  const postId = typeof payload.postId === "string" ? payload.postId : "";
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new PermanentJobError("social.publish: postId inválido");
  return publishSocialPost(ctx.db, postId, { attempt: ctx.attempt });
});

/** Red de seguridad horaria: posts vencidos sin job vivo (p. ej. flag o credenciales activados después) e interrumpidos. */
export async function dispatchDueSocialPosts(db: Database, limit = 100): Promise<{ queued: number }> {
  if (!(await isEnabled(db, "social_publishing"))) return { queued: 0 };
  const due = await sql<{ id: string; scheduled_at: Date }>`
    select id, scheduled_at from social_posts
     where external_post_id is null and scheduled_at is not null
       and ((status = 'scheduled' and scheduled_at <= now())
         or (status = 'publishing' and updated_at < now() - make_interval(mins => 15)))
     order by scheduled_at limit ${limit}`.execute(db);
  let queued = 0;
  for (const p of due.rows) {
    if (
      await enqueue(db, {
        type: "social.publish",
        payload: { postId: p.id },
        dedupeKey: `${socialPublishDedupeKey(p.id, new Date(p.scheduled_at))}:sweep`,
        maxAttempts: SOCIAL_PUBLISH_MAX_ATTEMPTS,
        timeoutMs: 180_000,
      })
    )
      queued++;
  }
  return { queued };
}

registerJobHandler("social.dispatch", async (_p, ctx) => dispatchDueSocialPosts(ctx.db));
addScheduledTask({ type: "social.dispatch", every: "hourly" });
